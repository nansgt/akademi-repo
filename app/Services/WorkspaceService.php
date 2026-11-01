<?php
declare(strict_types=1);

namespace Akademi\Services;

use Akademi\Database\Connection;
use PDO;
use RuntimeException;

final class WorkspaceService
{
    private const DOCUMENT_TYPES = ['lesson', 'assessment', 'scheme', 'slides'];
    private const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    private const SCHOOL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

    public function load(int $userId, array $user): array
    {
        $pdo = Connection::get();
        $profileStatement = $pdo->prepare(
            'SELECT school_name, phone_number, region, district, school_type, department,
                    primary_subject, teaching_subjects, school_logo_path
             FROM user_profiles WHERE user_id = :user_id LIMIT 1'
        );
        $profileStatement->execute(['user_id' => $userId]);
        $storedProfile = $profileStatement->fetch() ?: [];
        $subjects = $storedProfile['teaching_subjects'] ?? null;
        if (is_string($subjects)) {
            $subjects = json_decode($subjects, true);
        }
        $profile = $this->profilePayload((int)$user['id'], (string)$user['display_name'], $storedProfile, $subjects);

        $documentsStatement = $pdo->prepare(
            'SELECT id, document_type, title, subject_name, year_group, class_name, status,
                    source_input, generated_content, created_at
             FROM saved_documents WHERE user_id = :user_id
             ORDER BY updated_at DESC, id DESC LIMIT 500'
        );
        $documentsStatement->execute(['user_id' => $userId]);
        $documents = array_map(fn(array $row): array => $this->mapDocument($row), $documentsStatement->fetchAll());

        $scheduleStatement = $pdo->prepare(
            'SELECT id, weekday, start_time, end_time, subject_name, class_name, topic, color,
                    starts_on, repeat_mode, repeat_interval_weeks, repeat_until
             FROM teacher_schedule_entries WHERE user_id = :user_id
             ORDER BY FIELD(weekday, \'Monday\', \'Tuesday\', \'Wednesday\', \'Thursday\', \'Friday\', \'Saturday\', \'Sunday\'), start_time, id'
        );
        $scheduleStatement->execute(['user_id' => $userId]);
        $schedule = array_map(static fn(array $row): array => [
            'id' => (string)$row['id'],
            'day' => (string)$row['weekday'],
            'time' => substr((string)$row['start_time'], 0, 5),
            'endTime' => $row['end_time'] === null ? date('H:i', strtotime((string)$row['start_time'] . ' +1 hour')) : substr((string)$row['end_time'], 0, 5),
            'subject' => (string)$row['subject_name'],
            'className' => (string)($row['class_name'] ?? ''),
            'topic' => (string)($row['topic'] ?? ''),
            'color' => is_string($row['color'] ?? null) && preg_match('/^#[0-9a-fA-F]{6}$/D', $row['color'])
                ? strtolower($row['color'])
                : '#398c69',
            'startsOn' => $row['starts_on'] === null ? '' : (string)$row['starts_on'],
            'repeatMode' => in_array((string)($row['repeat_mode'] ?? 'weekly'), ['weekly', 'daily', 'custom'], true)
                ? (string)($row['repeat_mode'] ?? 'weekly')
                : 'weekly',
            'repeatIntervalWeeks' => max(1, (int)($row['repeat_interval_weeks'] ?? 1)),
            'repeatUntil' => $row['repeat_until'] === null ? '' : (string)$row['repeat_until'],
        ], $scheduleStatement->fetchAll());

        return [
            'user' => ['id' => $userId, 'display_name' => $user['display_name'], 'email' => $user['email'], 'roles' => $user['roles']],
            'csrf_token' => \Akademi\Security\Csrf::token(),
            'profile' => $profile,
            'documents' => $documents,
            'schedule' => $schedule,
            'credits' => (new AiCreditService())->balance($userId),
            'ai_provider' => (new AiProviderService())->publicConfig(),
        ];
    }

    public function saveProfile(int $userId, array $input): array
    {
        $name = trim((string)($input['name'] ?? ''));
        $school = trim((string)($input['school'] ?? ''));
        $phone = trim((string)($input['phone'] ?? ''));
        $region = trim((string)($input['region'] ?? ''));
        $district = trim((string)($input['district'] ?? ''));
        $schoolType = trim((string)($input['school_type'] ?? ''));
        $department = trim((string)($input['department'] ?? ''));
        $primarySubject = trim((string)($input['primary_subject'] ?? ''));
        $subjectText = trim((string)($input['subjects'] ?? ''));
        if ($name === '' || mb_strlen($name) > 120 || mb_strlen($school) > 190
            || mb_strlen($phone) > 30 || ($phone !== '' && !preg_match('/^[+0-9().\-\s]+$/D', $phone))
            || mb_strlen($region) > 100 || mb_strlen($district) > 120
            || !in_array($schoolType, ['', 'mixed', 'boys', 'girls'], true)
            || mb_strlen($department) > 120 || mb_strlen($primarySubject) > 190
            || mb_strlen($subjectText) > 1000) {
            throw new RuntimeException('Enter a name (up to 120 characters) and keep the profile fields within their limits.', 422);
        }
        $subjects = array_values(array_unique(array_filter(array_map('trim', preg_split('/[,;\n]+/u', $subjectText) ?: []))));
        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $pdo->prepare('UPDATE users SET display_name = :name, updated_at = UTC_TIMESTAMP() WHERE id = :user_id')
                ->execute(['name' => $name, 'user_id' => $userId]);
            $pdo->prepare(
                'INSERT INTO user_profiles
                    (user_id, school_name, phone_number, region, district, school_type, department,
                     primary_subject, teaching_subjects)
                 VALUES (:user_id, :school_name, :phone, :region, :district, :school_type, :department,
                     :primary_subject, :subjects)
                 ON DUPLICATE KEY UPDATE school_name = VALUES(school_name), phone_number = VALUES(phone_number),
                   region = VALUES(region), district = VALUES(district), school_type = VALUES(school_type),
                   department = VALUES(department), primary_subject = VALUES(primary_subject),
                   teaching_subjects = VALUES(teaching_subjects), updated_at = UTC_TIMESTAMP()'
            )->execute([
                'user_id' => $userId,
                'school_name' => $school !== '' ? $school : null,
                'phone' => $phone !== '' ? $phone : null,
                'region' => $region !== '' ? $region : null,
                'district' => $district !== '' ? $district : null,
                'school_type' => $schoolType !== '' ? $schoolType : null,
                'department' => $department !== '' ? $department : null,
                'primary_subject' => $primarySubject !== '' ? $primarySubject : null,
                'subjects' => json_encode($subjects, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            ]);
            $pdo->commit();
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
        $saved = $pdo->prepare(
            'SELECT school_name, phone_number, region, district, school_type, department,
                    primary_subject, teaching_subjects, school_logo_path
             FROM user_profiles WHERE user_id = :user_id LIMIT 1'
        );
        $saved->execute(['user_id' => $userId]);
        return $this->profilePayload($userId, $name, $saved->fetch() ?: [], $subjects);
    }

    public function saveProfileLogo(int $userId, array $upload): array
    {
        if (($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK
            || !is_string($upload['tmp_name'] ?? null)
            || !is_uploaded_file((string)$upload['tmp_name'])
            || (int)($upload['size'] ?? 0) < 1
            || (int)$upload['size'] > 2 * 1024 * 1024) {
            throw new RuntimeException('Choose a non-empty school logo no larger than 2 MB.', 422);
        }
        $temporaryPath = (string)$upload['tmp_name'];
        $imageInfo = @getimagesize($temporaryPath);
        $mime = is_array($imageInfo) ? (string)($imageInfo['mime'] ?? '') : '';
        $extensions = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
        if (!isset($extensions[$mime])) {
            throw new RuntimeException('School logos must be JPEG, PNG or WebP images.', 422);
        }
        $directory = AKADEMI_STORAGE . DIRECTORY_SEPARATOR . 'profiles' . DIRECTORY_SEPARATOR . $userId;
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new RuntimeException('Private profile image storage could not be created.', 500);
        }
        $path = $directory . DIRECTORY_SEPARATOR . bin2hex(random_bytes(20)) . '.' . $extensions[$mime];
        if (!move_uploaded_file($temporaryPath, $path)) {
            throw new RuntimeException('The school logo could not be stored.', 500);
        }
        if (!chmod($path, 0600)) {
            unlink($path);
            throw new RuntimeException('Private permissions could not be set on the school logo.', 500);
        }

        $pdo = Connection::get();
        $statement = $pdo->prepare('SELECT school_logo_path FROM user_profiles WHERE user_id = :user_id LIMIT 1');
        $statement->execute(['user_id' => $userId]);
        $oldPath = $statement->fetchColumn();
        try {
            $pdo->prepare(
                'INSERT INTO user_profiles (user_id, school_logo_path) VALUES (:user_id, :path)
                 ON DUPLICATE KEY UPDATE school_logo_path = VALUES(school_logo_path), updated_at = UTC_TIMESTAMP()'
            )->execute(['user_id' => $userId, 'path' => 'profiles' . DIRECTORY_SEPARATOR . $userId . DIRECTORY_SEPARATOR . basename($path)]);
        } catch (\Throwable $exception) {
            unlink($path);
            throw $exception;
        }
        if (is_string($oldPath) && $oldPath !== '') {
            $this->deletePrivateProfileFile($oldPath, $userId);
        }
        return ['logo_url' => \app_url('api/workspace/profile/logo')];
    }

    public function profileLogo(int $userId): array
    {
        $statement = Connection::get()->prepare('SELECT school_logo_path FROM user_profiles WHERE user_id = :user_id LIMIT 1');
        $statement->execute(['user_id' => $userId]);
        $relativePath = $statement->fetchColumn();
        if (!is_string($relativePath) || $relativePath === '') {
            throw new RuntimeException('No school logo has been uploaded for this profile.', 404);
        }
        $root = realpath(AKADEMI_STORAGE . DIRECTORY_SEPARATOR . 'profiles' . DIRECTORY_SEPARATOR . $userId);
        $path = realpath(AKADEMI_STORAGE . DIRECTORY_SEPARATOR . str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $relativePath));
        if ($root === false || $path === false || !is_file($path)
            || !str_starts_with(strtolower($path), strtolower($root . DIRECTORY_SEPARATOR))) {
            throw new RuntimeException('The saved school logo could not be found in private storage.', 404);
        }
        $imageInfo = @getimagesize($path);
        $mime = is_array($imageInfo) ? (string)($imageInfo['mime'] ?? '') : '';
        if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
            throw new RuntimeException('The saved school logo is not a supported image.', 415);
        }
        return ['path' => $path, 'mime_type' => $mime];
    }

