<?php
declare(strict_types=1);

namespace Akademi\Services;

use DirectoryIterator;
use RuntimeException;

final class CurriculumChunkUploadService
{
    private const MAX_FILE_BYTES = 80 * 1024 * 1024;
    private const CHUNK_BYTES = 4 * 1024 * 1024;
    private const MAX_FILES = 10;

    public function begin(array $files, array $metadata, int $actorUserId): array
    {
        $this->cleanupExpired();
        if ($files === [] || count($files) > self::MAX_FILES) {
            throw new RuntimeException('Upload between 1 and 10 resource files at a time.', 422);
        }
        $totalBytes = 0;
        $manifestFiles = [];
        foreach ($files as $file) {
            if (!is_array($file) || !is_string($file['name'] ?? null)
                || !is_int($file['size'] ?? null) || $file['size'] < 1) {
                throw new RuntimeException('The upload file list is invalid. Select the files again.', 422);
            }
            $name = basename(str_replace('\\', '/', $file['name']));
            $name = preg_replace('/[\x00-\x1F\x7F]/u', '', $name) ?? '';
            $extension = strtolower(pathinfo($name, PATHINFO_EXTENSION));
            if ($name === '' || !in_array($extension, ['pdf', 'txt', 'md', 'csv', 'docx'], true)) {
                throw new RuntimeException('Only PDF, DOCX, TXT, MD and CSV resource files are supported.', 422);
            }
            if ($file['size'] > self::MAX_FILE_BYTES) {
                throw new RuntimeException('Each resource file must be 80 MB or smaller.', 413);
            }
            $totalBytes += $file['size'];
            if ($totalBytes > self::MAX_FILE_BYTES) {
                throw new RuntimeException('The combined upload must be 80 MB or smaller.', 413);
            }
            $manifestFiles[] = [
                'name' => mb_substr($name, 0, 255, 'UTF-8'),
                'extension' => $extension,
                'size' => $file['size'],
                'chunk_count' => (int)ceil($file['size'] / self::CHUNK_BYTES),
                'received' => array_fill(0, (int)ceil($file['size'] / self::CHUNK_BYTES), false),
            ];
        }

        $root = $this->rootDirectory();
        $uploadId = bin2hex(random_bytes(24));
        $directory = $root . DIRECTORY_SEPARATOR . $uploadId;
        if (!mkdir($directory, 0700)) {
            throw new RuntimeException('A private upload session could not be created.');
        }
        $this->writeManifest($directory, [
            'created_at' => time(),
            'actor_user_id' => $actorUserId,
            'metadata' => $metadata,
            'files' => $manifestFiles,
        ]);
        return ['upload_id' => $uploadId, 'chunk_size' => self::CHUNK_BYTES];
    }

    public function receive(string $uploadId, int $fileIndex, int $chunkIndex, array $upload, int $actorUserId): array
    {
        $directory = $this->sessionDirectory($uploadId);
        $manifest = $this->readManifest($directory);
        $this->assertOwner($manifest, $actorUserId);
        $file = $manifest['files'][$fileIndex] ?? null;
        if (!is_array($file) || $chunkIndex < 0 || $chunkIndex >= $file['chunk_count']) {
            throw new RuntimeException('The upload chunk is not part of this upload session.', 422);
        }
        if (!is_int($upload['error'] ?? null) || $upload['error'] !== UPLOAD_ERR_OK
            || !is_string($upload['tmp_name'] ?? null) || !is_uploaded_file($upload['tmp_name'])) {
            throw new RuntimeException('The upload chunk could not be received. Retry this upload.', 422);
        }
        $expectedBytes = min(self::CHUNK_BYTES, $file['size'] - $chunkIndex * self::CHUNK_BYTES);
        $actualBytes = filesize($upload['tmp_name']);
        if (!is_int($actualBytes) || $actualBytes !== $expectedBytes) {
            throw new RuntimeException('The upload chunk was incomplete. Retry this upload.', 422);
        }

        $chunkPath = $directory . DIRECTORY_SEPARATOR . "chunk-{$fileIndex}-{$chunkIndex}.part";
        $incomingHash = hash_file('sha256', $upload['tmp_name']);
        if (is_file($chunkPath)) {
            $existingHash = hash_file('sha256', $chunkPath);
            if (!is_string($incomingHash) || !is_string($existingHash) || !hash_equals($existingHash, $incomingHash)) {
                throw new RuntimeException('A different chunk already exists at this position. Start the upload again.', 409);
            }
        } elseif (!move_uploaded_file($upload['tmp_name'], $chunkPath)) {
            throw new RuntimeException('The server could not store an upload chunk.');
        } elseif (!chmod($chunkPath, 0600)) {
            unlink($chunkPath);
            throw new RuntimeException('Private permissions could not be set on an upload chunk.');
        }
        $manifest['files'][$fileIndex]['received'][$chunkIndex] = true;
        $this->writeManifest($directory, $manifest);
        return ['received' => true];
    }

