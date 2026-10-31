<?php
declare(strict_types=1);

namespace Akademi\Services;

use Akademi\Database\Connection;
use RuntimeException;

final class CurriculumReviewService
{
    private const PAGE_SIZE = 10;

    public function documents(int $page = 1, array $filters = []): array
    {
        $page = max(1, $page);
        $offset = ($page - 1) * self::PAGE_SIZE;
        $query = mb_substr(trim((string)($filters['q'] ?? '')), 0, 190, 'UTF-8');
        $yearGroups = $filters['year_groups'] ?? ($filters['year_group'] ?? []);
        $resourceRoles = $filters['resource_roles'] ?? ($filters['resource_role'] ?? []);
        $yearGroups = is_array($yearGroups) ? $yearGroups : [$yearGroups];
        $resourceRoles = is_array($resourceRoles) ? $resourceRoles : [$resourceRoles];
        $reviewStatus = (string)($filters['review_status'] ?? '');
        $extractionStatus = (string)($filters['extraction_status'] ?? '');
        foreach ($yearGroups as $value) {
            if (!is_string($value) || ($value !== '' && !in_array($value, ['SHS1', 'SHS2', 'SHS3'], true))) {
                throw new RuntimeException('Choose valid resource search filters.', 422);
            }
        }
        foreach ($resourceRoles as $value) {
            if (!is_string($value) || ($value !== '' && !in_array($value, ['teacher_manual', 'learner_material', 'lesson_template', 'scheme_template', 'curriculum', 'other'], true))) {
                throw new RuntimeException('Choose valid resource search filters.', 422);
            }
        }
        $yearGroups = array_values(array_unique(array_filter($yearGroups, static fn(string $value): bool => $value !== '')));
        $resourceRoles = array_values(array_unique(array_filter($resourceRoles, static fn(string $value): bool => $value !== '')));
        if (count($yearGroups) > 3
            || count($resourceRoles) > 6
            || !in_array($reviewStatus, ['', 'unreviewed', 'in_review', 'verified', 'rejected'], true)
            || !in_array($extractionStatus, ['', 'queued', 'processing', 'extracted', 'needs_ocr', 'failed'], true)) {
            throw new RuntimeException('Choose valid resource search filters.', 422);
        }
        $conditions = [];
        $parameters = [];
        if ($query !== '') {
            $conditions[] = '(d.title LIKE :query_title OR d.subject_name LIKE :query_subject OR d.source_reference LIKE :query_source)';
            $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $query) . '%';
            $parameters['query_title'] = $like;
            $parameters['query_subject'] = $like;
            $parameters['query_source'] = $like;
        }
        foreach ([
            'review_status' => $reviewStatus,
            'extraction_status' => $extractionStatus,
        ] as $column => $value) {
            if ($value !== '') {
                $conditions[] = "d.{$column} = :{$column}";
                $parameters[$column] = $value;
            }
        }
        foreach ([
            'year_group' => $yearGroups,
            'resource_role' => $resourceRoles,
        ] as $column => $values) {
            if ($values === []) {
                continue;
            }
            $placeholders = [];
            foreach ($values as $index => $value) {
                $name = $column . '_' . $index;
                $placeholders[] = ':' . $name;
                $parameters[$name] = $value;
            }
            if ($column === 'year_group') {
                $conditions[] = '(' . implode(' OR ', array_map(
                    static fn(string $placeholder): string => 'FIND_IN_SET(' . $placeholder . ', d.year_group) > 0',
                    $placeholders
                )) . ')';
            } else {
                $conditions[] = 'd.' . $column . ' IN (' . implode(', ', $placeholders) . ')';
            }
        }
        $where = $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions);
        $countStatement = Connection::get()->prepare('SELECT COUNT(*) FROM curriculum_documents d' . $where);
        $countStatement->execute($parameters);
        $count = (int)$countStatement->fetchColumn();
        $lastPage = max(1, (int)ceil($count / self::PAGE_SIZE));
        if ($page > $lastPage) {
            $page = $lastPage;
            $offset = ($page - 1) * self::PAGE_SIZE;
        }
        $statement = Connection::get()->prepare(
            "SELECT d.id, d.title, d.year_group, d.subject_name, d.resource_role, d.resource_type_label, d.version_label, d.mime_type,
                    d.extraction_status, d.extraction_error, d.review_status, d.is_enabled, d.source_path, d.source_reference,
                    d.source_url, d.review_notes, d.created_at,
                    s.name AS source_name, s.publisher, s.source_kind, s.source_url AS source_home_url,
                    (SELECT COUNT(*) FROM curriculum_chunks c WHERE c.document_id = d.id) AS chunk_count,
                    (SELECT COUNT(*) FROM curriculum_sections section
                     WHERE section.document_id = d.id AND section.section_type <> 'document') AS classified_section_count
             FROM curriculum_documents d
             LEFT JOIN curriculum_sources s ON s.id = d.source_id
             {$where}
             ORDER BY d.created_at DESC LIMIT " . self::PAGE_SIZE . " OFFSET :offset"
        );
        foreach ($parameters as $name => $value) {
            $statement->bindValue(':' . $name, $value, \PDO::PARAM_STR);
        }
        $statement->bindValue(':offset', $offset, \PDO::PARAM_INT);
        $statement->execute();
        $documents = $statement->fetchAll();
        return ['documents' => $documents, 'total' => $count, 'page' => $page, 'per_page' => self::PAGE_SIZE];
    }

    public function preview(int $documentId): array
    {
        $statement = Connection::get()->prepare(
            'SELECT d.id, d.title, d.year_group, d.subject_name, d.resource_role, d.resource_type_label, d.mime_type,
                    d.extraction_status, d.extraction_error, d.is_enabled,
                    d.review_status, d.source_reference, d.source_url, d.review_notes,
                    s.name AS source_name, s.source_kind
             FROM curriculum_documents d LEFT JOIN curriculum_sources s ON s.id = d.source_id
             WHERE d.id = :id LIMIT 1'
        );
        $statement->execute(['id' => $documentId]);
        $document = $statement->fetch();
        if (!$document) {
            throw new RuntimeException('Curriculum document was not found.', 404);
        }
        $chunks = Connection::get()->prepare(
            'SELECT page_start, content FROM curriculum_chunks WHERE document_id = :id ORDER BY chunk_index LIMIT 5'
        );
        $chunks->execute(['id' => $documentId]);
        $document['previews'] = $chunks->fetchAll();
        $document['sections'] = $this->sections($documentId);
        $document['weekly_lessons'] = $this->weeklyLessons($documentId);
        return $document;
    }

    public function verifiedDocuments(int $page = 1, string $query = '', string $yearGroup = ''): array
    {
        if (!in_array($yearGroup, ['', 'SHS1', 'SHS2', 'SHS3'], true)) {
            throw new RuntimeException('Choose a valid SHS year group.', 422);
        }
        $pageSize = self::PAGE_SIZE;
        $page = max(1, $page);
        $query = mb_substr(trim($query), 0, 190, 'UTF-8');
        $conditions = ["d.review_status = 'verified'", 'd.is_enabled = 1'];
        $parameters = [];
        if ($query !== '') {
            $conditions[] = '(d.title LIKE :title OR d.subject_name LIKE :subject)';
            $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $query) . '%';
            $parameters['title'] = $like;
            $parameters['subject'] = $like;
        }
        if ($yearGroup !== '') {
            $conditions[] = 'FIND_IN_SET(:year_group, d.year_group) > 0';
            $parameters['year_group'] = $yearGroup;
        }
        $where = ' WHERE ' . implode(' AND ', $conditions);
        $pdo = Connection::get();
        $countStatement = $pdo->prepare('SELECT COUNT(*) FROM curriculum_documents d' . $where);
        $countStatement->execute($parameters);
        $count = (int)$countStatement->fetchColumn();
        $lastPage = max(1, (int)ceil($count / $pageSize));
        $page = min($page, $lastPage);
        $statement = $pdo->prepare(
            "SELECT d.id, d.title, d.year_group, d.subject_name, d.resource_role, d.resource_type_label, d.mime_type,
                    d.extraction_status, d.review_status, d.updated_at,
                    (SELECT COUNT(*) FROM curriculum_chunks c WHERE c.document_id = d.id) AS chunk_count
             FROM curriculum_documents d{$where}
             ORDER BY d.year_group, d.subject_name, d.title
             LIMIT {$pageSize} OFFSET " . (($page - 1) * $pageSize)
        );
        $statement->execute($parameters);
        return [
            'documents' => $statement->fetchAll(),
            'total' => $count,
            'page' => $page,
            'per_page' => $pageSize,
        ];
    }

    public function reader(int $documentId, int $offset = 0, bool $verifiedOnly = false): array
    {
        $pdo = Connection::get();
        $conditions = ['d.id = :id'];
        if ($verifiedOnly) {
            $conditions[] = "d.review_status = 'verified'";
            $conditions[] = 'd.is_enabled = 1';
        }
        $statement = $pdo->prepare(
            'SELECT d.id, d.title, d.year_group, d.subject_name, d.resource_role, d.resource_type_label, d.mime_type,
                    d.extraction_status, d.extraction_error, d.review_status, d.is_enabled,
                    (SELECT COUNT(*) FROM curriculum_chunks c WHERE c.document_id = d.id) AS chunk_count
             FROM curriculum_documents d WHERE ' . implode(' AND ', $conditions) . ' LIMIT 1'
        );
        $statement->execute(['id' => $documentId]);
        $document = $statement->fetch();
        if (!$document) {
            throw new RuntimeException('This teaching resource is not available.', 404);
        }
        $pageSize = 10;
        $totalChunks = (int)$document['chunk_count'];
        $lastOffset = $totalChunks > 0 ? intdiv($totalChunks - 1, $pageSize) * $pageSize : 0;
        $offset = min(max(0, $offset), $lastOffset);
        $chunks = $pdo->prepare(
            'SELECT page_start, page_end, content
             FROM curriculum_chunks WHERE document_id = :id
             ORDER BY chunk_index LIMIT ' . $pageSize . ' OFFSET ' . $offset
        );
        $chunks->execute(['id' => $documentId]);
        return [
            'document' => $document,
            'chunks' => $chunks->fetchAll(),
            'offset' => $offset,
            'total_chunks' => $totalChunks,
            'has_previous' => $offset > 0,
            'has_next' => $offset + $pageSize < $totalChunks,
        ];
    }

    public function originalPdf(int $documentId, bool $verifiedOnly = false): array
    {
        $document = $this->originalResource($documentId, $verifiedOnly);
        if ($document['mime_type'] !== 'application/pdf') {
            throw new RuntimeException('Only PDF resources can be displayed in the original-document preview.', 415);
        }
        return $document;
    }

    public function originalResource(int $documentId, bool $verifiedOnly = false): array
    {
        $statement = Connection::get()->prepare(
            'SELECT source_path, original_filename, mime_type, review_status, is_enabled
             FROM curriculum_documents WHERE id = :id LIMIT 1'
        );
        $statement->execute(['id' => $documentId]);
        $document = $statement->fetch();
        if (!$document) {
            throw new RuntimeException('The requested teaching resource was not found.', 404);
        }
        if ($verifiedOnly && ($document['review_status'] !== 'verified' || !(bool)$document['is_enabled'])) {
            throw new RuntimeException('This teaching resource is not available.', 404);
        }
        $uploadRoot = realpath(AKADEMI_STORAGE . DIRECTORY_SEPARATOR . 'curriculum' . DIRECTORY_SEPARATOR . 'uploads');
        $relativePath = (string)$document['source_path'];
        if ($uploadRoot === false || $relativePath === '' || str_contains($relativePath, "\0")
            || preg_match('~(?:^|[\\\\/])\.\.(?:[\\\\/]|$)|^(?:[\\\\/]|[A-Za-z]:)~', $relativePath)) {
            throw new RuntimeException('The original resource is not available in private storage.', 404);
        }
        $path = realpath($uploadRoot . DIRECTORY_SEPARATOR . $relativePath);
        $rootPrefix = rtrim($uploadRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
        if ($path === false || !is_file($path) || !is_readable($path)
            || !str_starts_with(strtolower($path), strtolower($rootPrefix))) {
            throw new RuntimeException('The original resource is not available in private storage.', 404);
        }
        if ($document['mime_type'] === 'application/pdf') {
            $handle = fopen($path, 'rb');
            $signature = $handle === false ? false : fread($handle, 5);
            if (is_resource($handle)) {
                fclose($handle);
            }
            if ($signature !== '%PDF-') {
                throw new RuntimeException('The stored resource is not a valid PDF file.', 415);
            }
        }
        return [
            'path' => $path,
            'filename' => basename((string)$document['original_filename']),
            'bytes' => filesize($path),
            'mime_type' => (string)$document['mime_type'],
        ];
    }

    public function aiPreview(int $documentId): array
    {
        $document = $this->preview($documentId);
        $chunks = Connection::get()->prepare(
            'SELECT page_start, content FROM curriculum_chunks
             WHERE document_id = :id ORDER BY chunk_index LIMIT 80'
        );
        $chunks->execute(['id' => $documentId]);
        $readable = [];
        foreach ($chunks->fetchAll() as $chunk) {
            $content = (string)$chunk['content'];
            $characters = max(1, mb_strlen($content, 'UTF-8'));
            preg_match_all('/\x{FFFD}/u', $content, $replacementMatches);
            preg_match_all('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $content, $controlMatches);
            if (count($replacementMatches[0]) / $characters > 0.01
                || count($controlMatches[0]) / $characters > 0.01) {
                continue;
            }
            $readable[] = [
                'page' => $chunk['page_start'] === null ? null : (int)$chunk['page_start'],
                'content' => $content,
            ];
        }
        if ($readable === []) {
            throw new RuntimeException(
                'The PDF text extraction is unreadable. Use the Original PDF preview to inspect the actual pages; AI will not guess at missing text.',
                422
            );
        }
        $sourceText = '';
        foreach ($readable as $chunk) {
            $piece = '[Page ' . ($chunk['page'] ?? 'unknown') . "]\n" . $chunk['content'];
            $remaining = 18000 - strlen($sourceText);
            if ($remaining <= 0) {
                break;
            }
            if (strlen($piece) > $remaining) {
                $piece = mb_strcut($piece, 0, $remaining, 'UTF-8');
            }
            $sourceText .= ($sourceText === '' ? '' : "\n\n") . $piece;
        }
        $ai = new AiProviderService();
        $response = $ai->generateResourcePreview(
            (string)$document['title'],
            (string)($document['year_group'] ?? ''),
            (string)($document['subject_name'] ?? ''),
            $sourceText
        );
        return ['preview' => $response, 'pages_used' => count($readable)];
    }

    public function updateMetadata(int $documentId, int $actorUserId, array $input): array
    {
        $yearGroups = $input['year_groups'] ?? ($input['year_group'] ?? []);
        if (!is_array($yearGroups)) {
            $yearGroups = explode(',', (string)$yearGroups);
        }
        if (array_filter($yearGroups, static fn(mixed $value): bool =>
            !is_string($value) || !in_array(trim($value), ['', 'SHS1', 'SHS2', 'SHS3'], true)
        ) !== []) {
            throw new RuntimeException('Choose valid SHS year groups.', 422);
        }
        $yearGroups = array_values(array_unique(array_filter(
            array_map(static fn(string $value): string => trim($value), $yearGroups),
            static fn(string $value): bool => $value !== ''
        )));
        $yearOrder = ['SHS1', 'SHS2', 'SHS3'];
        usort($yearGroups, static fn(string $left, string $right): int =>
            array_search($left, $yearOrder, true) <=> array_search($right, $yearOrder, true)
        );
        $yearGroup = implode(',', $yearGroups);
        $subject = trim((string)($input['subject_name'] ?? ''));
        $resourceRole = (string)($input['resource_role'] ?? '');
        $resourceTypeLabel = trim((string)($input['resource_type_label'] ?? ''));
        if (!in_array($resourceRole, ['teacher_manual', 'learner_material', 'lesson_template', 'scheme_template', 'curriculum', 'other'], true)
            || mb_strlen($resourceTypeLabel, 'UTF-8') > 100
            || mb_strlen($subject) > 190) {
            throw new RuntimeException('Choose a valid SHS year and resource type, and keep the subject within 190 characters.', 422);
        }
        if ($resourceRole === 'other' && $resourceTypeLabel === '') {
            throw new RuntimeException('Specify the resource type when choosing Other resource.', 422);
        }
        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $exists = $pdo->prepare('SELECT id FROM curriculum_documents WHERE id = :id FOR UPDATE');
            $exists->execute(['id' => $documentId]);
            if (!$exists->fetchColumn()) {
                throw new RuntimeException('Curriculum document was not found.', 404);
            }
            $pdo->prepare(
                'UPDATE curriculum_documents
                 SET year_group = :year_group, subject_name = :subject_name, resource_role = :resource_role,
                     resource_type_label = :resource_type_label,
                     updated_at = UTC_TIMESTAMP()
                 WHERE id = :id'
            )->execute([
                'year_group' => $yearGroup !== '' ? $yearGroup : null,
                'subject_name' => $subject !== '' ? $subject : null,
                'resource_role' => $resourceRole,
                'resource_type_label' => $resourceRole === 'other' ? $resourceTypeLabel : null,
                'id' => $documentId,
            ]);
            $pdo->prepare(
                "INSERT INTO audit_logs (actor_user_id, action_name, target_type, target_id, metadata)
                 VALUES (:actor, 'curriculum.metadata_updated', 'curriculum_document', :target_id, :metadata)"
            )->execute([
                'actor' => $actorUserId,
                'target_id' => (string)$documentId,
                'metadata' => json_encode([
                    'year_group' => $yearGroups,
                    'subject_name' => $subject !== '' ? $subject : null,
                    'resource_role' => $resourceRole,
                    'resource_type_label' => $resourceRole === 'other' ? $resourceTypeLabel : null,
                ], JSON_THROW_ON_ERROR),
            ]);
            $pdo->commit();
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
        return $this->preview($documentId);
    }

    public function setEnabled(int $documentId, bool $enabled, int $actorUserId): array
    {
        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $document = $pdo->prepare('SELECT id, is_enabled FROM curriculum_documents WHERE id = :id FOR UPDATE');
            $document->execute(['id' => $documentId]);
            $current = $document->fetch();
            if (!$current) {
                throw new RuntimeException('Curriculum document was not found.', 404);
            }
            $pdo->prepare(
                'UPDATE curriculum_documents SET is_enabled = :is_enabled, updated_at = UTC_TIMESTAMP() WHERE id = :id'
            )->execute(['is_enabled' => $enabled ? 1 : 0, 'id' => $documentId]);
            $pdo->prepare(
                'INSERT INTO audit_logs (actor_user_id, action_name, target_type, target_id, metadata)
                 VALUES (:actor, :action, \'curriculum_document\', :target_id, :metadata)'
            )->execute([
                'actor' => $actorUserId,
                'action' => $enabled ? 'curriculum.resource_enabled' : 'curriculum.resource_disabled',
                'target_id' => (string)$documentId,
                'metadata' => json_encode([
                    'was_enabled' => (bool)$current['is_enabled'],
                    'is_enabled' => $enabled,
                ], JSON_THROW_ON_ERROR),
            ]);
            $pdo->commit();
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
        return ['document_id' => $documentId, 'is_enabled' => $enabled];
    }

    public function deleteDocument(int $documentId, int $actorUserId): array
    {
        $pdo = Connection::get();
        $quarantinedPath = null;
        $originalPath = null;
        $pdo->beginTransaction();
        try {
            $statement = $pdo->prepare(
                'SELECT id, title, source_path FROM curriculum_documents WHERE id = :id FOR UPDATE'
            );
            $statement->execute(['id' => $documentId]);
            $document = $statement->fetch();
            if (!$document) {
                throw new RuntimeException('Curriculum document was not found.', 404);
            }

            $uploadRoot = realpath(AKADEMI_STORAGE . DIRECTORY_SEPARATOR . 'curriculum' . DIRECTORY_SEPARATOR . 'uploads');
            $relativePath = (string)$document['source_path'];
            if ($uploadRoot === false || $relativePath === '' || str_contains($relativePath, "\0")
                || preg_match('~(?:^|[\\\\/])\.\.(?:[\\\\/]|$)|^(?:[\\\\/]|[A-Za-z]:)~', $relativePath)) {
                throw new RuntimeException('The original resource path is invalid; the resource was not deleted.', 500);
            }
            $resolvedPath = realpath($uploadRoot . DIRECTORY_SEPARATOR . $relativePath);
            $rootPrefix = rtrim($uploadRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
            if ($resolvedPath !== false && (!is_file($resolvedPath)
                || !str_starts_with(strtolower($resolvedPath), strtolower($rootPrefix)))) {
                throw new RuntimeException('The original resource is outside private storage; the resource was not deleted.', 500);
            }
            if ($resolvedPath !== false) {
                $originalPath = $resolvedPath;
                $quarantinedPath = $uploadRoot . DIRECTORY_SEPARATOR . '.delete-' . $documentId . '-' . bin2hex(random_bytes(12));
                if (!rename($originalPath, $quarantinedPath)) {
                    throw new RuntimeException('The private resource file could not be prepared for deletion.', 500);
                }
            }

            $pdo->prepare(
                "INSERT INTO audit_logs (actor_user_id, action_name, target_type, target_id, metadata)
                 VALUES (:actor, 'curriculum.resource_deleted', 'curriculum_document', :target_id, :metadata)"
            )->execute([
                'actor' => $actorUserId,
                'target_id' => (string)$documentId,
                'metadata' => json_encode([
                    'title' => (string)$document['title'],
                    'file_present' => $quarantinedPath !== null,
                ], JSON_THROW_ON_ERROR),
            ]);
            $pdo->prepare('DELETE FROM curriculum_documents WHERE id = :id')->execute(['id' => $documentId]);
            $pdo->commit();
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            if ($quarantinedPath !== null && is_file($quarantinedPath)
                && $originalPath !== null && !rename($quarantinedPath, $originalPath)) {
                write_log('error', 'Failed to restore curriculum resource after deletion rollback', [
                    'document_id' => $documentId,
                ]);
            }
            throw $exception;
        }

        $cleanupPending = $quarantinedPath !== null && is_file($quarantinedPath) && !unlink($quarantinedPath);
        if ($cleanupPending) {
            write_log('error', 'Curriculum resource deleted but quarantined file cleanup failed', [
                'document_id' => $documentId,
            ]);
        }
        return ['document_id' => $documentId, 'deleted' => true, 'cleanup_pending' => $cleanupPending];
    }

    public function sections(int $documentId): array
    {
        $statement = Connection::get()->prepare(
            'SELECT id, section_type, source_chunk_id, code, title, body, page_number,
                    review_status, ai_generated, model_used, review_notes
             FROM curriculum_sections
             WHERE document_id = :document_id AND section_type <> \'document\'
             ORDER BY page_number, id LIMIT 500'
        );
        $statement->execute(['document_id' => $documentId]);
        return $statement->fetchAll();
    }

    public function weeklyLessons(int $documentId): array
    {
        $statement = Connection::get()->prepare(
            'SELECT id, source_chunk_id, semester_number, week_number, topic, focal_areas,
                    learning_indicators, learning_outcomes, assessment_mode,
                    source_page, review_status, model_used, review_notes
             FROM curriculum_weekly_lessons
             WHERE document_id = :document_id
             ORDER BY semester_number, week_number, source_page, id LIMIT 500'
        );
        $statement->execute(['document_id' => $documentId]);
        return array_map(static function (array $row): array {
            $row['focal_areas'] = json_decode((string)$row['focal_areas'], true, 16, JSON_THROW_ON_ERROR);
            if (!is_array($row['focal_areas']) || array_filter($row['focal_areas'], 'is_string') !== $row['focal_areas']) {
                throw new RuntimeException('A stored weekly lesson contains invalid focal-area data.', 500);
            }
            foreach (['learning_indicators', 'learning_outcomes'] as $field) {
                $row[$field] = $row[$field] === null ? [] : json_decode((string)$row[$field], true, 16, JSON_THROW_ON_ERROR);
                if (!is_array($row[$field]) || array_filter($row[$field], 'is_string') !== $row[$field]) {
                    throw new RuntimeException('A stored weekly lesson contains invalid learning-target data.', 500);
                }
            }
            return $row;
        }, $statement->fetchAll());
    }

    public function reviewWeeklyLesson(int $documentId, int $lessonId, int $actorUserId, array $input): array
    {
        $status = (string)($input['status'] ?? '');
        $week = filter_var($input['week_number'] ?? null, FILTER_VALIDATE_INT);
        $semesterValue = $input['semester_number'] ?? null;
        $semester = $semesterValue === null || $semesterValue === '' ? null : filter_var($semesterValue, FILTER_VALIDATE_INT);
        $topic = trim((string)($input['topic'] ?? ''));
        $assessmentMode = trim((string)($input['assessment_mode'] ?? ''));
        $reviewNotes = trim((string)($input['review_notes'] ?? ''));
        $focalAreas = $input['focal_areas'] ?? null;
        if (!in_array($status, ['verified', 'rejected', 'unreviewed'], true)
            || $week === false || $week < 1 || $week > 52
            || ($semesterValue !== null && $semesterValue !== '' && ($semester === false || !in_array($semester, [1, 2], true)))
            || $topic === '' || mb_strlen($topic) > 500
            || mb_strlen($assessmentMode) > 500 || mb_strlen($reviewNotes) > 500
            || !is_array($focalAreas) || count($focalAreas) > 12) {
            throw new RuntimeException('Enter a valid week, topic, focal-area list and assessment mode.', 422);
        }
        $cleanFocalAreas = [];
        foreach ($focalAreas as $focalArea) {
            if (!is_string($focalArea) || mb_strlen(trim($focalArea)) > 500) {
                throw new RuntimeException('Each focal area must be plain text within 500 characters.', 422);
            }
            $focalArea = trim($focalArea);
            if ($focalArea !== '') {
                $cleanFocalAreas[] = $focalArea;
            }
        }
        $cleanFocalAreas = array_values(array_unique($cleanFocalAreas));
        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $update = $pdo->prepare(
                'UPDATE curriculum_weekly_lessons
                 SET semester_number = :semester_number,
                     week_number = :week_number,
                     topic = :topic,
                     focal_areas = :focal_areas,
                     assessment_mode = :assessment_mode,
                     review_status = :review_status,
                     review_notes = :review_notes,
                     verified_by = :verified_by,
                     verified_at = :verified_at
                 WHERE id = :lesson_id AND document_id = :document_id'
            );
            $update->execute([
                'semester_number' => $semester,
                'week_number' => $week,
                'topic' => $topic,
                'focal_areas' => json_encode($cleanFocalAreas, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'assessment_mode' => $assessmentMode !== '' ? $assessmentMode : null,
                'review_status' => $status,
                'review_notes' => $reviewNotes !== '' ? $reviewNotes : null,
                'verified_by' => $status === 'verified' ? $actorUserId : null,
                'verified_at' => $status === 'verified' ? gmdate('Y-m-d H:i:s') : null,
                'lesson_id' => $lessonId,
                'document_id' => $documentId,
            ]);
            if ($update->rowCount() === 0) {
                $exists = $pdo->prepare(
                    'SELECT 1 FROM curriculum_weekly_lessons WHERE id = :lesson_id AND document_id = :document_id LIMIT 1'
                );
                $exists->execute(['lesson_id' => $lessonId, 'document_id' => $documentId]);
                if (!$exists->fetchColumn()) {
                    throw new RuntimeException('The weekly lesson was not found in this resource.', 404);
                }
            }
            $pdo->prepare(
                "INSERT INTO audit_logs (actor_user_id, action_name, target_type, target_id, metadata)
                 VALUES (:actor, 'curriculum.weekly_lesson_reviewed', 'curriculum_weekly_lesson', :target_id, :metadata)"
            )->execute([
                'actor' => $actorUserId,
                'target_id' => (string)$lessonId,
                'metadata' => json_encode([
                    'document_id' => $documentId,
                    'semester_number' => $semester,
                    'week_number' => $week,
                    'review_status' => $status,
                ], JSON_THROW_ON_ERROR),
            ]);
            $pdo->commit();
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
        return $this->preview($documentId);
    }

    public function reviewSection(int $documentId, int $sectionId, int $actorUserId, array $input): array
    {
        $status = (string)($input['status'] ?? '');
        $type = (string)($input['section_type'] ?? '');
        $reviewNote = trim((string)($input['review_notes'] ?? ''));
        $allowedTypes = ['subject', 'strand', 'sub_strand', 'focal_area', 'section', 'content_standard', 'learning_indicator', 'learning_outcome', 'learning_objective', 'topic', 'other'];
        if (!in_array($status, ['verified', 'rejected', 'unreviewed'], true)
            || !in_array($type, $allowedTypes, true) || mb_strlen($reviewNote) > 500) {
            throw new RuntimeException('Choose a valid section type and review status.', 422);
        }
        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $section = $pdo->prepare(
                'SELECT id FROM curriculum_sections
                 WHERE id = :section_id AND document_id = :document_id AND section_type <> \'document\'
                 FOR UPDATE'
            );
            $section->execute(['section_id' => $sectionId, 'document_id' => $documentId]);
            if (!$section->fetchColumn()) {
                throw new RuntimeException('The curriculum section was not found in this resource.', 404);
            }
            $pdo->prepare(
                'UPDATE curriculum_sections
                 SET section_type = :section_type,
                     review_status = :review_status,
                     verified_by = :verified_by,
                     verified_at = :verified_at,
                     review_notes = :review_notes
                 WHERE id = :section_id AND document_id = :document_id'
            )->execute([
                'section_type' => $type,
                'review_status' => $status,
                'verified_by' => $status === 'verified' ? $actorUserId : null,
                'verified_at' => $status === 'verified' ? gmdate('Y-m-d H:i:s') : null,
                'review_notes' => $status === 'verified'
                    ? 'Admin verified section type: ' . $type . '. ' . $reviewNote
                    : ($reviewNote ?: null),
                'section_id' => $sectionId,
                'document_id' => $documentId,
            ]);
            $pdo->prepare(
                "INSERT INTO audit_logs (actor_user_id, action_name, target_type, target_id, metadata)
                 VALUES (:actor, 'curriculum.section_reviewed', 'curriculum_section', :target_id, :metadata)"
            )->execute([
                'actor' => $actorUserId,
                'target_id' => (string)$sectionId,
                'metadata' => json_encode([
                    'document_id' => $documentId,
                    'section_type' => $type,
                    'review_status' => $status,
                ], JSON_THROW_ON_ERROR),
            ]);
            $pdo->commit();
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
        return $this->preview($documentId);
    }

    public function verifiedSearch(string $query, ?string $yearGroup = null, int $limit = 6): array
    {
        return (new CurriculumSearchService())->search($query, $yearGroup, $limit);
    }

    public function setReviewStatus(int $documentId, string $status, int $actorUserId, array $provenance = []): array
    {
        if (!in_array($status, ['verified', 'rejected', 'unreviewed'], true)) {
            throw new RuntimeException('Choose a supported review status.', 422);
        }
        $pdo = Connection::get();
        $document = $pdo->prepare('SELECT id, extraction_status FROM curriculum_documents WHERE id = :id LIMIT 1');
        $document->execute(['id' => $documentId]);
        $row = $document->fetch();
        if (!$row) {
            throw new RuntimeException('Curriculum document was not found.', 404);
        }
        if ($status === 'verified' && $row['extraction_status'] !== 'extracted') {
            throw new RuntimeException('Only text-extracted documents can be verified. Scanned PDFs need OCR and human review first.', 422);
        }
        $sourceReference = trim((string)($provenance['source_reference'] ?? ''));
        $sourceUrl = trim((string)($provenance['source_url'] ?? ''));
        $reviewNotes = trim((string)($provenance['review_notes'] ?? ''));
        if ($status === 'verified' && (mb_strlen($sourceReference) < 3 || mb_strlen($reviewNotes) < 10)) {
            throw new RuntimeException('Verification requires a source/document reference and review notes describing what you checked.', 422);
        }
        if ($sourceUrl !== '' && (!filter_var($sourceUrl, FILTER_VALIDATE_URL) || !str_starts_with(strtolower($sourceUrl), 'https://'))) {
            throw new RuntimeException('Source links must use HTTPS.', 422);
        }
        $verified = $status === 'verified';
        $verifiedAt = $verified ? gmdate('Y-m-d H:i:s') : null;
        $verifiedWeeklyLessons = 0;
        $pdo->beginTransaction();
        try {
            $update = $pdo->prepare(
                'UPDATE curriculum_documents
                 SET review_status = :status, verified_by = :verified_by,
                     verified_at = :verified_at, source_reference = :source_reference,
                     source_url = :source_url, review_notes = :review_notes, updated_at = UTC_TIMESTAMP()
                 WHERE id = :id'
            );
            $update->execute([
                'status' => $status,
                'verified_by' => $verified ? $actorUserId : null,
                'verified_at' => $verifiedAt,
                'source_reference' => $sourceReference !== '' ? $sourceReference : null,
                'source_url' => $sourceUrl !== '' ? $sourceUrl : null,
                'review_notes' => $reviewNotes !== '' ? $reviewNotes : null,
                'id' => $documentId,
            ]);
            if ($verified) {
                (new CurriculumSearchService())->indexVerifiedDocumentChunks($documentId);
                $weeklyLessons = $pdo->prepare(
                    "UPDATE curriculum_weekly_lessons
                     SET review_status = 'verified',
                         verified_by = :verified_by,
                         verified_at = :verified_at,
                         review_notes = COALESCE(NULLIF(review_notes, ''), :review_notes)
                     WHERE document_id = :document_id
                       AND review_status = 'unreviewed'"
                );
                $weeklyLessons->execute([
                    'verified_by' => $actorUserId,
                    'verified_at' => $verifiedAt,
                    'review_notes' => 'Verified with the source resource: ' . $reviewNotes,
                    'document_id' => $documentId,
                ]);
                $verifiedWeeklyLessons = $weeklyLessons->rowCount();
            }
            $audit = $pdo->prepare(
                "INSERT INTO audit_logs (actor_user_id, action_name, target_type, target_id, metadata)
                 VALUES (:actor, 'curriculum.review_changed', 'curriculum_document', :target_id, :metadata)"
            );
            $audit->execute([
                'actor' => $actorUserId,
                'target_id' => (string)$documentId,
                'metadata' => json_encode([
                    'review_status' => $status,
                    'source_reference' => $sourceReference,
                    'weekly_lessons_verified' => $verifiedWeeklyLessons,
                ], JSON_THROW_ON_ERROR),
            ]);
            $pdo->commit();
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
        return $this->preview($documentId);
    }

}