    private function profilePayload(int $userId, string $name, array $storedProfile, mixed $subjects): array
    {
        return [
            'name' => $name,
            'school' => (string)($storedProfile['school_name'] ?? ''),
            'phone' => (string)($storedProfile['phone_number'] ?? ''),
            'region' => (string)($storedProfile['region'] ?? ''),
            'district' => (string)($storedProfile['district'] ?? ''),
            'school_type' => (string)($storedProfile['school_type'] ?? ''),
            'department' => (string)($storedProfile['department'] ?? ''),
            'primary_subject' => (string)($storedProfile['primary_subject'] ?? ''),
            'subjects' => is_array($subjects) ? implode(', ', array_map('strval', $subjects)) : '',
            'logo_url' => !empty($storedProfile['school_logo_path']) ? \app_url('api/workspace/profile/logo') : '',
        ];
    }

    private function deletePrivateProfileFile(string $relativePath, int $userId): void
    {
        $root = realpath(AKADEMI_STORAGE . DIRECTORY_SEPARATOR . 'profiles' . DIRECTORY_SEPARATOR . $userId);
        $path = realpath(AKADEMI_STORAGE . DIRECTORY_SEPARATOR . str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $relativePath));
        if ($root !== false && $path !== false && is_file($path)
            && str_starts_with(strtolower($path), strtolower($root . DIRECTORY_SEPARATOR))) {
            unlink($path);
        }
    }

    public function createDocument(int $userId, array $input): array
    {
        $type = (string)($input['type'] ?? '');
        $title = trim((string)($input['title'] ?? ''));
        $data = $input['data'] ?? [];
        $html = $input['html'] ?? null;
        if (!in_array($type, self::DOCUMENT_TYPES, true) || $title === '' || mb_strlen($title) > 255
            || !is_array($data) || !is_string($html) || strlen($html) > 300000) {
            throw new RuntimeException('The document is invalid or too large to save.', 422);
        }
        $subject = trim((string)($data['subject'] ?? ''));
        $year = trim((string)($data['year_group'] ?? $data['year'] ?? ''));
        $class = trim((string)($data['class_name'] ?? $data['className'] ?? ''));
        $statement = Connection::get()->prepare(
            'INSERT INTO saved_documents
             (user_id, document_type, title, subject_name, year_group, class_name, source_input, generated_content)
             VALUES (:user_id, :document_type, :title, :subject_name, :year_group, :class_name, :source_input, :generated_content)'
        );
        $statement->execute([
            'user_id' => $userId,
            'document_type' => $type,
            'title' => $title,
            'subject_name' => $subject !== '' ? mb_substr($subject, 0, 190, 'UTF-8') : null,
            'year_group' => $year !== '' ? mb_substr($year, 0, 30, 'UTF-8') : null,
            'class_name' => $class !== '' ? mb_substr($class, 0, 120, 'UTF-8') : null,
            'source_input' => json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            'generated_content' => json_encode(['html' => $html], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
        ]);
        $id = (int)Connection::get()->lastInsertId();
        return $this->getDocument($userId, $id);
    }

    public function updateDocument(int $userId, int $documentId, array $input): array
    {
        $type = (string)($input['type'] ?? '');
        $title = trim((string)($input['title'] ?? ''));
        $data = $input['data'] ?? [];
        $html = $input['html'] ?? null;
        if (!in_array($type, self::DOCUMENT_TYPES, true) || $title === '' || mb_strlen($title) > 255
            || !is_array($data) || !is_string($html) || strlen($html) > 300000) {
            throw new RuntimeException('The document is invalid or too large to save.', 422);
        }
        $pdo = Connection::get();
        $existing = $pdo->prepare(
            'SELECT document_type FROM saved_documents WHERE id = :id AND user_id = :user_id LIMIT 1'
        );
        $existing->execute(['id' => $documentId, 'user_id' => $userId]);
        $existingType = $existing->fetchColumn();
        if ($existingType === false) {
            throw new RuntimeException('Document was not found in your workspace.', 404);
        }
        if ($existingType !== $type) {
            throw new RuntimeException('The saved document type cannot be changed.', 422);
        }
        $subject = trim((string)($data['subject'] ?? ''));
        $year = trim((string)($data['year_group'] ?? $data['year'] ?? ''));
        $class = trim((string)($data['class_name'] ?? $data['className'] ?? ''));
        $update = $pdo->prepare(
            'UPDATE saved_documents SET title = :title, subject_name = :subject_name,
             year_group = :year_group, class_name = :class_name, source_input = :source_input,
             generated_content = :generated_content, updated_at = UTC_TIMESTAMP()
             WHERE id = :id AND user_id = :user_id'
        );
        $update->execute([
            'id' => $documentId,
            'user_id' => $userId,
            'title' => $title,
            'subject_name' => $subject !== '' ? mb_substr($subject, 0, 190, 'UTF-8') : null,
            'year_group' => $year !== '' ? mb_substr($year, 0, 30, 'UTF-8') : null,
            'class_name' => $class !== '' ? mb_substr($class, 0, 120, 'UTF-8') : null,
            'source_input' => json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            'generated_content' => json_encode(['html' => $html], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
        ]);
        return $this->getDocument($userId, $documentId);
    }

    public function deleteDocument(int $userId, int $documentId): void
    {
        $statement = Connection::get()->prepare('DELETE FROM saved_documents WHERE id = :id AND user_id = :user_id');
        $statement->execute(['id' => $documentId, 'user_id' => $userId]);
        if ($statement->rowCount() === 0) {
            throw new RuntimeException('Document was not found in your workspace.', 404);
        }
    }

    public function setDocumentArchived(int $userId, int $documentId, bool $archived): array
    {
        $status = $archived ? 'archived' : 'draft';
        $statement = Connection::get()->prepare(
            'UPDATE saved_documents SET status = :status, updated_at = UTC_TIMESTAMP()
             WHERE id = :id AND user_id = :user_id'
        );
        $statement->execute(['status' => $status, 'id' => $documentId, 'user_id' => $userId]);
        if ($statement->rowCount() === 0) {
            $exists = Connection::get()->prepare(
                'SELECT 1 FROM saved_documents WHERE id = :id AND user_id = :user_id'
            );
            $exists->execute(['id' => $documentId, 'user_id' => $userId]);
            if (!$exists->fetchColumn()) {
                throw new RuntimeException('Document was not found in your workspace.', 404);
            }
        }
        return ['id' => (string)$documentId, 'status' => $status];
    }

    public function createScheduleEntry(int $userId, array $input): array
    {
        $entry = $this->cleanScheduleEntry($input);
        $statement = Connection::get()->prepare(
            'INSERT INTO teacher_schedule_entries
             (user_id, weekday, start_time, end_time, subject_name, class_name, topic, color, starts_on, repeat_mode, repeat_interval_weeks, repeat_until)
             VALUES (:user_id, :weekday, :start_time, :end_time, :subject_name, :class_name, :topic, :color, :starts_on, :repeat_mode, :repeat_interval_weeks, :repeat_until)'
        );
        $statement->execute([
            'user_id' => $userId,
            'weekday' => $entry['day'],
            'start_time' => $entry['time'] . ':00',
            'end_time' => $entry['endTime'] . ':00',
            'subject_name' => $entry['subject'],
            'class_name' => $entry['className'] !== '' ? $entry['className'] : null,
            'topic' => $entry['topic'] !== '' ? $entry['topic'] : null,
            'color' => $entry['color'],
            'starts_on' => $entry['startsOn'] !== '' ? $entry['startsOn'] : null,
            'repeat_mode' => $entry['repeatMode'],
            'repeat_interval_weeks' => $entry['repeatIntervalWeeks'],
            'repeat_until' => $entry['repeatUntil'] !== '' ? $entry['repeatUntil'] : null,
        ]);
        return ['id' => (string)Connection::get()->lastInsertId()] + $entry;
    }

    public function updateScheduleEntry(int $userId, int $entryId, array $input): array
    {
        $entry = $this->cleanScheduleEntry($input);
        $statement = Connection::get()->prepare(
            'UPDATE teacher_schedule_entries SET weekday = :weekday, start_time = :start_time,
             end_time = :end_time, subject_name = :subject_name, class_name = :class_name,
             topic = :topic, color = :color, starts_on = :starts_on,
             repeat_mode = :repeat_mode, repeat_interval_weeks = :repeat_interval_weeks, repeat_until = :repeat_until
             WHERE id = :id AND user_id = :user_id'
        );
        $statement->execute([
            'weekday' => $entry['day'],
            'start_time' => $entry['time'] . ':00',
            'end_time' => $entry['endTime'] . ':00',
            'subject_name' => $entry['subject'],
            'class_name' => $entry['className'] !== '' ? $entry['className'] : null,
            'topic' => $entry['topic'] !== '' ? $entry['topic'] : null,
            'color' => $entry['color'],
            'starts_on' => $entry['startsOn'] !== '' ? $entry['startsOn'] : null,
            'repeat_mode' => $entry['repeatMode'],
            'repeat_interval_weeks' => $entry['repeatIntervalWeeks'],
            'repeat_until' => $entry['repeatUntil'] !== '' ? $entry['repeatUntil'] : null,
            'id' => $entryId,
            'user_id' => $userId,
        ]);
        if ($statement->rowCount() === 0) {
            $exists = Connection::get()->prepare('SELECT 1 FROM teacher_schedule_entries WHERE id = :id AND user_id = :user_id');
            $exists->execute(['id' => $entryId, 'user_id' => $userId]);
            if (!$exists->fetchColumn()) {
                throw new RuntimeException('Schedule entry was not found in your workspace.', 404);
            }
        }
        return ['id' => (string)$entryId] + $entry;
    }

    public function deleteScheduleEntry(int $userId, int $entryId): void
    {
        $statement = Connection::get()->prepare('DELETE FROM teacher_schedule_entries WHERE id = :id AND user_id = :user_id');
        $statement->execute(['id' => $entryId, 'user_id' => $userId]);
        if ($statement->rowCount() === 0) {
            throw new RuntimeException('Schedule entry was not found in your workspace.', 404);
        }
    }

    private function cleanScheduleEntry(array $input): array
    {
        $day = (string)($input['day'] ?? '');
        $time = (string)($input['time'] ?? '');
        $endTime = (string)($input['endTime'] ?? '');
        $subject = trim((string)($input['subject'] ?? ''));
        $class = trim((string)($input['className'] ?? ''));
        $topic = trim((string)($input['topic'] ?? ''));
        $color = strtolower((string)($input['color'] ?? '#398c69'));
        $startsOn = trim((string)($input['startsOn'] ?? ''));
        $repeatMode = strtolower(trim((string)($input['repeatMode'] ?? 'weekly')));
        $repeatIntervalWeeks = filter_var($input['repeatIntervalWeeks'] ?? 1, FILTER_VALIDATE_INT);
        $repeatUntil = trim((string)($input['repeatUntil'] ?? ''));
        $validDate = static fn(string $date): bool => $date === ''
            || (bool)preg_match('/^\d{4}-\d{2}-\d{2}$/D', $date)
                && \DateTimeImmutable::createFromFormat('!Y-m-d', $date)?->format('Y-m-d') === $date;
        if ($repeatIntervalWeeks === false || $repeatIntervalWeeks < 1 || $repeatIntervalWeeks > 52
            || !$validDate($startsOn) || !$validDate($repeatUntil)) {
            throw new RuntimeException('Check the weekday, class times, color and valid recurrence dates, then try again.', 422);
        }
        $normalizedRepeatMode = $repeatMode === 'custom' ? 'custom' : ($repeatMode === 'daily' ? 'daily' : 'weekly');
        if ($normalizedRepeatMode === 'daily') {
            $startsOn = $startsOn !== '' ? $startsOn : (new \DateTimeImmutable('today'))->format('Y-m-d');
            $repeatIntervalWeeks = 1;
            $repeatUntil = $repeatUntil !== '' ? $repeatUntil : '';
        }
        if ($normalizedRepeatMode === 'weekly') {
            $startsOn = '';
            $repeatUntil = '';
            $repeatIntervalWeeks = 1;
        }
        if ($normalizedRepeatMode === 'custom') {
            $repeatIntervalWeeks = (int)$repeatIntervalWeeks;
        }
        if (!in_array($repeatMode, ['weekly', 'daily', 'custom'], true)
            || !in_array($day, self::WEEKDAYS, true)
            || ($normalizedRepeatMode === 'daily' && !in_array($day, self::SCHOOL_DAYS, true))
            || !preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/D', $time)
            || !preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/D', $endTime)
            || $endTime <= $time
            || $subject === '' || mb_strlen($subject) > 190
            || mb_strlen($class) > 120 || mb_strlen($topic) > 255
            || !preg_match('/^#[0-9a-f]{6}$/D', $color)
            || ($normalizedRepeatMode === 'custom' && $startsOn === '')
            || ($normalizedRepeatMode === 'custom' && $startsOn !== '' && (new \DateTimeImmutable($startsOn))->format('l') !== $day)
            || ($repeatUntil !== '' && $repeatUntil < $startsOn)
            || ($normalizedRepeatMode === 'weekly' && $startsOn !== '')) {
            throw new RuntimeException('Check the weekday, class times, color and valid recurrence dates, then try again.', 422);
        }
        return [
            'day' => $day,
            'time' => $time,
            'endTime' => $endTime,
            'subject' => $subject,
            'className' => $class,
            'topic' => $topic,
            'color' => $color,
            'startsOn' => $startsOn,
            'repeatMode' => $normalizedRepeatMode,
            'repeatIntervalWeeks' => $repeatIntervalWeeks,
            'repeatUntil' => $repeatUntil,
        ];
    }

    private function getDocument(int $userId, int $documentId): array
    {
        $statement = Connection::get()->prepare(
            'SELECT id, document_type, title, subject_name, year_group, class_name, status,
                    source_input, generated_content, created_at
             FROM saved_documents WHERE id = :id AND user_id = :user_id LIMIT 1'
        );
        $statement->execute(['id' => $documentId, 'user_id' => $userId]);
        $row = $statement->fetch();
        if (!$row) {
            throw new RuntimeException('Saved document could not be loaded.', 500);
        }
        return $this->mapDocument($row);
    }

    private function mapDocument(array $row): array
    {
        $data = $this->decodeJson($row['source_input'] ?? null);
        $generated = $this->decodeJson($row['generated_content'] ?? null);
        return [
            'id' => (string)$row['id'],
            'type' => (string)$row['document_type'],
            'title' => (string)$row['title'],
            'subject' => (string)($row['subject_name'] ?? ''),
            'year' => (string)($row['year_group'] ?? ''),
            'className' => (string)($row['class_name'] ?? ''),
            'status' => (string)($row['status'] ?? 'draft'),
            'createdAt' => gmdate('c', strtotime((string)$row['created_at'] . ' UTC')),
            'data' => $data,
            'html' => (string)($generated['html'] ?? ''),
        ];
    }

    private function decodeJson(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }
        if (!is_string($value) || $value === '') {
            return [];
        }
        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }
}
