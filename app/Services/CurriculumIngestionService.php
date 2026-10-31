<?php
declare(strict_types=1);

namespace Akademi\Services;

use Akademi\Database\Connection;
use PDO;
use RuntimeException;
use Throwable;

final class CurriculumIngestionService
{
    private const MAX_FILE_BYTES = 80 * 1024 * 1024;
    private const MAX_UPLOAD_FILES = 10;
    private const CHUNK_SIZE = 4200;

    public function scan(string $directory, bool $scanOnly = false, bool $retryIncomplete = false): array
    {
        $root = realpath($directory);
        if ($root === false || !is_dir($root) || !is_readable($root)) {
            throw new RuntimeException('Curriculum source directory was not found or is not readable.');
        }
        $files = [];
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::LEAVES_ONLY
        );
        foreach ($iterator as $file) {
            if (!$file->isFile() || $file->isLink()) {
                continue;
            }
            $extension = strtolower($file->getExtension());
            if (!in_array($extension, ['pdf', 'txt', 'md', 'csv', 'docx'], true)) {
                continue;
            }
            $files[] = [
                'path' => $file->getPathname(),
                'name' => $file->getFilename(),
                'extension' => $extension,
                'bytes' => $file->getSize(),
                'year_group' => $this->inferYearGroup($file->getFilename(), $file->getPathname(), $root),
                'resource_role' => $this->inferResourceRole($file->getFilename()),
            ];
        }
        usort($files, static fn(array $left, array $right): int => strnatcasecmp($left['name'], $right['name']));
        if ($scanOnly) {
            return $files;
        }
        if ($files === []) {
            return ['imported' => 0, 'duplicate' => 0, 'too_large' => 0, 'failed' => 0, 'documents' => []];
        }
        return $this->import($root, $files, $retryIncomplete);
    }

    public function upload(
        array $uploads,
        array $metadata,
        int $actorUserId,
        ?string $trustedStagingRoot = null
    ): array {
        if ($trustedStagingRoot !== null) {
            $trustedStagingRoot = realpath($trustedStagingRoot);
            $stagingRoot = realpath(AKADEMI_STORAGE . DIRECTORY_SEPARATOR . 'curriculum'
                . DIRECTORY_SEPARATOR . 'upload-staging');
            if ($trustedStagingRoot === false || $stagingRoot === false
                || !str_starts_with(
                    strtolower(rtrim($trustedStagingRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR),
                    strtolower(rtrim($stagingRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR)
                )) {
                throw new RuntimeException('The staged upload location is not available.', 422);
            }
        }
        if (!isset($uploads['name'], $uploads['tmp_name'], $uploads['error'], $uploads['size'])
            || !is_array($uploads['name']) || !is_array($uploads['tmp_name'])
            || !is_array($uploads['error']) || !is_array($uploads['size'])) {
            throw new RuntimeException('Select at least one resource file.', 422);
        }
        $count = count($uploads['name']);
        if ($count < 1 || $count > self::MAX_UPLOAD_FILES
            || count($uploads['tmp_name']) !== $count
            || count($uploads['error']) !== $count
            || count($uploads['size']) !== $count) {
            throw new RuntimeException('Upload between 1 and 10 resource files at a time.', 422);
        }

        $yearGroups = $metadata['year_groups'] ?? ($metadata['year_group'] ?? []);
        if (!is_array($yearGroups)) {
            $yearGroups = explode(',', (string)$yearGroups);
        }
        if (array_filter($yearGroups, static fn(mixed $value): bool => !is_string($value)) !== []) {
            throw new RuntimeException('Choose valid SHS year groups.', 422);
        }
        $yearGroups = array_map(static fn(string $value): string => trim($value), $yearGroups);
        if (array_filter($yearGroups, static fn(string $value): bool =>
            $value !== '' && !in_array($value, ['SHS1', 'SHS2', 'SHS3'], true)
        ) !== []) {
            throw new RuntimeException('Choose valid SHS year groups.', 422);
        }
        $yearGroups = array_values(array_unique(array_filter(
            $yearGroups,
            static fn(string $value): bool => $value !== ''
        )));
        if (count($yearGroups) > 3) {
            throw new RuntimeException('Choose valid SHS year groups.', 422);
        }
        $yearOrder = ['SHS1', 'SHS2', 'SHS3'];
        usort($yearGroups, static fn(string $left, string $right): int =>
            array_search($left, $yearOrder, true) <=> array_search($right, $yearOrder, true)
        );
        $yearGroup = implode(',', $yearGroups);
        $resourceRole = trim((string)($metadata['resource_role'] ?? 'other'));
        $resourceTypeLabel = trim((string)($metadata['resource_type_label'] ?? ''));
        if (!in_array($resourceRole, ['auto', 'teacher_manual', 'learner_material', 'lesson_template', 'scheme_template', 'curriculum', 'other'], true)) {
            throw new RuntimeException('Choose a valid curriculum resource type.', 422);
        }
        if (mb_strlen($resourceTypeLabel, 'UTF-8') > 100) {
            throw new RuntimeException('Resource type must be 100 characters or fewer.', 422);
        }
        if ($resourceRole === 'other' && $resourceTypeLabel === '') {
            throw new RuntimeException('Specify the resource type when choosing Other resource.', 422);
        }
        $subjectName = trim((string)($metadata['subject_name'] ?? ''));
        if (mb_strlen($subjectName, 'UTF-8') > 190) {
            throw new RuntimeException('Subject name must be 190 characters or fewer.', 422);
        }

        $validated = [];
        $totalBytes = 0;
        for ($index = 0; $index < $count; $index++) {
            $errorValue = $uploads['error'][$index] ?? null;
            if (!is_int($errorValue) || !is_string($uploads['tmp_name'][$index] ?? null)
                || !is_string($uploads['name'][$index] ?? null)) {
                throw new RuntimeException('The upload request is malformed. Select the files again.', 422);
            }
            $error = $errorValue;
            if ($error !== UPLOAD_ERR_OK) {
                $message = match ($error) {
                    UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'A selected file exceeds the server upload limit.',
                    UPLOAD_ERR_PARTIAL => 'A selected file was only partially uploaded. Try again.',
                    UPLOAD_ERR_NO_FILE => 'A selected file was empty or could not be received.',
                    UPLOAD_ERR_NO_TMP_DIR, UPLOAD_ERR_CANT_WRITE => 'The server could not store the uploaded file.',
                    default => 'A selected file could not be uploaded.',
                };
                throw new RuntimeException($message, 422);
            }
            $temporaryPath = (string)($uploads['tmp_name'][$index] ?? '');
            $originalName = basename(str_replace('\\', '/', (string)($uploads['name'][$index] ?? '')));
            $originalName = preg_replace('/[\x00-\x1F\x7F]/u', '', $originalName) ?? '';
            $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
            if (!in_array($extension, ['pdf', 'txt', 'md', 'csv', 'docx'], true)) {
                throw new RuntimeException('Only PDF, DOCX, TXT, MD and CSV resource files are supported.', 422);
            }
            if ($temporaryPath === '' || ($trustedStagingRoot === null && !is_uploaded_file($temporaryPath))) {
                throw new RuntimeException('An uploaded file could not be safely validated. Please select it again.', 422);
            }
            if ($trustedStagingRoot !== null) {
                $resolvedTemporaryPath = realpath($temporaryPath);
                $stagingPrefix = rtrim($trustedStagingRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
                if ($resolvedTemporaryPath === false
                    || !str_starts_with(strtolower($resolvedTemporaryPath), strtolower($stagingPrefix))
                    || !is_file($resolvedTemporaryPath)) {
                    throw new RuntimeException('A staged resource file could not be safely validated.', 422);
                }
                $temporaryPath = $resolvedTemporaryPath;
            }
            $actualBytes = filesize($temporaryPath);
            if (!is_int($actualBytes) || $actualBytes < 1) {
                throw new RuntimeException('Empty resource files cannot be uploaded.', 422);
            }
            if ($actualBytes > self::MAX_FILE_BYTES) {
                throw new RuntimeException('Each resource file must be 80 MB or smaller.', 413);
            }
            $totalBytes += $actualBytes;
            if ($totalBytes > self::MAX_FILE_BYTES) {
                throw new RuntimeException('The combined upload must be 80 MB or smaller.', 413);
            }
            if ($extension === 'pdf') {
                $handle = fopen($temporaryPath, 'rb');
                $signature = $handle === false ? false : fread($handle, 1024);
                if (is_resource($handle)) {
                    fclose($handle);
                }
                if (!is_string($signature) || !str_contains($signature, '%PDF-')) {
                    throw new RuntimeException('A file selected as PDF does not contain a valid PDF signature.', 422);
                }
            } elseif ($extension === 'docx') {
                $handle = fopen($temporaryPath, 'rb');
                $signature = $handle === false ? false : fread($handle, 4);
                if (is_resource($handle)) {
                    fclose($handle);
                }
                if ($signature !== "PK\x03\x04") {
                    throw new RuntimeException('A file selected as DOCX does not contain a valid Office document signature.', 422);
                }
            }
            $validated[] = [
                'temporary_path' => $temporaryPath,
                'name' => mb_substr($originalName, 0, 255, 'UTF-8'),
                'extension' => $extension,
                'bytes' => $actualBytes,
            ];
        }

        $uploadDirectory = AKADEMI_STORAGE . DIRECTORY_SEPARATOR . 'curriculum'
            . DIRECTORY_SEPARATOR . 'uploads';
        if (!is_dir($uploadDirectory)
            && !mkdir($uploadDirectory, 0700, true)
            && !is_dir($uploadDirectory)) {
            throw new RuntimeException('Private curriculum upload storage could not be created.');
        }
        $root = realpath($uploadDirectory);
        if ($root === false || !is_dir($root) || !is_writable($root)) {
            throw new RuntimeException('Private curriculum upload storage is not writable.');
        }
        $webRoot = realpath((string)($_SERVER['DOCUMENT_ROOT'] ?? ''));
        if ($webRoot !== false) {
            $webRootPrefix = rtrim(str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $webRoot), DIRECTORY_SEPARATOR)
                . DIRECTORY_SEPARATOR;
            $uploadPrefix = rtrim(str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $root), DIRECTORY_SEPARATOR)
                . DIRECTORY_SEPARATOR;
            if (str_starts_with(strtolower($uploadPrefix), strtolower($webRootPrefix))) {
                throw new RuntimeException('Curriculum uploads must be stored outside the public web root.');
            }
        }

        $files = [];
        $storedPaths = [];
        try {
            foreach ($validated as $file) {
                $storedName = bin2hex(random_bytes(20)) . '.' . $file['extension'];
                $storedPath = $root . DIRECTORY_SEPARATOR . $storedName;
                $stored = $trustedStagingRoot === null
                    ? move_uploaded_file($file['temporary_path'], $storedPath)
                    : rename($file['temporary_path'], $storedPath);
                if (!$stored) {
                    throw new RuntimeException('The server could not store a curriculum upload.');
                }
                $storedPaths[] = $storedPath;
                if (!chmod($storedPath, 0600)) {
                    throw new RuntimeException('Private permissions could not be set on an uploaded file.');
                }
                $files[] = [
                    'path' => $storedPath,
                    'name' => $file['name'],
                    'extension' => $file['extension'],
                    'bytes' => $file['bytes'],
                    'year_group' => $yearGroup !== ''
                        ? $yearGroup
                        : $this->inferYearGroup($file['name'], $file['name'], $root),
                    'resource_role' => $resourceRole === 'auto'
                        ? $this->inferResourceRole($file['name'])
                        : $resourceRole,
                    'resource_type_label' => $resourceRole === 'other' ? $resourceTypeLabel : null,
                ];
            }
        } catch (Throwable $exception) {
            foreach ($storedPaths as $storedPath) {
                if (is_file($storedPath)) {
                    unlink($storedPath);
                }
            }
            throw $exception;
        }
        $result = $this->import($root, $files, true, $actorUserId, $subjectName, true, true);

        $duplicateNames = [];
        foreach ($files as $index => $file) {
            if (($result['documents'][$index]['status'] ?? '') === 'already_imported'
                && is_file($file['path'])) {
                unlink($file['path']);
            }
        }
        return $result;
    }

    public function uploadStagedFiles(
        array $files,
        array $metadata,
        int $actorUserId,
        string $stagingDirectory
    ): array {
        $stagingRoot = realpath(AKADEMI_STORAGE . DIRECTORY_SEPARATOR . 'curriculum'
            . DIRECTORY_SEPARATOR . 'upload-staging');
        $resolvedDirectory = realpath($stagingDirectory);
        if ($stagingRoot === false || $resolvedDirectory === false
            || !str_starts_with(
                strtolower(rtrim($resolvedDirectory, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR),
                strtolower(rtrim($stagingRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR)
            )) {
            throw new RuntimeException('The staged upload location is not available.', 422);
        }
        if ($files === [] || count($files) > self::MAX_UPLOAD_FILES) {
            throw new RuntimeException('Upload between 1 and 10 resource files at a time.', 422);
        }
        $uploads = ['name' => [], 'tmp_name' => [], 'error' => [], 'size' => []];
        foreach ($files as $file) {
            if (!is_array($file) || !is_string($file['path'] ?? null) || !is_string($file['name'] ?? null)) {
                throw new RuntimeException('The staged upload is malformed. Start the upload again.', 422);
            }
            $uploads['name'][] = $file['name'];
            $uploads['tmp_name'][] = $file['path'];
            $uploads['error'][] = UPLOAD_ERR_OK;
            $uploads['size'][] = 0;
        }
        return $this->upload($uploads, $metadata, $actorUserId, $resolvedDirectory);
    }

    public function processQueuedUpload(int $documentId): array
    {
        $pdo = Connection::get();
        $statement = $pdo->prepare(
            'SELECT source_id, uploaded_by, subject_name, title, year_group, resource_role, resource_type_label,
                    original_filename, extraction_status
             FROM curriculum_documents WHERE id = :id LIMIT 1'
        );
        $statement->execute(['id' => $documentId]);
        $document = $statement->fetch();
        if (!$document) {
            throw new RuntimeException('The uploaded teaching resource was not found.', 404);
        }
        if (!in_array($document['extraction_status'], ['queued', 'failed'], true)) {
            return [
                'document_id' => $documentId,
                'name' => (string)$document['original_filename'],
                'status' => (string)$document['extraction_status'],
            ];
        }
        if (!is_int($document['source_id']) && !ctype_digit((string)$document['source_id'])) {
            throw new RuntimeException('The uploaded resource is missing its source record.', 500);
        }

        $file = (new CurriculumReviewService())->originalResource($documentId);
        $extension = strtolower(pathinfo($file['filename'], PATHINFO_EXTENSION));
        if (!in_array($extension, ['pdf', 'txt', 'md', 'csv', 'docx'], true)) {
            throw new RuntimeException('The stored teaching resource has an unsupported file type.', 415);
        }
        $uploadRoot = realpath(AKADEMI_STORAGE . DIRECTORY_SEPARATOR . 'curriculum' . DIRECTORY_SEPARATOR . 'uploads');
        if ($uploadRoot === false) {
            throw new RuntimeException('Private curriculum upload storage is not available.', 404);
        }

        $pdo->beginTransaction();
        try {
            $claim = $pdo->prepare(
                'SELECT extraction_status FROM curriculum_documents WHERE id = :id FOR UPDATE'
            );
            $claim->execute(['id' => $documentId]);
            $status = $claim->fetchColumn();
            if (!in_array($status, ['queued', 'failed'], true)) {
                $pdo->commit();
                return [
                    'document_id' => $documentId,
                    'name' => (string)$document['original_filename'],
                    'status' => is_string($status) ? $status : 'missing',
                ];
            }
            $pdo->prepare(
                "UPDATE curriculum_documents SET extraction_status = 'processing', extraction_error = NULL
                 WHERE id = :id"
            )->execute(['id' => $documentId]);
            $job = $pdo->prepare(
                "UPDATE curriculum_ingestion_jobs SET status = 'processing', attempts = attempts + 1,
                 error_message = NULL, started_at = UTC_TIMESTAMP(), completed_at = NULL
                 WHERE document_id = :id"
            );
            $job->execute(['id' => $documentId]);
            if ($job->rowCount() === 0) {
                $pdo->prepare(
                    "INSERT INTO curriculum_ingestion_jobs (document_id, status, attempts, started_at)
                     VALUES (:id, 'processing', 1, UTC_TIMESTAMP())"
                )->execute(['id' => $documentId]);
            }
            $pdo->commit();
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }

        $result = $this->import(
            $uploadRoot,
            [[
                'path' => $file['path'],
                'name' => $file['filename'],
                'extension' => $extension,
                'bytes' => $file['bytes'],
                'year_group' => (string)$document['year_group'],
                'resource_role' => (string)$document['resource_role'],
                'resource_type_label' => $document['resource_type_label'],
            ]],
            true,
            $document['uploaded_by'] === null ? null : (int)$document['uploaded_by'],
            (string)($document['subject_name'] ?? ''),
            false,
            false,
            (int)$document['source_id']
        );
        $processed = $result['documents'][0] ?? [
            'name' => (string)$document['original_filename'],
            'status' => 'failed',
        ];
        $processed['document_id'] = $documentId;
        return $processed;
    }

    private function import(
        string $root,
        array $files,
        bool $retryIncomplete,
        ?int $actorUserId = null,
        string $subjectName = '',
        bool $retryFailedOnly = false,
        bool $deferExtraction = false,
        ?int $existingSourceId = null
    ): array
    {
        $pdo = Connection::get();
        $sourceId = $existingSourceId;
        if ($sourceId === null) {
            $pdo->beginTransaction();
            try {
                $sourceStatement = $pdo->prepare(
                    "INSERT INTO curriculum_sources (name, publisher, source_kind, attribution, created_by)
                     VALUES (:name, :publisher, 'teacher_supplied', :attribution, :created_by)"
                );
                $sourceStatement->execute([
                    'name' => ($actorUserId === null ? 'Locally supplied curriculum resource scan ' : 'Admin curriculum upload ')
                        . gmdate('Y-m-d H:i:s'),
                    'publisher' => null,
                    'attribution' => 'Local files supplied for teacher review. Verify publisher, licensing, document version and source before marking content as verified.',
                    'created_by' => $actorUserId,
                ]);
                $sourceId = (int)$pdo->lastInsertId();
                if ($actorUserId !== null) {
                    $pdo->prepare(
                        "INSERT INTO audit_logs (actor_user_id, action_name, target_type, target_id, metadata)
                         VALUES (:actor, 'curriculum.uploaded', 'curriculum_source', :target_id, :metadata)"
                    )->execute([
                        'actor' => $actorUserId,
                        'target_id' => (string)$sourceId,
                        'metadata' => json_encode([
                            'file_count' => count($files),
                            'total_bytes' => array_sum(array_column($files, 'bytes')),
                        ], JSON_THROW_ON_ERROR),
                    ]);
                }
                $pdo->commit();
            } catch (Throwable $exception) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $exception;
            }
        }

        $results = ['imported' => 0, 'duplicate' => 0, 'too_large' => 0, 'failed' => 0, 'documents' => []];
        $activeDocumentId = null;
        $memoryReserve = str_repeat(' ', 1024 * 1024);
        register_shutdown_function(static function () use (&$activeDocumentId, &$memoryReserve, $pdo): void {
            $error = error_get_last();
            if (!is_int($activeDocumentId) || !is_array($error)
                || !in_array($error['type'], [E_ERROR, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
                return;
            }
            unset($memoryReserve);
            try {
                $pdo->prepare(
                    "UPDATE curriculum_documents SET extraction_status = 'failed',
                 extraction_error = 'Text extraction stopped unexpectedly; increase PHP memory and retry, or use OCR for scanned pages.'
                     WHERE id = :id"
                )->execute(['id' => $activeDocumentId]);
                $pdo->prepare(
                    "UPDATE curriculum_ingestion_jobs SET status = 'failed',
                 error_message = 'Text extraction stopped unexpectedly; increase PHP memory and retry, or use OCR for scanned pages.',
                     completed_at = UTC_TIMESTAMP()
                     WHERE document_id = :id"
                )->execute(['id' => $activeDocumentId]);
            } catch (Throwable $exception) {
                error_log('Failed to record interrupted curriculum extraction: ' . $exception::class);
            }
        });
        foreach ($files as $file) {
            if ($file['bytes'] > self::MAX_FILE_BYTES) {
                $results['too_large']++;
                $results['documents'][] = ['name' => $file['name'], 'status' => 'skipped_over_80mb'];
                continue;
            }
            $documentId = null;
            try {
                $hash = hash_file('sha256', $file['path']);
                if (!is_string($hash)) {
                    throw new RuntimeException('The file could not be read to calculate its fingerprint.');
                }
                $duplicate = $pdo->prepare(
                    'SELECT id, extraction_status, source_path FROM curriculum_documents WHERE sha256 = :hash LIMIT 1'
                );
                $duplicate->execute(['hash' => $hash]);
                $existing = $duplicate->fetch();
                if ($existing) {
                    $retryStatuses = $retryFailedOnly ? ['failed'] : ['queued', 'failed', 'processing'];
                    if (!$retryIncomplete || !in_array($existing['extraction_status'], $retryStatuses, true)) {
                        $results['duplicate']++;
                        $results['documents'][] = ['name' => $file['name'], 'status' => 'already_imported'];
                        continue;
                    }
                    $documentId = (int)$existing['id'];
                    $previousPath = null;
                    $previousRelativePath = (string)($existing['source_path'] ?? '');
                    if ($previousRelativePath !== '') {
                        $previousCandidate = $root . DIRECTORY_SEPARATOR
                            . str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $previousRelativePath);
                        $resolvedPreviousPath = realpath($previousCandidate);
                        $rootPrefix = rtrim($root, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
                        if ($resolvedPreviousPath !== false
                            && str_starts_with(strtolower($resolvedPreviousPath), strtolower($rootPrefix))
                            && is_file($resolvedPreviousPath)) {
                            $previousPath = $resolvedPreviousPath;
                        }
                    }
                    $pdo->beginTransaction();
                    try {
                        $pdo->prepare('DELETE FROM curriculum_chunks WHERE document_id = :id')
                            ->execute(['id' => $documentId]);
                        $pdo->prepare('DELETE FROM curriculum_sections WHERE document_id = :id')
                            ->execute(['id' => $documentId]);
                        $pdo->prepare(
                            "UPDATE curriculum_documents SET source_id = :source_id, uploaded_by = :uploaded_by,
                             subject_name = :subject_name, title = :title,
                             year_group = :year_group, resource_role = :resource_role,
                             resource_type_label = :resource_type_label, source_path = :source_path,
                             original_filename = :filename, mime_type = :mime_type, extraction_status = :status,
                             extraction_error = NULL, updated_at = UTC_TIMESTAMP() WHERE id = :id"
                        )->execute([
                            'source_id' => $sourceId,
                            'uploaded_by' => $actorUserId,
                            'subject_name' => $subjectName !== '' ? $subjectName : null,
                            'title' => $file['name'],
                            'year_group' => $file['year_group'],
                            'resource_role' => $file['resource_role'],
                            'resource_type_label' => $file['resource_type_label'] ?? null,
                            'source_path' => ltrim(substr($file['path'], strlen($root)), '\\/'),
                            'filename' => $file['name'],
                            'mime_type' => $this->mimeType($file['path'], $file['extension']),
                            'status' => $deferExtraction ? 'queued' : 'processing',
                            'id' => $documentId,
                        ]);
                        $jobUpdate = $pdo->prepare(
                            "UPDATE curriculum_ingestion_jobs SET status = :status, attempts = attempts + 1,
                             error_message = NULL,
                             started_at = CASE WHEN :started_status = 'queued' THEN NULL ELSE UTC_TIMESTAMP() END,
                             completed_at = NULL
                             WHERE document_id = :id"
                        );
                        $jobUpdate->execute([
                            'status' => $deferExtraction ? 'queued' : 'processing',
                            'started_status' => $deferExtraction ? 'queued' : 'processing',
                            'id' => $documentId,
                        ]);
                        if ($jobUpdate->rowCount() === 0) {
                            $pdo->prepare(
                                "INSERT INTO curriculum_ingestion_jobs (document_id, status, started_at)
                                 VALUES (:id, :status, CASE WHEN :started_status = 'queued' THEN NULL ELSE UTC_TIMESTAMP() END)"
                            )->execute([
                                'id' => $documentId,
                                'status' => $deferExtraction ? 'queued' : 'processing',
                                'started_status' => $deferExtraction ? 'queued' : 'processing',
                            ]);
                        }
                        $pdo->commit();
                    } catch (Throwable $exception) {
                        if ($pdo->inTransaction()) {
                            $pdo->rollBack();
                        }
                        throw $exception;
                    }
                    if ($previousPath !== null && $previousPath !== $file['path'] && !unlink($previousPath)) {
                        write_log('warning', 'Could not remove superseded curriculum upload after retry', [
                            'document_id' => $documentId,
                        ]);
                    }
                    $activeDocumentId = $documentId;
                } else {
                    $relativePath = ltrim(substr($file['path'], strlen($root)), '\\/');
                    $document = $pdo->prepare(
                        "INSERT INTO curriculum_documents
                         (source_id, uploaded_by, subject_name, title, year_group, resource_role, resource_type_label, version_label, source_path,
                          original_filename, mime_type, sha256, extraction_status, review_status)
                         VALUES (:source_id, :uploaded_by, :subject_name, :title, :year_group, :resource_role, :resource_type_label, NULL, :source_path,
                                 :filename, :mime_type, :sha256, 'queued', 'unreviewed')"
                    );
                    $document->execute([
                        'source_id' => $sourceId,
                        'uploaded_by' => $actorUserId,
                        'subject_name' => $subjectName !== '' ? $subjectName : null,
                        'title' => $file['name'],
                        'year_group' => $file['year_group'],
                        'resource_role' => $file['resource_role'],
                        'resource_type_label' => $file['resource_type_label'] ?? null,
                        'source_path' => $relativePath,
                        'filename' => $file['name'],
                        'mime_type' => $this->mimeType($file['path'], $file['extension']),
                        'sha256' => $hash,
                    ]);
                    $documentId = (int)$pdo->lastInsertId();
                    $job = $pdo->prepare(
                        "INSERT INTO curriculum_ingestion_jobs (document_id, status) VALUES (:document_id, 'queued')"
                    );
                    $job->execute(['document_id' => $documentId]);
                    $pdo->prepare(
                        'UPDATE curriculum_documents SET extraction_status = :status WHERE id = :id'
                    )->execute([
                        'status' => $deferExtraction ? 'queued' : 'processing',
                        'id' => $documentId,
                    ]);
                    if (!$deferExtraction) {
                        $pdo->prepare(
                            "UPDATE curriculum_ingestion_jobs SET status = 'processing', started_at = UTC_TIMESTAMP()
                             WHERE document_id = :id"
                        )->execute(['id' => $documentId]);
                    }
                    $activeDocumentId = $documentId;
                }
                if ($deferExtraction) {
                    $results['imported']++;
                    $results['documents'][] = [
                        'name' => $file['name'],
                        'status' => 'queued',
                        'document_id' => $documentId,
                    ];
                    $activeDocumentId = null;
                    continue;
                }
                $pages = $this->extractText($file['path'], $file['extension']);
                $chunks = $this->chunks($pages);
                $omittedUnreadablePdfText = false;
                if ($file['extension'] === 'pdf') {
                    $filteredChunks = array_values(array_filter(
                        $chunks,
                        fn(array $chunk): bool => $this->isReadableExtractedText((string)$chunk['content'])
                    ));
                    $omittedUnreadablePdfText = count($filteredChunks) !== count($chunks);
                    $chunks = $filteredChunks;
                }
                if ($chunks === []) {
                    $pdo->prepare(
                        "UPDATE curriculum_documents SET extraction_status = 'needs_ocr',
                         extraction_error = 'No selectable text found; OCR and human review are required.'
                         WHERE id = :id"
                    )->execute(['id' => $documentId]);
                    $pdo->prepare(
                        "UPDATE curriculum_ingestion_jobs SET status = 'needs_ocr', completed_at = UTC_TIMESTAMP()
                         WHERE document_id = :id"
                    )->execute(['id' => $documentId]);
                    $results['documents'][] = ['name' => $file['name'], 'status' => 'needs_ocr'];
                    $results['imported']++;
                    $activeDocumentId = null;
                    continue;
                }
                $pdo->beginTransaction();
                try {
                    $section = $pdo->prepare(
                        "INSERT INTO curriculum_sections (document_id, section_type, title, body, review_status)
                         VALUES (:document_id, 'document', :title, :body, 'unreviewed')"
                    );
                    $section->execute([
                        'document_id' => $documentId,
                        'title' => $file['name'],
                        'body' => 'Automatically extracted text. Document structure and curriculum accuracy have not been verified.',
                    ]);
                    $sectionId = (int)$pdo->lastInsertId();
                    $insertChunk = $pdo->prepare(
                        'INSERT INTO curriculum_chunks
                         (document_id, section_id, chunk_index, page_start, page_end, content, content_sha256)
                         VALUES (:document_id, :section_id, :chunk_index, :page_start, :page_end, :content, :content_sha256)'
                    );
                    foreach ($chunks as $index => $chunk) {
                        $insertChunk->execute([
                            'document_id' => $documentId,
                            'section_id' => $sectionId,
                            'chunk_index' => $index,
                            'page_start' => $chunk['page'],
                            'page_end' => $chunk['page'],
                            'content' => $chunk['content'],
                            'content_sha256' => hash('sha256', $chunk['content']),
                        ]);
                    }
                    $pdo->prepare(
                        "UPDATE curriculum_documents SET extraction_status = 'extracted',
                         extraction_error = :extraction_error WHERE id = :id"
                    )->execute([
                        'extraction_error' => $omittedUnreadablePdfText
                            ? 'Some PDF pages were omitted because text extraction was unreadable. Review the original PDF for exact content.'
                            : null,
                        'id' => $documentId,
                    ]);
                    $pdo->prepare(
                        "UPDATE curriculum_ingestion_jobs SET status = 'completed', completed_at = UTC_TIMESTAMP()
                         WHERE document_id = :id"
                    )->execute(['id' => $documentId]);
                    $pdo->commit();
                } catch (Throwable $exception) {
                    if ($pdo->inTransaction()) {
                        $pdo->rollBack();
                    }
                    throw $exception;
                }
                $results['imported']++;
                $results['documents'][] = ['name' => $file['name'], 'status' => 'extracted', 'document_id' => $documentId, 'chunks' => count($chunks)];
                $activeDocumentId = null;
            } catch (Throwable $exception) {
                $results['failed']++;
                $failureMessage = $this->extractionFailureMessage($exception);
                if (is_int($documentId)) {
                    $pdo->prepare(
                        "UPDATE curriculum_documents SET extraction_status = 'failed',
                         extraction_error = :extraction_error
                         WHERE id = :id"
                    )->execute(['extraction_error' => $failureMessage, 'id' => $documentId]);
                    $pdo->prepare(
                        "UPDATE curriculum_ingestion_jobs SET status = 'failed',
                         error_message = :error_message,
                         completed_at = UTC_TIMESTAMP()
                         WHERE document_id = :id"
                    )->execute(['error_message' => $failureMessage, 'id' => $documentId]);
                }
                write_log('error', 'Curriculum document extraction failed', [
                    'file_name' => $file['name'],
                    'exception' => $exception::class,
                    'error' => $failureMessage,
                ]);
                $results['documents'][] = [
                    'name' => $file['name'],
                    'status' => 'failed',
                    'error' => $failureMessage,
                ];
            } finally {
                $activeDocumentId = null;
                unset($pages, $chunks);
                gc_collect_cycles();
            }
        }
        return $results;
    }

    private function extractText(string $path, string $extension): array
    {
        if ($extension === 'pdf') {
            if (!class_exists(\Smalot\PdfParser\Parser::class)) {
                throw new RuntimeException('PDF extraction package missing. Run composer install.');
            }
            $currentMemoryLimit = ini_get('memory_limit');
            if ($currentMemoryLimit !== false && $this->memoryLimitBytes($currentMemoryLimit) < 768 * 1024 * 1024) {
                ini_set('memory_limit', '768M');
            }
            $currentMemoryLimit = ini_get('memory_limit');
            if ($currentMemoryLimit === false || $this->memoryLimitBytes($currentMemoryLimit) < 768 * 1024 * 1024) {
                throw new RuntimeException('PDF extraction requires PHP memory_limit of at least 768M. Increase the server limit and retry.');
            }
            $config = new \Smalot\PdfParser\Config();
            $config->setRetainImageContent(false);
            $config->setDecodeMemoryLimit(128 * 1024 * 1024);
            $parser = new \Smalot\PdfParser\Parser([], $config);
            $document = $parser->parseFile($path);
            $pages = [];
            foreach ($document->getPages() as $index => $page) {
                $text = $this->normalizeText($page->getText());
                if ($text !== '') {
                    $pages[] = ['page' => $index + 1, 'text' => $text];
                }
            }
            return $pages;
        }
        if ($extension === 'docx') {
            $text = $this->extractDocxText($path);
            return $text === '' ? [] : [['page' => 1, 'text' => $text]];
        }
        $content = file_get_contents($path);
        if ($content === false) {
            throw new RuntimeException('The source file could not be read.');
        }
        if ($extension === 'csv') {
            $rows = [];
            foreach (preg_split('/\r\n|\r|\n/', $content) ?: [] as $line) {
                $cells = str_getcsv($line);
                if (array_filter($cells, static fn(string $cell): bool => trim($cell) !== '') !== []) {
                    $rows[] = implode(' | ', $cells);
                }
            }
            $content = implode("\n", $rows);
        }
        if ($extension === 'html') {
            $content = html_entity_decode(strip_tags($content), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        }
        $content = $this->normalizeText($content);
        return $content === '' ? [] : [['page' => 1, 'text' => $content]];
    }

    private function memoryLimitBytes(string $value): int
    {
        $value = trim($value);
        if ($value === '' || $value === '-1') {
            return PHP_INT_MAX;
        }
        $unit = strtolower(substr($value, -1));
        $amount = (int)$value;
        return match ($unit) {
            'g' => $amount * 1024 * 1024 * 1024,
            'm' => $amount * 1024 * 1024,
            'k' => $amount * 1024,
            default => $amount,
        };
    }

    private function extractionFailureMessage(Throwable $exception): string
    {
        $message = trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $exception->getMessage()) ?? '');
        if (stripos($message, 'memory') !== false
            || stripos($message, 'allowed memory size') !== false) {
            return 'PDF text extraction ran out of server memory. Set PHP memory_limit to at least 768M, then retry extraction.';
        }
        if ($exception instanceof \PDOException) {
            return 'Extracted text could not be saved to the database. Check database connectivity and retry extraction.';
        }
        return mb_substr($message !== '' ? $message : 'The file could not be processed.', 0, 450, 'UTF-8');
    }

    private function extractDocxText(string $path): string
    {
        $bytes = file_get_contents($path);
        if (!is_string($bytes) || strlen($bytes) < 22) {
            throw new RuntimeException('The DOCX template is empty or unreadable.');
        }
        $read16 = static fn(string $buffer, int $offset): int => unpack('vvalue', substr($buffer, $offset, 2))['value'];
        $read32 = static fn(string $buffer, int $offset): int => unpack('Vvalue', substr($buffer, $offset, 4))['value'];
        $eocdOffset = strrpos(substr($bytes, max(0, strlen($bytes) - 65557)), "PK\x05\x06");
        if ($eocdOffset === false) {
            throw new RuntimeException('The DOCX file is not a valid ZIP-based Office document.');
        }
        $eocdOffset += max(0, strlen($bytes) - 65557);
        if ($eocdOffset + 22 > strlen($bytes)) {
            throw new RuntimeException('The DOCX file has an incomplete ZIP directory.');
        }
        $entryCount = $read16($bytes, $eocdOffset + 10);
        $directoryOffset = $read32($bytes, $eocdOffset + 16);
        if ($entryCount > 10000 || $directoryOffset >= strlen($bytes)) {
            throw new RuntimeException('The DOCX file has an invalid or unsupported ZIP directory.');
        }
        $xml = null;
        $cursor = $directoryOffset;
        for ($entryIndex = 0; $entryIndex < $entryCount; $entryIndex++) {
            if (substr($bytes, $cursor, 4) !== "PK\x01\x02" || $cursor + 46 > strlen($bytes)) {
                throw new RuntimeException('The DOCX file has a malformed ZIP entry.');
            }
            $flags = $read16($bytes, $cursor + 8);
            $method = $read16($bytes, $cursor + 10);
            $compressedSize = $read32($bytes, $cursor + 20);
            $uncompressedSize = $read32($bytes, $cursor + 24);
            $nameLength = $read16($bytes, $cursor + 28);
            $extraLength = $read16($bytes, $cursor + 30);
            $commentLength = $read16($bytes, $cursor + 32);
            $localOffset = $read32($bytes, $cursor + 42);
            $name = substr($bytes, $cursor + 46, $nameLength);
            $cursor += 46 + $nameLength + $extraLength + $commentLength;
            if ($name !== 'word/document.xml') {
                continue;
            }
            if (($flags & 1) !== 0 || !in_array($method, [0, 8], true)
                || $uncompressedSize < 1 || $uncompressedSize > 16 * 1024 * 1024
                || $compressedSize < 1 || $compressedSize > strlen($bytes)
                || $uncompressedSize > max(1, $compressedSize) * 100
                || substr($bytes, $localOffset, 4) !== "PK\x03\x04"
                || $localOffset + 30 > strlen($bytes)) {
                throw new RuntimeException('The DOCX main document part is encrypted, too large or unsupported.');
            }
            $localNameLength = $read16($bytes, $localOffset + 26);
            $localExtraLength = $read16($bytes, $localOffset + 28);
            $dataOffset = $localOffset + 30 + $localNameLength + $localExtraLength;
            $compressed = substr($bytes, $dataOffset, $compressedSize);
            if (strlen($compressed) !== $compressedSize) {
                throw new RuntimeException('The DOCX main document part is truncated.');
            }
            $xml = $method === 0 ? $compressed : gzinflate($compressed, 16 * 1024 * 1024);
            if (!is_string($xml) || strlen($xml) !== $uncompressedSize) {
                throw new RuntimeException('The DOCX main document part could not be safely decompressed.');
            }
            break;
        }
        if (!is_string($xml)) {
            throw new RuntimeException('This DOCX file does not contain a Word document body.');
        }
        $document = new \DOMDocument();
        $previousErrors = libxml_use_internal_errors(true);
        try {
            if (!$document->loadXML($xml, LIBXML_NONET | LIBXML_COMPACT)) {
                throw new RuntimeException('The DOCX document body contains invalid XML.');
            }
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previousErrors);
        }
        $body = $document->getElementsByTagNameNS(
            'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
            'body'
        )->item(0);
        if (!$body) {
            throw new RuntimeException('The DOCX file does not contain a readable Word document body.');
        }
        $paragraphTexts = [];
        foreach ($body->childNodes as $block) {
            if ($block->localName === 'p') {
                $paragraphTexts[] = $this->docxNodeText($block);
            } elseif ($block->localName === 'tbl') {
                $tableRows = [];
                foreach ($block->childNodes as $row) {
                    if ($row->localName !== 'tr') {
                        continue;
                    }
                    $cells = [];
                    foreach ($row->childNodes as $cell) {
                        if ($cell->localName === 'tc') {
                            $cellText = trim($this->docxNodeText($cell));
                            $cellText = preg_replace('/\s*\n+\s*/u', ' / ', $cellText) ?? $cellText;
                            $cells[] = str_replace(['\\', '|'], ['\\\\', '\\|'], $cellText);
                        }
                    }
                    if ($cells !== []) {
                        $tableRows[] = $cells;
                    }
                }
                if ($tableRows !== []) {
                    $columnCount = max(array_map('count', $tableRows));
                    $rows = [];
                    foreach ($tableRows as $index => $cells) {
                        $cells = array_pad($cells, $columnCount, '');
                        $rows[] = '| ' . implode(' | ', $cells) . ' |';
                        if ($index === 0) {
                            $rows[] = '| ' . implode(' | ', array_fill(0, $columnCount, '---')) . ' |';
                        }
                    }
                    $paragraphTexts[] = implode("\n", $rows) . "\n";
                }
            }
        }
        return $this->normalizeText(implode("\n", array_filter(
            $paragraphTexts,
            static fn(string $paragraph): bool => trim($paragraph) !== ''
        )));
    }

    private function docxNodeText(\DOMNode $node): string
    {
        if ($node instanceof \DOMText) {
            return $node->nodeValue ?? '';
        }
        if ($node instanceof \DOMElement) {
            if ($node->localName === 'tab') {
                return "\t";
            }
            if ($node->localName === 'br' || $node->localName === 'cr') {
                return "\n";
            }
        }
        $text = '';
        foreach ($node->childNodes as $child) {
            $text .= $this->docxNodeText($child);
        }
        if ($node instanceof \DOMElement && $node->localName === 'p') {
            $text .= "\n";
        }
        return $text;
    }

    private function chunks(array $pages): array
    {
        $chunks = [];
        foreach ($pages as $page) {
            $paragraphs = preg_split('/\n{2,}/u', $page['text']) ?: [$page['text']];
            $buffer = '';
            foreach ($paragraphs as $paragraph) {
                $paragraph = trim($paragraph);
                if ($paragraph === '') {
                    continue;
                }
                $tableLines = explode("\n", $paragraph);
                $isMarkdownTable = count($tableLines) > 1
                    && str_contains($tableLines[0], '|')
                    && preg_match('/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u', $tableLines[1]) === 1;
                if ($isMarkdownTable) {
                    if ($buffer !== '') {
                        $chunks[] = ['page' => $page['page'], 'content' => trim($buffer)];
                        $buffer = '';
                    }
                    $tableBuffer = $tableLines[0] . "\n" . $tableLines[1];
                    foreach (array_slice($tableLines, 2) as $row) {
                        if (mb_strlen($tableBuffer . "\n" . $row, 'UTF-8') > self::CHUNK_SIZE
                            && $tableBuffer !== $tableLines[0] . "\n" . $tableLines[1]) {
                            $chunks[] = ['page' => $page['page'], 'content' => $tableBuffer];
                            $tableBuffer = $tableLines[0] . "\n" . $tableLines[1];
                        }
                        $tableBuffer .= "\n" . $row;
                    }
                    $chunks[] = ['page' => $page['page'], 'content' => $tableBuffer];
                    continue;
                }
                if (mb_strlen($paragraph, 'UTF-8') > self::CHUNK_SIZE) {
                    if ($buffer !== '') {
                        $chunks[] = ['page' => $page['page'], 'content' => trim($buffer)];
                        $buffer = '';
                    }
                    for ($offset = 0; $offset < mb_strlen($paragraph, 'UTF-8'); $offset += self::CHUNK_SIZE) {
                        $piece = trim(mb_substr($paragraph, $offset, self::CHUNK_SIZE, 'UTF-8'));
                        if ($piece !== '') {
                            $chunks[] = ['page' => $page['page'], 'content' => $piece];
                        }
                    }
                    continue;
                }
                if ($buffer !== '' && mb_strlen($buffer . "\n\n" . $paragraph, 'UTF-8') > self::CHUNK_SIZE) {
                    $chunks[] = ['page' => $page['page'], 'content' => trim($buffer)];
                    $buffer = '';
                }
                $buffer = $buffer === '' ? $paragraph : $buffer . "\n\n" . $paragraph;
            }
            if ($buffer !== '') {
                $chunks[] = ['page' => $page['page'], 'content' => trim($buffer)];
            }
        }
        return $chunks;
    }

    private function normalizeText(string $text): string
    {
        $text = mb_convert_encoding($text, 'UTF-8', 'UTF-8');
        $text = str_replace(["\0", "\r"], ['', "\n"], $text);
        $text = preg_replace('/[\t ]+/u', ' ', $text) ?? $text;
        $text = preg_replace('/\n[ \t]+/u', "\n", $text) ?? $text;
        $text = preg_replace('/\n{3,}/u', "\n\n", $text) ?? $text;
        return trim($text);
    }

    private function isReadableExtractedText(string $text): bool
    {
        $characters = max(1, mb_strlen($text, 'UTF-8'));
        preg_match_all('/\x{FFFD}/u', $text, $replacementMatches);
        preg_match_all('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $text, $controlMatches);
        return count($replacementMatches[0]) / $characters <= 0.01
            && count($controlMatches[0]) / $characters <= 0.01;
    }

    private function mimeType(string $path, string $extension): string
    {
        if ($extension === 'docx') {
            return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        }
        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file($path);
        return is_string($mime) ? $mime : match ($extension) {
            'pdf' => 'application/pdf',
            'csv' => 'text/csv',
            default => 'text/plain',
        };
    }

    private function inferYearGroup(string $filename, string $fullPath, string $root): ?string
    {
        $source = strtoupper($filename . ' ' . substr($fullPath, strlen($root)));
        if (preg_match('/(?:^|[^A-Z0-9])(?:SHS|YEAR|Y)[\s_.-]*(1|2|3|ONE|TWO|THREE)(?=$|[^A-Z0-9])/u', $source, $matches)) {
            $year = ['ONE' => '1', 'TWO' => '2', 'THREE' => '3'][$matches[1]] ?? $matches[1];
            return 'SHS' . $year;
        }
        if (preg_match('/(?:^|[^A-Z0-9])(1|2|3|ONE|TWO|THREE)(?=\.[A-Z0-9]+$)/u', strtoupper($filename), $matches)) {
            $year = ['ONE' => '1', 'TWO' => '2', 'THREE' => '3'][$matches[1]] ?? $matches[1];
            return 'SHS' . $year;
        }
        if (preg_match('/(?:^|[_\-\s])([123])(?:[_\-\s.]|$)/u', strtoupper($filename), $matches)) {
            return 'SHS' . $matches[1];
        }
        return null;
    }

    private function inferResourceRole(string $filename): string
    {
        if (preg_match('/lesson.*(?:plan)?.*template|template.*lesson/i', $filename)) {
            return 'lesson_template';
        }
        if (preg_match('/scheme.*(?:of.?work)?.*template|template.*scheme/i', $filename)) {
            return 'scheme_template';
        }
        if (preg_match('/teacher|manual|(?:^|[^A-Z0-9])(?:tm|tv)(?=$|[^A-Z0-9])/i', $filename)) {
            return 'teacher_manual';
        }
        if (preg_match('/learner|student|book|(?:^|[^A-Z0-9])lm(?=$|[^A-Z0-9])/i', $filename)) {
            return 'learner_material';
        }
        return 'other';
    }
}