    public function complete(string $uploadId, int $actorUserId): array
    {
        $directory = $this->sessionDirectory($uploadId);
        $manifest = $this->readManifest($directory);
        $this->assertOwner($manifest, $actorUserId);
        $files = [];
        foreach ($manifest['files'] as $fileIndex => $file) {
            if (count($file['received']) !== $file['chunk_count']
                || in_array(false, $file['received'], true)) {
                throw new RuntimeException('Some upload chunks are missing. Retry the upload before finishing.', 422);
            }
            $assembledPath = $directory . DIRECTORY_SEPARATOR
                . "assembled-{$fileIndex}." . $file['extension'];
            $output = fopen($assembledPath, 'wb');
            if ($output === false) {
                throw new RuntimeException('A private resource file could not be assembled.');
            }
            $bytesWritten = 0;
            try {
                for ($chunkIndex = 0; $chunkIndex < $file['chunk_count']; $chunkIndex++) {
                    $chunkPath = $directory . DIRECTORY_SEPARATOR . "chunk-{$fileIndex}-{$chunkIndex}.part";
                    $input = fopen($chunkPath, 'rb');
                    if ($input === false) {
                        throw new RuntimeException('An upload chunk is missing. Retry the upload.');
                    }
                    try {
                        $copied = stream_copy_to_stream($input, $output);
                    } finally {
                        fclose($input);
                    }
                    if (!is_int($copied)) {
                        throw new RuntimeException('A resource upload could not be assembled.');
                    }
                    $bytesWritten += $copied;
                }
            } finally {
                fclose($output);
            }
            if ($bytesWritten !== $file['size'] || !chmod($assembledPath, 0600)) {
                throw new RuntimeException('The assembled resource does not match the selected file.');
            }
            $files[] = ['path' => $assembledPath, 'name' => $file['name']];
        }

        $result = (new CurriculumIngestionService())->uploadStagedFiles(
            $files,
            $manifest['metadata'],
            $actorUserId,
            $directory
        );
        $this->removeSessionDirectory($directory);
        return $result;
    }

    private function rootDirectory(): string
    {
        $directory = AKADEMI_STORAGE . DIRECTORY_SEPARATOR . 'curriculum'
            . DIRECTORY_SEPARATOR . 'upload-staging';
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new RuntimeException('Private upload staging could not be created.');
        }
        $root = realpath($directory);
        if ($root === false || !is_dir($root) || !is_writable($root)) {
            throw new RuntimeException('Private upload staging is not writable.');
        }
        $webRoot = realpath((string)($_SERVER['DOCUMENT_ROOT'] ?? ''));
        if ($webRoot !== false) {
            $webRootPrefix = rtrim(str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $webRoot), DIRECTORY_SEPARATOR)
                . DIRECTORY_SEPARATOR;
            $rootPrefix = rtrim(str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $root), DIRECTORY_SEPARATOR)
                . DIRECTORY_SEPARATOR;
            if (str_starts_with(strtolower($rootPrefix), strtolower($webRootPrefix))) {
                throw new RuntimeException('Upload staging must be stored outside the public web root.');
            }
        }
        return $root;
    }

    private function sessionDirectory(string $uploadId): string
    {
        if (!preg_match('/\A[a-f0-9]{48}\z/D', $uploadId)) {
            throw new RuntimeException('The upload session is invalid. Start the upload again.', 422);
        }
        $root = $this->rootDirectory();
        $directory = $root . DIRECTORY_SEPARATOR . $uploadId;
        $resolvedDirectory = realpath($directory);
        if ($resolvedDirectory === false || dirname($resolvedDirectory) !== $root || !is_dir($resolvedDirectory)) {
            throw new RuntimeException('The upload session expired. Start the upload again.', 410);
        }
        return $resolvedDirectory;
    }

    private function readManifest(string $directory): array
    {
        $path = $directory . DIRECTORY_SEPARATOR . 'manifest.json';
        $contents = file_get_contents($path);
        if (!is_string($contents)) {
            throw new RuntimeException('The upload session could not be read. Start the upload again.', 410);
        }
        try {
            $manifest = json_decode($contents, true, 16, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new RuntimeException('The upload session is invalid. Start the upload again.', 410);
        }
        if (!is_array($manifest) || !is_array($manifest['files'] ?? null)
            || !is_array($manifest['metadata'] ?? null)) {
            throw new RuntimeException('The upload session is invalid. Start the upload again.', 410);
        }
        return $manifest;
    }

    private function writeManifest(string $directory, array $manifest): void
    {
        $path = $directory . DIRECTORY_SEPARATOR . 'manifest.json';
        $temporaryPath = $path . '.tmp';
        $contents = json_encode($manifest, JSON_THROW_ON_ERROR);
        if (file_put_contents($temporaryPath, $contents, LOCK_EX) !== strlen($contents)
            || !chmod($temporaryPath, 0600)
            || !rename($temporaryPath, $path)) {
            throw new RuntimeException('Upload progress could not be saved.');
        }
    }

    private function assertOwner(array $manifest, int $actorUserId): void
    {
        if ((int)($manifest['actor_user_id'] ?? 0) !== $actorUserId) {
            throw new RuntimeException('The upload session belongs to another account.', 403);
        }
    }

    private function cleanupExpired(): void
    {
        $root = $this->rootDirectory();
        foreach (new DirectoryIterator($root) as $entry) {
            if ($entry->isDot() || !$entry->isDir() || $entry->isLink()
                || !preg_match('/\A[a-f0-9]{48}\z/D', $entry->getFilename())
                || $entry->getMTime() >= time() - 86400) {
                continue;
            }
            $this->removeSessionDirectory($entry->getPathname());
        }
    }

    private function removeSessionDirectory(string $directory): void
    {
        $resolved = realpath($directory);
        $root = realpath(AKADEMI_STORAGE . DIRECTORY_SEPARATOR . 'curriculum'
            . DIRECTORY_SEPARATOR . 'upload-staging');
        if ($resolved === false || $root === false || dirname($resolved) !== $root || !is_dir($resolved)) {
            return;
        }
        foreach (new DirectoryIterator($resolved) as $entry) {
            if ($entry->isDot() || $entry->isLink() || !$entry->isFile()) {
                continue;
            }
            unlink($entry->getPathname());
        }
        rmdir($resolved);
    }
}
