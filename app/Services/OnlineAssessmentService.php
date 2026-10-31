<?php
declare(strict_types=1);

namespace Akademi\Services;

use Akademi\Database\Connection;
use Akademi\Security\SecretCipher;
use PDO;
use RuntimeException;

final class OnlineAssessmentService
{
    private const ACCESS_CODE_PATTERN = '/^[A-Z0-9]{8,32}$/D';
    private const MAX_FAILED_ACCESS_CODES = 20;
    private const EVENT_TYPES = ['tab_hidden', 'window_blur', 'fullscreen_exit', 'copy_attempt', 'paste_attempt', 'context_menu', 'cut_attempt', 'screenshot_attempt'];

    public function publish(int $ownerId, array $input): array
    {
        $subject = trim((string)($input['subject'] ?? ''));
        $title = trim((string)($input['title'] ?? ''));
        $assessmentType = (string)($input['assessment_type'] ?? '');
        $questionFormat = (string)($input['question_format'] ?? '');
        $securityLevel = (string)($input['security_level'] ?? 'medium');
        $accessMode = (string)($input['access_mode'] ?? 'individual_code');
        $teacherCode = strtoupper(preg_replace('/[\s-]+/', '', trim((string)($input['teacher_access_code'] ?? ''))) ?? '');
        $duration = filter_var($input['duration_minutes'] ?? null, FILTER_VALIDATE_INT);
        $availabilityDays = filter_var($input['availability_days'] ?? 7, FILTER_VALIDATE_INT);
        $totalMarks = filter_var($input['total_marks'] ?? null, FILTER_VALIDATE_INT);
        $questions = $input['questions'] ?? null;
        $classIds = $input['class_ids'] ?? [];
        $legacyClassName = trim((string)($input['class_name'] ?? ''));
        $legacyStudents = $input['students'] ?? null;
        if ($subject === '' || mb_strlen($subject) > 190
            || $title === '' || mb_strlen($title) > 190
            || !in_array($assessmentType, ['class_exercise', 'mid_semester', 'end_of_semester', 'mock'], true)
            || !in_array($questionFormat, ['mixed', 'mcq', 'worked', 'extended', 'brief', 'other'], true)
            || !in_array($securityLevel, ['medium', 'advanced'], true)
            || !in_array($accessMode, ['none', 'teacher_code', 'individual_code'], true)
            || ($accessMode === 'teacher_code' && !preg_match(self::ACCESS_CODE_PATTERN, $teacherCode))
            || ($accessMode !== 'teacher_code' && $teacherCode !== '')
            || $duration === false || $duration < 10 || $duration > 300
            || $availabilityDays === false || $availabilityDays < 1 || $availabilityDays > 90
            || $totalMarks === false || $totalMarks < 1 || $totalMarks > 500
            || !is_array($questions) || $questions === [] || count($questions) > 100
            || !is_array($classIds) || count($classIds) > 30
            || ($classIds === [] && ($legacyClassName === '' || !is_array($legacyStudents) || $legacyStudents === [] || count($legacyStudents) > 300))) {
            throw new RuntimeException('Choose one or more classes and provide valid assessment settings, questions and access-code options.', 422);
        }

        $cleanQuestions = [];
        $questionMarks = 0;
        foreach (array_values($questions) as $index => $question) {
            if (!is_array($question) || !is_string($question['prompt'] ?? null)
                || trim($question['prompt']) === '' || mb_strlen($question['prompt']) > 5000
                || !is_int($question['marks'] ?? null) || $question['marks'] < 1
                || !in_array($question['question_type'] ?? '', ['mcq', 'worked', 'extended', 'brief', 'other'], true)) {
                throw new RuntimeException('One or more assessment questions are invalid. Regenerate and review the assessment.', 422);
            }
            $clean = [
                'prompt' => $question['question_type'] === 'mcq'
                    ? self::removeEmbeddedMcqOptions(trim($question['prompt']))
                    : trim($question['prompt']),
                'marks' => $question['marks'],
                'question_type' => $question['question_type'],
                'expected_answer' => is_string($question['expected_answer'] ?? null) ? mb_substr($question['expected_answer'], 0, 5000) : '',
            ];
            if (isset($question['visual'])) {
                $clean['visual'] = self::cleanQuestionVisual($question['visual']);
            }
            if ($clean['question_type'] === 'mcq') {
                if (!is_array($question['options'] ?? null) || count($question['options']) !== 4
                    || array_filter($question['options'], static fn(mixed $option): bool => is_string($option) && trim($option) !== '') !== $question['options']
                    || !is_int($question['correct_option'] ?? null) || $question['correct_option'] < 0 || $question['correct_option'] > 3) {
                    throw new RuntimeException('A multiple-choice question is missing its options or correct answer.', 422);
                }
                $clean['options'] = array_map(static fn(string $option): string => trim($option), $question['options']);
                $clean['correct_option'] = $question['correct_option'];
            }
            $questionMarks += $clean['marks'];
            $cleanQuestions[] = $clean;
        }
        if ($questionMarks !== $totalMarks) {
            throw new RuntimeException('Question marks must add up exactly to the assessment total before it can be published.', 422);
        }
        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $classes = [];
            if ($classIds !== []) {
                $normalizedClassIds = [];
                foreach ($classIds as $classId) {
                    $id = filter_var($classId, FILTER_VALIDATE_INT);
                    if ($id === false || $id < 1 || isset($normalizedClassIds[$id])) {
                        throw new RuntimeException('One or more selected classes are invalid.', 422);
                    }
                    $normalizedClassIds[$id] = $id;
                }
                $placeholders = implode(',', array_fill(0, count($normalizedClassIds), '?'));
                $classQuery = $pdo->prepare(
                    "SELECT id, name, subject_name, year_group FROM assessment_classes
                     WHERE owner_user_id = ? AND archived_at IS NULL AND id IN ({$placeholders}) ORDER BY id"
                );
                $classQuery->execute([$ownerId, ...array_values($normalizedClassIds)]);
                $classes = $classQuery->fetchAll();
                if (count($classes) !== count($normalizedClassIds)) {
                    throw new RuntimeException('One or more selected classes are no longer available in your account. Refresh the class list.', 409);
                }
                $studentCount = 0;
                $rosterQuery = $pdo->prepare('SELECT id, learner_name FROM assessment_roster WHERE class_id = :class ORDER BY id');
                foreach ($classes as &$class) {
                    $subjectsQuery = $pdo->prepare(
                        'SELECT subject_name FROM assessment_class_subjects WHERE class_id = :class ORDER BY subject_name'
                    );
                    $subjectsQuery->execute(['class' => (int)$class['id']]);
                    $class['subjects'] = array_map(
                        static fn(array $row): string => (string)$row['subject_name'],
                        $subjectsQuery->fetchAll()
                    );
                    if ($class['subjects'] === []) {
                        $class['subjects'] = [(string)$class['subject_name']];
                    }
                    if (!in_array(mb_strtolower($subject, 'UTF-8'), array_map(
                        static fn(string $name): string => mb_strtolower($name, 'UTF-8'),
                        $class['subjects']
                    ), true)) {
                        throw new RuntimeException('Every selected class must include the assessment subject in its subject list.', 422);
                    }
                    $rosterQuery->execute(['class' => (int)$class['id']]);
                    $class['roster'] = $rosterQuery->fetchAll();
                    if ($class['roster'] === []) {
                        throw new RuntimeException('Add at least one learner to every selected class before publishing.', 422);
                    }
                    $studentCount += count($class['roster']);
                }
                unset($class);
                if ($studentCount > 300) {
                    throw new RuntimeException('The selected classes contain more than 300 learners. Choose fewer classes or reduce their rosters.', 422);
                }
            } else {
                if (mb_strlen($legacyClassName) > 160 || !in_array((string)($input['year_group'] ?? ''), ['SHS1', 'SHS2', 'SHS3'], true)) {
                    throw new RuntimeException('Provide a valid class name and SHS year.', 422);
                }
                $legacyNames = [];
                foreach ($legacyStudents as $student) {
                    if (!is_string($student) || trim($student) === '' || mb_strlen(trim($student)) > 160) {
                        throw new RuntimeException('Each learner must have a name of 1–160 characters.', 422);
                    }
                    $name = trim($student);
                    $normalized = mb_strtolower($name, 'UTF-8');
                    if (isset($legacyNames[$normalized])) throw new RuntimeException("The roster contains a duplicate learner name: {$name}.", 422);
                    $legacyNames[$normalized] = $name;
                }
                $pdo->prepare(
                    'INSERT INTO assessment_classes (owner_user_id, name, subject_name, year_group)
                     VALUES (:owner, :name, :subject, :year_group)'
                )->execute(['owner' => $ownerId, 'name' => $legacyClassName, 'subject' => $subject, 'year_group' => $input['year_group']]);
                $classId = (int)$pdo->lastInsertId();
                $pdo->prepare('INSERT INTO assessment_class_subjects (class_id, subject_name) VALUES (:class, :subject)')
                    ->execute(['class' => $classId, 'subject' => $subject]);
                $insertRoster = $pdo->prepare(
                    'INSERT INTO assessment_roster (class_id, learner_name, access_code_hash)
                     VALUES (:class, :name, :hash)'
                );
                foreach ($legacyNames as $name) {
                    $insertRoster->execute(['class' => $classId, 'name' => $name, 'hash' => hash('sha256', random_bytes(32), true)]);
                }
                $rosterQuery = $pdo->prepare('SELECT id, learner_name FROM assessment_roster WHERE class_id = :class ORDER BY id');
                $rosterQuery->execute(['class' => $classId]);
                $classes[] = ['id' => $classId, 'name' => $legacyClassName, 'subject_name' => $subject, 'year_group' => $input['year_group'], 'roster' => $rosterQuery->fetchAll()];
            }
            $primaryClass = $classes[0];
            $shareToken = bin2hex(random_bytes(32));
            $pdo->prepare(
                'INSERT INTO online_assessments
                 (owner_user_id, share_token, class_id, title, subject_name, assessment_type, question_format, duration_minutes, total_marks, instructions, security_level, access_mode, teacher_access_code_hash, questions_json, duration_days, expires_at)
                 VALUES (:owner, :share_token, :class_id, :title, :subject, :assessment_type, :question_format, :duration, :total_marks, :instructions, :security_level, :access_mode, :teacher_code_hash, :questions, :days, DATE_ADD(UTC_TIMESTAMP(), INTERVAL :days_expiry DAY))'
            )->execute([
                'owner' => $ownerId,
                'share_token' => $shareToken,
                'class_id' => (int)$primaryClass['id'],
                'title' => $title,
                'subject' => $subject,
                'assessment_type' => $assessmentType,
                'question_format' => $questionFormat,
                'duration' => $duration,
                'total_marks' => $totalMarks,
                'instructions' => mb_substr(trim((string)($input['instructions'] ?? '')), 0, 4000),
                'security_level' => $securityLevel,
                'access_mode' => $accessMode,
                'teacher_code_hash' => $accessMode === 'teacher_code' ? hash('sha256', $teacherCode, true) : null,
                'questions' => json_encode($cleanQuestions, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'days' => $availabilityDays,
                'days_expiry' => $availabilityDays,
            ]);
            $assessmentId = (int)$pdo->lastInsertId();
            $insertClass = $pdo->prepare('INSERT INTO online_assessment_classes (assessment_id, class_id) VALUES (:assessment, :class)');
            $insertParticipant = $pdo->prepare(
                'INSERT INTO online_assessment_roster (assessment_id, roster_id, access_code_hash, access_code_encrypted)
                 VALUES (:assessment, :roster, :code_hash, :encrypted_code)'
            );
            $accessCodes = [];
            $classNames = [];
            foreach ($classes as $class) {
                $classId = (int)$class['id'];
                $classNames[] = (string)$class['name'];
                $insertClass->execute(['assessment' => $assessmentId, 'class' => $classId]);
                foreach ($class['roster'] as $student) {
                    $code = $accessMode === 'individual_code' ? strtoupper(bin2hex(random_bytes(8))) : null;
                    $insertParticipant->execute([
                        'assessment' => $assessmentId,
                        'roster' => (int)$student['id'],
                        'code_hash' => $code === null ? null : hash('sha256', $code, true),
                        'encrypted_code' => $code === null ? null : SecretCipher::encrypt($code, 'assessment-roster-code-v1'),
                    ]);
                    if ($code !== null) {
                        $accessCodes[] = [
                            'class_name' => (string)$class['name'],
                            'learner_name' => (string)$student['learner_name'],
                            'access_code' => $code,
                        ];
                    }
                }
            }
            $pdo->commit();
            return [
                'assessment_id' => $assessmentId,
                'title' => $title,
                'status' => 'published',
                'duration_days' => $availabilityDays,
                'expires_at' => gmdate('Y-m-d H:i:s', time() + $availabilityDays * 86400),
                'classes' => $classNames,
                'access_mode' => $accessMode,
                'security_level' => $securityLevel,
                'take_url' => \app_url('assessment/take?assessment=' . $shareToken),
                'access_codes' => $accessCodes,
            ];
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
    }

    public static function securityGuidance(string $level): string
    {
        if ($level === 'advanced') {
            return 'Advanced security: use a supervised setting and one device per learner. Keep this browser tab open and fullscreen enabled. Tab changes, focus loss, fullscreen exits, copy/cut/paste, context-menu and some screenshot-shortcut attempts may be recorded; supported browsers block some of these actions. No browser can prevent every operating-system screenshot, external app, second device or camera. If fullscreen is unavailable, tell your teacher before continuing. Follow your teacher’s instructions and ask for help if your connection drops.';
        }
        return 'Medium security: use a supervised setting and keep this assessment in one browser tab. The server controls your timer and single-use code. Tab changes, focus loss, copy/cut/paste, context-menu and some screenshot-shortcut attempts may be recorded; supported browsers block some of these actions. These signals are not proof of misconduct, and no browser can prevent every operating-system screenshot, external app, device or camera.';
    }

    private function cleanShareToken(string $token): string
    {
        $token = strtolower(trim($token));
        if (!preg_match('/^[a-f0-9]{64}$/D', $token)) throw new RuntimeException('This assessment link is invalid. Ask your teacher for the current link.', 404);
        return $token;
    }

    public function publicInfo(string $token): array
    {
        $this->processExpiredResults();
        $token = $this->cleanShareToken($token);
        $statement = Connection::get()->prepare(
            'SELECT a.title, a.assessment_type, a.duration_minutes, a.security_level, a.instructions,
                    a.access_mode,
                    a.status, a.expires_at, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), a.expires_at) AS availability_remaining_seconds,
                    a.subject_name, a.questions_json
             FROM online_assessments a JOIN assessment_classes c ON c.id = a.class_id
             WHERE a.share_token = :token LIMIT 1'
        );
        $statement->execute(['token' => $token]);
        $row = $statement->fetch();
        if (!$row) throw new RuntimeException('This assessment link is invalid or no longer available.', 404);
        if ($row['status'] === 'draft') {
            throw new RuntimeException('This assessment has been unpublished and is not currently available.', 410);
        }
        if ($row['status'] === 'expired' || ($row['status'] === 'published' && (int)$row['availability_remaining_seconds'] <= 0)) {
            throw new RuntimeException('This assessment link has expired. Contact your teacher.', 410);
        }
        $questions = json_decode((string)$row['questions_json'], true, 64, JSON_THROW_ON_ERROR);
        $classQuery = Connection::get()->prepare(
            'SELECT c.id, c.name, ac.status FROM online_assessment_classes ac
             JOIN assessment_classes c ON c.id = ac.class_id
             WHERE ac.assessment_id = (SELECT id FROM online_assessments WHERE share_token = :token)
             ORDER BY c.name'
        );
        $classQuery->execute(['token' => $token]);
        $classes = array_map(static fn(array $class): array => [
            'id' => (int)$class['id'],
            'name' => (string)$class['name'],
            'status' => (string)$class['status'],
        ], $classQuery->fetchAll());
        return [
            'title' => (string)$row['title'], 'class_name' => implode(', ', array_column($classes, 'name')),
            'classes' => $classes, 'access_mode' => (string)$row['access_mode'],
            'subject' => (string)$row['subject_name'], 'assessment_type' => (string)$row['assessment_type'],
            'duration_minutes' => (int)$row['duration_minutes'], 'security_level' => (string)$row['security_level'],
            'security_instructions' => self::securityGuidance((string)$row['security_level']),
            'instructions' => (string)$row['instructions'], 'question_count' => count($questions),
            'status' => (string)$row['status'], 'expires_at' => (string)$row['expires_at'],
            'availability_remaining_seconds' => max(0, (int)$row['availability_remaining_seconds']),
        ];
    }

    public function rosterSuggestions(string $token, int $classId, string $query): array
    {
        $token = $this->cleanShareToken($token);
        $query = trim($query);
        if (mb_strlen($query) < 2) return ['learners' => []];
        $statement = Connection::get()->prepare(
            'SELECT r.id, r.learner_name FROM assessment_roster r
             JOIN assessment_classes c ON c.id = r.class_id
             JOIN online_assessment_classes ac ON ac.class_id = c.id
             JOIN online_assessments a ON a.id = ac.assessment_id
             JOIN online_assessment_roster ar ON ar.assessment_id = a.id AND ar.roster_id = r.id
             WHERE a.share_token = :token AND a.status = :status AND a.expires_at > UTC_TIMESTAMP()
               AND ar.access_used_at IS NULL AND ac.status = :class_status AND c.id = :class_id
               AND r.learner_name LIKE :query
             ORDER BY r.learner_name, r.id LIMIT 10'
        );
        $statement->execute(['token' => $token, 'status' => 'published', 'class_status' => 'active', 'class_id' => $classId, 'query' => '%' . $query . '%']);
        return ['learners' => array_map(static fn(array $row): array => ['id' => (int)$row['id'], 'name' => (string)$row['learner_name'], 'learner_name' => (string)$row['learner_name']], $statement->fetchAll())];
    }

    public function enrollAndStart(string $token, int $classId, int $rosterId, string $accessCode): array
    {
        $token = $this->cleanShareToken($token);
        if ($classId < 1 || $rosterId < 1) throw new RuntimeException('Select your class and name from the roster.', 422);
        $assessmentQuery = Connection::get()->prepare('SELECT id FROM online_assessments WHERE share_token = :token');
        $assessmentQuery->execute(['token' => $token]);
        $assessmentId = (int)$assessmentQuery->fetchColumn();
        if ($assessmentId < 1) throw new RuntimeException('This assessment link is invalid or no longer available.', 404);
        return $this->startRosterAttempt($assessmentId, $classId, $rosterId, $accessCode);
    }

    private function recordFailedAccessCode(): void
    {
        $address = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
        $appKey = (string)\env('APP_KEY', 'akademi');
        $ipHash = hash_hmac('sha256', $address, $appKey, true);
        $pdo = Connection::get();
        $pdo->prepare(
            'INSERT INTO assessment_access_rate_limits (ip_hash, attempts, window_started_at)
             VALUES (:ip_hash, 1, UTC_TIMESTAMP())
             ON DUPLICATE KEY UPDATE
               attempts = IF(window_started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE), 1, attempts + 1),
               window_started_at = IF(window_started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE), UTC_TIMESTAMP(), window_started_at)'
        )->execute(['ip_hash' => $ipHash]);
        $statement = $pdo->prepare('SELECT attempts FROM assessment_access_rate_limits WHERE ip_hash = :ip_hash');
        $statement->execute(['ip_hash' => $ipHash]);
        if ((int)$statement->fetchColumn() > self::MAX_FAILED_ACCESS_CODES) {
            throw new RuntimeException('Too many incorrect access code attempts. Wait ten minutes and try again.', 429);
        }
    }

    public function preview(string $code, ?string $assessmentToken = null): array
    {
        $code = strtoupper(preg_replace('/[\s-]+/', '', trim($code)) ?? '');
        if (!preg_match(self::ACCESS_CODE_PATTERN, $code)) {
            $this->recordFailedAccessCode();
            throw new RuntimeException('Enter the 12- or 16-character learner access code provided by your teacher.', 422);
        }
        $tokenConstraint = $assessmentToken === null ? '' : ' AND a.share_token = :token';
        $statement = Connection::get()->prepare(
            'SELECT ar.access_used_at, a.status, a.title, a.duration_minutes, a.security_level, a.questions_json, a.id
             FROM online_assessment_roster ar JOIN online_assessments a ON a.id = ar.assessment_id
             WHERE ar.access_code_hash = :code_hash' . $tokenConstraint . ' LIMIT 2'
        );
        $parameters = ['code_hash' => hash('sha256', $code, true)];
        if ($assessmentToken !== null) $parameters['token'] = $this->cleanShareToken($assessmentToken);
        $statement->execute($parameters);
        $matches = $statement->fetchAll();
        if (count($matches) > 1) {
            throw new RuntimeException('This code is used for more than one assessment. Open the assessment link shared by your teacher.', 409);
        }
        $row = $matches[0] ?? null;
        if (!$row || $row['status'] !== 'published') {
            $this->recordFailedAccessCode();
            throw new RuntimeException('This access code is not valid for an open assessment. Check it with your teacher.', 404);
        }
        if ($row['access_used_at'] !== null) {
            $this->recordFailedAccessCode();
            throw new RuntimeException('This single-use access code has already started an attempt. Ask your teacher for help.', 409);
        }
        $questions = json_decode((string)$row['questions_json'], true, 64, JSON_THROW_ON_ERROR);
        $level = (string)$row['security_level'];
        $duration = (int)$row['duration_minutes'];
        return [
            'title' => (string)$row['title'],
            'security_level' => $level,
            'security_instructions' => self::securityGuidance($level),
            'duration_minutes' => $duration,
            'question_count' => count($questions),
            'average_seconds_per_question' => (int)round(($duration * 60) / max(1, count($questions))),
        ];
    }

    public function listClasses(int $ownerId): array
    {
        $statement = Connection::get()->prepare(
            'SELECT c.id, c.name, c.subject_name, c.year_group, c.created_at, c.archived_at,
                    COUNT(r.id) AS learner_count
             FROM assessment_classes c
             LEFT JOIN assessment_roster r ON r.class_id = c.id
             WHERE c.owner_user_id = :owner
             GROUP BY c.id
             ORDER BY c.name, c.id'
        );
        $statement->execute(['owner' => $ownerId]);
        $classes = $statement->fetchAll();
        $roster = Connection::get()->prepare(
            'SELECT id, learner_name FROM assessment_roster WHERE class_id = :class ORDER BY learner_name, id'
        );
        $subjects = Connection::get()->prepare(
            'SELECT subject_name FROM assessment_class_subjects WHERE class_id = :class ORDER BY subject_name'
        );
        foreach ($classes as &$class) {
            $roster->execute(['class' => (int)$class['id']]);
            $class['students'] = $roster->fetchAll();
            $subjects->execute(['class' => (int)$class['id']]);
            $class['subjects'] = array_map(
                static fn(array $row): string => (string)$row['subject_name'],
                $subjects->fetchAll()
            );
            if ($class['subjects'] === []) $class['subjects'] = [(string)$class['subject_name']];
            $class['learner_count'] = (int)$class['learner_count'];
        }
        unset($class);
        return ['classes' => $classes];
    }

    public function saveClass(int $ownerId, array $input): array
    {
        $classId = isset($input['id']) ? filter_var($input['id'], FILTER_VALIDATE_INT) : null;
        $name = trim((string)($input['name'] ?? ''));
        $subjects = $input['subjects'] ?? (isset($input['subject']) ? [$input['subject']] : []);
        $yearGroup = (string)($input['year_group'] ?? '');
        $students = $input['students'] ?? null;
        if (($classId !== null && ($classId === false || $classId < 1))
            || $name === '' || mb_strlen($name) > 160
            || !is_array($subjects) || $subjects === [] || count($subjects) > 20
            || !in_array($yearGroup, ['SHS1', 'SHS2', 'SHS3'], true)
            || !is_array($students) || count($students) > 300) {
            throw new RuntimeException('Enter a class name, at least one subject, an SHS year, and no more than 300 learner names.', 422);
        }
        $cleanSubjects = [];
        foreach ($subjects as $subject) {
            if (!is_string($subject) || trim($subject) === '' || mb_strlen(trim($subject)) > 190) {
                throw new RuntimeException('Each subject must contain 1–190 characters.', 422);
            }
            $subject = trim($subject);
            $key = mb_strtolower($subject, 'UTF-8');
            if (!isset($cleanSubjects[$key])) $cleanSubjects[$key] = $subject;
        }
        $cleanSubjects = array_values($cleanSubjects);
        $primarySubject = $cleanSubjects[0];
        $cleanStudents = [];
        foreach ($students as $student) {
            if (!is_string($student) || trim($student) === '' || mb_strlen(trim($student)) > 160) {
                throw new RuntimeException('Each learner name must contain 1–160 characters.', 422);
            }
            $learner = trim($student);
            $key = mb_strtolower($learner, 'UTF-8');
            if (isset($cleanStudents[$key])) throw new RuntimeException("The class roster contains a duplicate learner name: {$learner}.", 422);
            $cleanStudents[$key] = $learner;
        }

        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $duplicateQuery = $pdo->prepare(
                'SELECT id FROM assessment_classes
                 WHERE owner_user_id = :owner AND name = :name' . ($classId === null ? '' : ' AND id <> :current') . ' LIMIT 1'
            );
            $duplicateParameters = ['owner' => $ownerId, 'name' => $name];
            if ($classId !== null) $duplicateParameters['current'] = $classId;
            $duplicateQuery->execute($duplicateParameters);
            if ($duplicateQuery->fetchColumn()) throw new RuntimeException('A class with this name already exists in your account.', 409);
            if ($classId === null) {
                $pdo->prepare(
                    'INSERT INTO assessment_classes (owner_user_id, name, subject_name, year_group)
                     VALUES (:owner, :name, :subject, :year_group)'
                )->execute(['owner' => $ownerId, 'name' => $name, 'subject' => $primarySubject, 'year_group' => $yearGroup]);
                $classId = (int)$pdo->lastInsertId();
            } else {
                $ownedClass = $pdo->prepare('SELECT id FROM assessment_classes WHERE id = :id AND owner_user_id = :owner AND archived_at IS NULL FOR UPDATE');
                $ownedClass->execute(['id' => $classId, 'owner' => $ownerId]);
                if (!$ownedClass->fetchColumn()) throw new RuntimeException('The class was not found in your account.', 404);
                $pdo->prepare(
                    'UPDATE assessment_classes SET name = :name, subject_name = :subject, year_group = :year_group
                     WHERE id = :id AND owner_user_id = :owner'
                )->execute(['name' => $name, 'subject' => $primarySubject, 'year_group' => $yearGroup, 'id' => $classId, 'owner' => $ownerId]);
            }
            $pdo->prepare('DELETE FROM assessment_class_subjects WHERE class_id = :class')->execute(['class' => $classId]);
            $insertSubject = $pdo->prepare(
                'INSERT INTO assessment_class_subjects (class_id, subject_name) VALUES (:class, :subject)'
            );
            foreach ($cleanSubjects as $subject) {
                $insertSubject->execute(['class' => $classId, 'subject' => $subject]);
            }

            $existingQuery = $pdo->prepare(
                'SELECT r.id, r.learner_name,
                        EXISTS(SELECT 1 FROM assessment_attempts t WHERE t.roster_id = r.id) AS has_attempt
                 FROM assessment_roster r WHERE r.class_id = :class FOR UPDATE'
            );
            $existingQuery->execute(['class' => $classId]);
            $existing = [];
            foreach ($existingQuery->fetchAll() as $row) {
                $existing[mb_strtolower((string)$row['learner_name'], 'UTF-8')] = $row;
            }
            $insertRoster = $pdo->prepare(
                'INSERT INTO assessment_roster (class_id, learner_name, access_code_hash)
                 VALUES (:class, :name, :hash)'
            );
            $renameRoster = $pdo->prepare('UPDATE assessment_roster SET learner_name = :name WHERE id = :id');
            $deleteRoster = $pdo->prepare('DELETE FROM assessment_roster WHERE id = :id AND class_id = :class');
            $newRosterIds = [];
            foreach ($cleanStudents as $key => $learner) {
                if (isset($existing[$key])) {
                    $rosterId = (int)$existing[$key]['id'];
                    $renameRoster->execute(['name' => $learner, 'id' => $rosterId]);
                    unset($existing[$key]);
                    continue;
                }
                $insertRoster->execute([
                    'class' => $classId,
                    'name' => $learner,
                    'hash' => hash('sha256', random_bytes(32), true),
                ]);
                $newRosterIds[] = ['id' => (int)$pdo->lastInsertId(), 'name' => $learner];
            }
            foreach ($existing as $row) {
                if ((bool)$row['has_attempt']) {
                    throw new RuntimeException('A learner with an assessment attempt cannot be removed; keep their roster record for results and audit history.', 409);
                }
                $deleteRoster->execute(['id' => (int)$row['id'], 'class' => $classId]);
            }

            $assignedAssessments = $pdo->prepare(
                'SELECT a.id, a.access_mode FROM online_assessment_classes ac
                 JOIN online_assessments a ON a.id = ac.assessment_id
                 WHERE ac.class_id = :class AND a.status IN (\'published\', \'paused\', \'draft\')'
            );
            $assignedAssessments->execute(['class' => $classId]);
            $addParticipant = $pdo->prepare(
                'INSERT INTO online_assessment_roster (assessment_id, roster_id, access_code_hash, access_code_encrypted)
                 VALUES (:assessment, :roster, :code_hash, :encrypted_code)'
            );
            $newCodes = [];
            foreach ($assignedAssessments->fetchAll() as $assessment) {
                foreach ($newRosterIds as $newRoster) {
                    $code = $assessment['access_mode'] === 'individual_code' ? strtoupper(bin2hex(random_bytes(8))) : null;
                    $addParticipant->execute([
                        'assessment' => (int)$assessment['id'],
                        'roster' => $newRoster['id'],
                        'code_hash' => $code === null ? null : hash('sha256', $code, true),
                        'encrypted_code' => $code === null ? null : SecretCipher::encrypt($code, 'assessment-roster-code-v1'),
                    ]);
                    if ($code !== null) {
                        $newCodes[] = [
                            'assessment_id' => (int)$assessment['id'],
                            'class_name' => $name,
                            'learner_name' => $newRoster['name'],
                            'access_code' => $code,
                        ];
                    }
                }
            }
            $pdo->commit();
            return ['class' => ['id' => $classId, 'name' => $name, 'subject_name' => $primarySubject, 'subjects' => $cleanSubjects, 'year_group' => $yearGroup], 'new_access_codes' => $newCodes];
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $exception;
        }
    }

    public function deleteClass(int $ownerId, int $classId): array
    {
        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $ownedClass = $pdo->prepare('SELECT id, archived_at FROM assessment_classes WHERE id = :id AND owner_user_id = :owner FOR UPDATE');
            $ownedClass->execute(['id' => $classId, 'owner' => $ownerId]);
            $class = $ownedClass->fetch();
            if (!$class) throw new RuntimeException('The class was not found in your account.', 404);
            if ($class['archived_at'] !== null) {
                $pdo->commit();
                return ['deleted' => false, 'archived' => true, 'class_id' => $classId];
            }
            $linked = $pdo->prepare(
                'SELECT 1 FROM online_assessment_classes ac
                 JOIN online_assessments a ON a.id = ac.assessment_id
                 WHERE ac.class_id = :class
                 UNION
                 SELECT 1 FROM online_assessments WHERE class_id = :primary_class
                 LIMIT 1'
            );
            $linked->execute(['class' => $classId, 'primary_class' => $classId]);
            if ($linked->fetchColumn()) {
                $pdo->prepare(
                    'UPDATE assessment_classes SET archived_at = UTC_TIMESTAMP()
                     WHERE id = :id AND owner_user_id = :owner AND archived_at IS NULL'
                )->execute(['id' => $classId, 'owner' => $ownerId]);
                $pdo->commit();
                return ['deleted' => false, 'archived' => true, 'class_id' => $classId];
            }
            $delete = $pdo->prepare('DELETE FROM assessment_classes WHERE id = :id AND owner_user_id = :owner');
            $delete->execute(['id' => $classId, 'owner' => $ownerId]);
            if ($delete->rowCount() !== 1) throw new RuntimeException('The class was not found in your account.', 404);
            $pdo->commit();
            return ['deleted' => true, 'archived' => false, 'class_id' => $classId];
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $exception;
        }
    }

    public function restoreClass(int $ownerId, int $classId): array
    {
        $statement = Connection::get()->prepare(
            'UPDATE assessment_classes SET archived_at = NULL
             WHERE id = :id AND owner_user_id = :owner AND archived_at IS NOT NULL'
        );
        $statement->execute(['id' => $classId, 'owner' => $ownerId]);
        if ($statement->rowCount() !== 1) {
            throw new RuntimeException('The archived class was not found in your account.', 404);
        }
        return ['restored' => true, 'class_id' => $classId];
    }

    public function learnerPerformance(int $ownerId, int $classId, int $rosterId): array
    {
        $pdo = Connection::get();
        $learnerQuery = $pdo->prepare(
            'SELECT r.id, r.learner_name, c.id AS class_id, c.name AS class_name
             FROM assessment_roster r
             JOIN assessment_classes c ON c.id = r.class_id
             WHERE c.id = :class AND r.id = :roster AND c.owner_user_id = :owner LIMIT 1'
        );
        $learnerQuery->execute(['class' => $classId, 'roster' => $rosterId, 'owner' => $ownerId]);
        $learner = $learnerQuery->fetch();
        if (!$learner) throw new RuntimeException('The learner was not found in your class roster.', 404);
        $attemptQuery = $pdo->prepare(
            "SELECT t.id AS attempt_id, t.roster_id, t.status AS attempt_status, t.submitted_at,
                    t.auto_score, t.manual_score, t.needs_manual_review,
                    t.answers_json, t.timed_out_questions_json, t.question_reviews_json,
                    a.id AS assessment_id, a.title, a.subject_name AS subject, a.assessment_type,
                    a.total_marks, a.questions_json, a.result_published_at,
                    ir.decision AS integrity_review_decision,
                    ir.marks_deducted AS integrity_marks_deducted,
                    ir.reason AS integrity_review_reason
             FROM assessment_attempts t
             JOIN online_assessments a ON a.id = t.assessment_id
             JOIN online_assessment_roster ar ON ar.assessment_id = a.id AND ar.roster_id = t.roster_id
             LEFT JOIN assessment_integrity_reviews ir ON ir.id = (
                 SELECT MAX(ir2.id) FROM assessment_integrity_reviews ir2 WHERE ir2.attempt_id = t.id
             )
             WHERE t.roster_id = :roster AND a.owner_user_id = :owner
               AND t.status IN ('submitted', 'expired')
             ORDER BY t.submitted_at DESC, t.id DESC"
        );
        $attemptQuery->execute(['roster' => $rosterId, 'owner' => $ownerId]);
        $reports = array_map(fn(array $row): array => $this->buildAttemptPerformance($row, true), $attemptQuery->fetchAll());
        $earnedTotal = 0;
        $possibleTotal = 0;
        $pendingReviews = 0;
        $finalizedCount = 0;
        $questionTypes = [];
        foreach ($reports as $report) {
            if ($report['review_pending']) $pendingReviews++;
            if ($report['final_score'] !== null) {
                $earnedTotal += $report['final_score'];
                $possibleTotal += $report['total_marks'];
                $finalizedCount++;
            }
            foreach ($report['question_type_analysis'] as $type => $analysis) {
                $questionTypes[$type] ??= ['earned' => 0, 'possible' => 0];
                $questionTypes[$type]['earned'] += $analysis['earned'];
                $questionTypes[$type]['possible'] += $analysis['possible'];
            }
        }
        foreach ($questionTypes as &$analysis) {
            $analysis['percentage'] = $analysis['possible'] > 0
                ? round($analysis['earned'] / $analysis['possible'] * 100, 1)
                : null;
        }
        unset($analysis);
        $rankedTypes = array_filter($questionTypes, static fn(array $analysis): bool => $analysis['percentage'] !== null);
        uasort($rankedTypes, static fn(array $left, array $right): int => $right['percentage'] <=> $left['percentage']);
        $summary = [
            'assessment_count' => count($reports),
            'finalized_count' => $finalizedCount,
            'pending_review_count' => $pendingReviews,
            'earned_marks' => $earnedTotal,
            'possible_marks' => $possibleTotal,
            'overall_percentage' => $possibleTotal > 0 ? round($earnedTotal / $possibleTotal * 100, 1) : null,
            'question_type_analysis' => $questionTypes,
            'strongest_area' => $rankedTypes === [] ? null : array_key_first($rankedTypes),
            'growth_area' => $rankedTypes === [] ? null : array_key_last($rankedTypes),
        ];
        return [
            'learner' => [
                'id' => (int)$learner['id'],
                'name' => (string)$learner['learner_name'],
                'class_id' => (int)$learner['class_id'],
                'class_name' => (string)$learner['class_name'],
            ],
            'summary' => $summary,
            'assessments' => $reports,
        ];
    }

    public function studentResults(): array
    {
        $this->processExpiredResults();
        $history = $_SESSION['online_assessment_attempt_history'] ?? [];
        $learner = $_SESSION['online_assessment_learner'] ?? null;
        if (!is_array($history) || !is_array($learner) || (int)($learner['roster_id'] ?? 0) < 1) return ['results' => []];
        $pdo = Connection::get();
        $statement = $pdo->prepare(
            "SELECT t.id AS attempt_id, t.roster_id, t.status AS attempt_status, t.submitted_at,
                    t.auto_score, t.manual_score, t.needs_manual_review,
                    t.answers_json, t.timed_out_questions_json, t.question_reviews_json,
                    a.id AS assessment_id, a.title, a.subject_name AS subject, a.assessment_type,
                    a.total_marks, a.questions_json, a.result_published_at,
                    ir.decision AS integrity_review_decision,
                    ir.marks_deducted AS integrity_marks_deducted,
                    ir.reason AS integrity_review_reason
             FROM assessment_attempts t
             JOIN online_assessments a ON a.id = t.assessment_id
             LEFT JOIN assessment_integrity_reviews ir ON ir.id = (
                 SELECT MAX(ir2.id) FROM assessment_integrity_reviews ir2 WHERE ir2.attempt_id = t.id
             )
             WHERE t.id = :attempt AND t.attempt_token_hash = :token_hash
               AND t.status IN ('submitted', 'expired') LIMIT 1"
        );
        $results = [];
        foreach ($history as $attemptId => $token) {
            if (!ctype_digit((string)$attemptId) || !is_string($token) || preg_match('/^[a-f0-9]{64}$/i', $token) !== 1) continue;
            $statement->execute([
                'attempt' => (int)$attemptId,
                'token_hash' => hash('sha256', $token, true),
            ]);
            $row = $statement->fetch();
            if (!$row || (int)$row['roster_id'] !== (int)$learner['roster_id']) continue;
            if ($row['result_published_at'] === null) {
                $results[] = [
                    'attempt_id' => (int)$row['attempt_id'],
                    'title' => (string)$row['title'],
                    'subject' => (string)$row['subject'],
                    'submitted_at' => $row['submitted_at'],
                    'result_published' => false,
                    'result_status' => 'pending',
                ];
                continue;
            }
            $report = $this->buildAttemptPerformance($row, true);
            $report['result_published'] = true;
            $results[] = $report;
        }
        usort($results, static fn(array $left, array $right): int => strcmp((string)($right['submitted_at'] ?? ''), (string)($left['submitted_at'] ?? '')));
        return ['results' => $results];
    }

    private function buildAttemptPerformance(array $row, bool $includeAnswerKey): array
    {
        $questions = json_decode((string)$row['questions_json'], true, 64, JSON_THROW_ON_ERROR);
        $answers = $row['answers_json'] === null ? [] : json_decode((string)$row['answers_json'], true, 32, JSON_THROW_ON_ERROR);
        $timedOut = $row['timed_out_questions_json'] === null ? [] : json_decode((string)$row['timed_out_questions_json'], true, 32, JSON_THROW_ON_ERROR);
        $reviews = $row['question_reviews_json'] === null ? [] : json_decode((string)$row['question_reviews_json'], true, 32, JSON_THROW_ON_ERROR);
        $timedOutSet = array_fill_keys(array_map('intval', is_array($timedOut) ? $timedOut : []), true);
        $typeAnalysis = [];
        $questionReports = [];
        foreach ($questions as $index => $question) {
            if (!is_array($question)) continue;
            $type = (string)($question['question_type'] ?? 'other');
            $marks = (int)($question['marks'] ?? 0);
            $answer = is_array($answers) ? (string)($answers[(string)$index] ?? '') : '';
            $review = is_array($reviews) && is_array($reviews[(string)$index] ?? null) ? $reviews[(string)$index] : [];
            $isMcq = $type === 'mcq';
            $isCorrect = $isMcq && !isset($timedOutSet[$index]) && $answer !== ''
                && (int)$answer === (int)($question['correct_option'] ?? -1);
            $score = $isMcq
                ? ($isCorrect ? $marks : 0)
                : (isset($review['score']) ? (int)$review['score'] : null);
            if ($score !== null) {
                $typeAnalysis[$type] ??= ['earned' => 0, 'possible' => 0];
                $typeAnalysis[$type]['earned'] += $score;
                $typeAnalysis[$type]['possible'] += $marks;
            }
            $questionReport = [
                'question_number' => $index + 1,
                'question_type' => $type,
                'prompt' => (string)($question['prompt'] ?? ''),
                'marks' => $marks,
                'score' => $score,
                'learner_answer' => $answer,
                'is_correct' => $isMcq ? $isCorrect : null,
                'teacher_feedback' => (string)($review['comment'] ?? ''),
                'timed_out' => isset($timedOutSet[$index]),
            ];
            if ($includeAnswerKey) {
                $questionReport['expected_answer'] = (string)($question['expected_answer'] ?? '');
                if ($isMcq) {
                    $questionReport['options'] = array_values(is_array($question['options'] ?? null) ? $question['options'] : []);
                    $questionReport['correct_option'] = (int)($question['correct_option'] ?? -1);
                }
            }
            $questionReports[] = $questionReport;
        }
        $manualPending = (bool)$row['needs_manual_review'] && $row['manual_score'] === null;
        $autoScore = (int)$row['auto_score'];
        $integrityMarksDeducted = (int)($row['integrity_marks_deducted'] ?? 0);
        $finalScore = $manualPending || $row['attempt_status'] !== 'submitted'
            ? null
            : max(0, $autoScore + (int)($row['manual_score'] ?? 0) - $integrityMarksDeducted);
        foreach ($typeAnalysis as &$analysis) {
            $analysis['percentage'] = $analysis['possible'] > 0
                ? round($analysis['earned'] / $analysis['possible'] * 100, 1)
                : null;
        }
        unset($analysis);
        return [
            'attempt_id' => (int)$row['attempt_id'],
            'assessment_id' => (int)$row['assessment_id'],
            'title' => (string)$row['title'],
            'subject' => (string)$row['subject'],
            'assessment_type' => (string)$row['assessment_type'],
            'status' => (string)$row['attempt_status'],
            'submitted_at' => $row['submitted_at'],
            'total_marks' => (int)$row['total_marks'],
            'auto_score' => $autoScore,
            'manual_score' => $row['manual_score'] === null ? null : (int)$row['manual_score'],
            'integrity_marks_deducted' => $integrityMarksDeducted,
            'integrity_review_decision' => $row['integrity_review_decision'] ?? null,
            'integrity_review_reason' => $row['integrity_review_reason'] ?? null,
            'final_score' => $finalScore,
            'percentage' => $finalScore === null || (int)$row['total_marks'] < 1
                ? null
                : round($finalScore / (int)$row['total_marks'] * 100, 1),
            'review_pending' => $manualPending,
            'question_type_analysis' => $typeAnalysis,
            'questions' => $questionReports,
        ];
    }

    public function updateRoster(int $ownerId, int $assessmentId, array $students, bool $allowAnyOwner = false): array
    {
        if ($students === [] || count($students) > 300) {
            throw new RuntimeException('Keep between 1 and 300 learner names in the class roster.', 422);
        }
        $assessmentQuery = Connection::get()->prepare(
            'SELECT a.owner_user_id, c.id, c.name, c.subject_name, c.year_group
             FROM online_assessments a
             JOIN assessment_classes c ON c.id = a.class_id
             WHERE a.id = :id ' . ($allowAnyOwner ? '' : 'AND a.owner_user_id = :owner ') . 'LIMIT 1'
        );
        $parameters = ['id' => $assessmentId];
        if (!$allowAnyOwner) $parameters['owner'] = $ownerId;
        $assessmentQuery->execute($parameters);
        $class = $assessmentQuery->fetch();
        if (!$class) throw new RuntimeException('The assessment was not found in your account.', 404);
        $subjectsQuery = Connection::get()->prepare(
            'SELECT subject_name FROM assessment_class_subjects WHERE class_id = :class ORDER BY subject_name'
        );
        $subjectsQuery->execute(['class' => (int)$class['id']]);
        $subjects = array_map(static fn(array $row): string => (string)$row['subject_name'], $subjectsQuery->fetchAll());
        if ($subjects === []) $subjects = [(string)$class['subject_name']];

        $saved = $this->saveClass((int)$class['owner_user_id'], [
            'id' => (int)$class['id'],
            'name' => (string)$class['name'],
            'subjects' => $subjects,
            'year_group' => (string)$class['year_group'],
            'students' => $students,
        ]);
        return [
            'assessment_id' => $assessmentId,
            'new_access_codes' => $saved['new_access_codes'],
            'roster' => $students,
        ];
    }

    private static function removeEmbeddedMcqOptions(string $prompt): string
    {
        $label = '(?:\\([A-D1-4]\\)|[A-D1-4][.):])';
        $pattern = '/\\s+' . $label . '\\s+.*?\\s+' . $label . '\\s+.*?\\s+' . $label . '\\s+.*?\\s+' . $label . '\\s+.*$/is';
        if (preg_match($pattern, $prompt, $matches, PREG_OFFSET_CAPTURE) === 1) {
            return rtrim(substr($prompt, 0, $matches[0][1]));
        }
        $lines = preg_split('/\\R/', $prompt) ?: [];
        $optionLines = array_filter($lines, static function (string $line) use ($label): bool {
            return preg_match('/^\\s*' . $label . '\\s+\\S/i', $line) === 1;
        });
        if (count($optionLines) >= 3) {
            while ($lines !== [] && preg_match('/^\\s*' . $label . '\\s+\\S/i', (string)end($lines)) === 1) {
                array_pop($lines);
            }
            return rtrim(implode("\n", $lines));
        }
        return $prompt;
    }

    public static function cleanQuestionVisual(mixed $visual): array
    {
        if (!is_array($visual) || !in_array($visual['type'] ?? '', ['graph', 'bar_chart', 'geometry'], true)) {
            throw new RuntimeException('A question diagram has an unsupported format.', 422);
        }
        $clean = ['type' => $visual['type']];
        if ($clean['type'] === 'geometry') {
            $shapes = $visual['shapes'] ?? null;
            if (!is_array($shapes) || $shapes === [] || count($shapes) > 4) {
                throw new RuntimeException('A geometry diagram must contain one to four shapes.', 422);
            }
            foreach ($shapes as $shape) {
                if (!is_array($shape)) {
                    throw new RuntimeException('A geometry diagram contains an unsupported shape or label.', 422);
                }
                $labels = $shape['labels'] ?? [];
                if (!in_array($shape['shape'] ?? '', ['triangle', 'rectangle', 'circle', 'line'], true)
                    || !is_array($labels) || count($labels) > 4) {
                    throw new RuntimeException('A geometry diagram contains an unsupported shape or label.', 422);
                }
                foreach ($labels as $label) {
                    if (!is_string($label) || mb_strlen($label) > 20) {
                        throw new RuntimeException('A geometry diagram label is invalid.', 422);
                    }
                }
                $clean['shapes'][] = ['shape' => $shape['shape'], 'labels' => array_values($labels)];
            }
        } elseif ($clean['type'] === 'bar_chart') {
            $labels = $visual['labels'] ?? null;
            $values = $visual['values'] ?? null;
            if (!is_array($labels) || !is_array($values) || $labels === [] || count($labels) > 12 || count($labels) !== count($values)) {
                throw new RuntimeException('A bar chart must contain matching labels and values for up to 12 categories.', 422);
            }
            foreach ($labels as $label) {
                if (!is_string($label) || trim($label) === '' || mb_strlen($label) > 30) {
                    throw new RuntimeException('A chart category label is invalid.', 422);
                }
            }
            foreach ($values as $value) {
                if (!is_numeric($value) || !is_finite((float)$value) || (float)$value < 0 || (float)$value > 100000) {
                    throw new RuntimeException('A chart value must be a non-negative finite number.', 422);
                }
            }
            $clean['labels'] = array_values($labels);
            $clean['values'] = array_map(static fn(mixed $value): float => (float)$value, array_values($values));
        } else {
        $range = [];
        foreach (['x_min', 'x_max', 'y_min', 'y_max'] as $key) {
            $value = filter_var($visual[$key] ?? null, FILTER_VALIDATE_FLOAT);
            if ($value === false || !is_finite((float)$value) || abs((float)$value) > 10000) {
                throw new RuntimeException('A graph axis range is invalid.', 422);
            }
            $range[$key] = (float)$value;
        }
        if ($range['x_min'] >= $range['x_max'] || $range['y_min'] >= $range['y_max']) {
            throw new RuntimeException('A graph axis range must increase from minimum to maximum.', 422);
        }
        $points = $visual['points'] ?? [];
        if (!is_array($points) || count($points) > 100) {
            throw new RuntimeException('A graph may contain no more than 100 plotted points.', 422);
        }
        $cleanPoints = [];
        foreach ($points as $point) {
            if (!is_array($point) || count($point) !== 2
                || !is_numeric($point[0] ?? null) || !is_numeric($point[1] ?? null)
                || !is_finite((float)$point[0]) || !is_finite((float)$point[1])
                || (float)$point[0] < $range['x_min'] || (float)$point[0] > $range['x_max']
                || (float)$point[1] < $range['y_min'] || (float)$point[1] > $range['y_max']) {
                throw new RuntimeException('A graph contains an invalid or out-of-range point.', 422);
            }
            $cleanPoints[] = [(float)$point[0], (float)$point[1]];
        }
        if ($cleanPoints === []) {
            throw new RuntimeException('A graph must contain at least one plotted point.', 422);
        }
        $clean += $range + ['points' => $cleanPoints];
        }
        foreach (['title', 'x_label', 'y_label'] as $field) {
            if ($clean['type'] !== 'graph' && $field !== 'title') continue;
            $value = $visual[$field] ?? '';
            if (!is_string($value) || mb_strlen($value) > 120) {
                throw new RuntimeException('A graph title or axis label is invalid.', 422);
            }
            $clean[$field] = trim($value);
        }
        return $clean;
    }

    public function replaceQuestion(int $ownerId, int $assessmentId, int $questionIndex, array $question): array
    {
        if (!is_string($question['prompt'] ?? null) || trim($question['prompt']) === ''
            || !is_int($question['marks'] ?? null) || $question['marks'] < 1
            || !in_array($question['question_type'] ?? '', ['mcq', 'worked', 'extended', 'brief', 'other'], true)
            || !is_string($question['expected_answer'] ?? null)) {
            throw new RuntimeException('The replacement question is invalid.', 422);
        }
        $cleanQuestion = [
            'prompt' => $question['question_type'] === 'mcq'
                ? self::removeEmbeddedMcqOptions(trim($question['prompt']))
                : trim($question['prompt']),
            'marks' => $question['marks'],
            'question_type' => $question['question_type'],
            'expected_answer' => mb_substr($question['expected_answer'], 0, 5000),
        ];
        if ($cleanQuestion['question_type'] === 'mcq') {
            if (!is_array($question['options'] ?? null) || count($question['options']) !== 4
                || array_filter($question['options'], static fn(mixed $option): bool => is_string($option) && trim($option) !== '') !== $question['options']
                || !is_int($question['correct_option'] ?? null) || $question['correct_option'] < 0 || $question['correct_option'] > 3) {
                throw new RuntimeException('The replacement multiple-choice question is invalid.', 422);
            }
            $cleanQuestion['options'] = array_map(static fn(string $option): string => trim($option), $question['options']);
            $cleanQuestion['correct_option'] = $question['correct_option'];
        }
        if (isset($question['visual'])) {
            $cleanQuestion['visual'] = self::cleanQuestionVisual($question['visual']);
        }

        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $statement = $pdo->prepare(
                "SELECT questions_json, question_revision_counts_json
                 FROM online_assessments a
                 WHERE a.id = :id AND a.owner_user_id = :owner
                   AND a.status IN ('published', 'paused', 'draft') AND a.result_published_at IS NULL
                   AND NOT EXISTS (SELECT 1 FROM assessment_attempts t WHERE t.assessment_id = a.id)
                 FOR UPDATE"
            );
            $statement->execute(['id' => $assessmentId, 'owner' => $ownerId]);
            $row = $statement->fetch();
            if (!$row) {
                throw new RuntimeException('Questions can only be changed by the assessment creator before a learner starts.', 409);
            }
            $questions = json_decode((string)$row['questions_json'], true, 64, JSON_THROW_ON_ERROR);
            if (!array_key_exists($questionIndex, $questions) || $cleanQuestion['marks'] !== (int)$questions[$questionIndex]['marks']) {
                throw new RuntimeException('The replacement must keep the selected question and its original mark allocation.', 422);
            }
            $counts = $row['question_revision_counts_json'] === null
                ? array_fill(0, count($questions), 0)
                : json_decode((string)$row['question_revision_counts_json'], true, 32, JSON_THROW_ON_ERROR);
            if (count($counts) !== count($questions) || !isset($counts[$questionIndex]) || !is_int($counts[$questionIndex])) {
                throw new RuntimeException('The question revision history is invalid. Contact support.', 500);
            }
            if ($counts[$questionIndex] >= 5) {
                throw new RuntimeException('This question has reached its five-change limit.', 409);
            }
            $counts[$questionIndex]++;
            $questions[$questionIndex] = $cleanQuestion;
            $update = $pdo->prepare(
                'UPDATE online_assessments SET questions_json = :questions, question_revision_counts_json = :counts
                 WHERE id = :id AND owner_user_id = :owner'
            );
            $update->execute([
                'questions' => json_encode($questions, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'counts' => json_encode($counts, JSON_THROW_ON_ERROR),
                'id' => $assessmentId,
                'owner' => $ownerId,
            ]);
            $pdo->commit();
            return ['question' => $cleanQuestion, 'changes_used' => $counts[$questionIndex], 'changes_remaining' => 5 - $counts[$questionIndex]];
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $exception;
        }
    }

    public function start(string $code, ?string $assessmentToken = null): array
    {
        if (isset($_SESSION['online_assessment_attempt'])) {
            return $this->current();
        }
        $code = strtoupper(preg_replace('/[\s-]+/', '', trim($code)) ?? '');
        if (!preg_match(self::ACCESS_CODE_PATTERN, $code)) {
            $this->recordFailedAccessCode();
            throw new RuntimeException('Enter the 12- or 16-character learner access code provided by your teacher.', 422);
        }
        $tokenConstraint = $assessmentToken === null ? '' : ' AND a.share_token = :token';
        $statement = Connection::get()->prepare(
            'SELECT ar.assessment_id, ar.roster_id
             FROM online_assessment_roster ar
             JOIN online_assessments a ON a.id = ar.assessment_id
             WHERE ar.access_code_hash = :hash' . $tokenConstraint . ' LIMIT 2'
        );
        $parameters = ['hash' => hash('sha256', $code, true)];
        if ($assessmentToken !== null) $parameters['token'] = $this->cleanShareToken($assessmentToken);
        $statement->execute($parameters);
        $matches = $statement->fetchAll();
        if (count($matches) > 1) {
            throw new RuntimeException('This code is used for more than one assessment. Open the assessment link shared by your teacher.', 409);
        }
        $assignment = $matches[0] ?? null;
        if (!$assignment) {
            $this->recordFailedAccessCode();
            throw new RuntimeException('This access code is not valid for an open assessment. Check it with your teacher.', 404);
        }
        return $this->startRosterAttempt((int)$assignment['assessment_id'], 0, (int)$assignment['roster_id'], $code);
    }

    private function startRosterAttempt(int $assessmentId, int $classId, int $rosterId, string $accessCode): array
    {
        if (isset($_SESSION['online_assessment_attempt'])) {
            try {
                return $this->current();
            } catch (RuntimeException $exception) {
                if (isset($_SESSION['online_assessment_attempt']) || $exception->getCode() !== 409) {
                    throw $exception;
                }
            }
        }
        $code = strtoupper(preg_replace('/[\s-]+/', '', trim($accessCode)) ?? '');
        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $classConstraint = $classId > 0 ? ' AND r.class_id = :class_id' : '';
            $statement = $pdo->prepare(
                'SELECT r.id AS roster_id, r.learner_name, a.id AS assessment_id, a.status, ac.status AS class_status, a.expires_at,
                        a.duration_minutes, a.security_level, a.questions_json, a.access_mode, a.teacher_access_code_hash,
                        ar.access_code_hash, ar.access_used_at
                 FROM online_assessment_roster ar
                 JOIN online_assessments a ON a.id = ar.assessment_id
                 JOIN assessment_roster r ON r.id = ar.roster_id
                 JOIN online_assessment_classes ac ON ac.assessment_id = a.id AND ac.class_id = r.class_id
                 WHERE a.id = :assessment AND r.id = :roster' . $classConstraint . ' FOR UPDATE'
            );
            $parameters = ['assessment' => $assessmentId, 'roster' => $rosterId];
            if ($classId > 0) $parameters['class_id'] = $classId;
            $statement->execute($parameters);
            $row = $statement->fetch();
            if (!$row || $row['status'] !== 'published' || $row['class_status'] !== 'active'
                || strtotime((string)$row['expires_at'] . ' UTC') <= time()) {
                throw new RuntimeException('This assessment is paused or closed, or its link has expired. Contact your teacher.', 410);
            }
            if ($row['access_used_at'] !== null) {
                throw new RuntimeException('This learner has already started an attempt. Ask your teacher for help.', 409);
            }
            $accessMode = (string)$row['access_mode'];
            if ($accessMode === 'teacher_code') {
                if (!preg_match(self::ACCESS_CODE_PATTERN, $code)
                    || !is_string($row['teacher_access_code_hash'])
                    || !hash_equals((string)$row['teacher_access_code_hash'], hash('sha256', $code, true))) {
                    $pdo->rollBack();
                    $this->recordFailedAccessCode();
                    throw new RuntimeException('The teacher assessment code is incorrect. Check it with your teacher.', 401);
                }
            } elseif ($accessMode === 'individual_code') {
                if (!preg_match(self::ACCESS_CODE_PATTERN, $code) || !is_string($row['access_code_hash'])
                    || !hash_equals((string)$row['access_code_hash'], hash('sha256', $code, true))) {
                    $pdo->rollBack();
                    $this->recordFailedAccessCode();
                    throw new RuntimeException('The individual learner code is incorrect. Check it with your teacher.', 401);
                }
            } elseif ($code !== '') {
                $pdo->rollBack();
                throw new RuntimeException('This assessment does not require an access code.', 422);
            }
            $attemptNumberQuery = $pdo->prepare(
                'SELECT COALESCE(MAX(attempt_number), 0) + 1
                 FROM assessment_attempts WHERE assessment_id = :assessment AND roster_id = :roster'
            );
            $attemptNumberQuery->execute(['assessment' => $assessmentId, 'roster' => $rosterId]);
            $attemptNumber = (int)$attemptNumberQuery->fetchColumn();
            $token = bin2hex(random_bytes(32));
            $questionOrder = null;
            if ((string)$row['security_level'] === 'advanced') {
                $questionSet = json_decode((string)$row['questions_json'], true, 64, JSON_THROW_ON_ERROR);
                $questionOrder = array_keys($questionSet);
                for ($index = count($questionOrder) - 1; $index > 0; $index--) {
                    $swap = random_int(0, $index);
                    [$questionOrder[$index], $questionOrder[$swap]] = [$questionOrder[$swap], $questionOrder[$index]];
                }
            }
            $pdo->prepare(
                'INSERT INTO assessment_attempts (assessment_id, roster_id, attempt_number, attempt_token_hash, expires_at, question_order_json)
                 VALUES (:assessment, :roster, :attempt_number, :token_hash, DATE_ADD(UTC_TIMESTAMP(), INTERVAL :duration MINUTE), :question_order)'
            )->execute([
                'assessment' => $assessmentId,
                'roster' => $rosterId,
                'attempt_number' => $attemptNumber,
                'token_hash' => hash('sha256', $token, true),
                'duration' => (int)$row['duration_minutes'],
                'question_order' => $questionOrder === null ? null : json_encode($questionOrder, JSON_THROW_ON_ERROR),
            ]);
            $attemptId = (int)$pdo->lastInsertId();
            $pdo->prepare('UPDATE online_assessment_roster SET access_used_at = UTC_TIMESTAMP() WHERE assessment_id = :assessment AND roster_id = :roster')
                ->execute(['assessment' => $assessmentId, 'roster' => $rosterId]);
            $pdo->commit();
                $currentLearner = $_SESSION['online_assessment_learner'] ?? null;
                if (!is_array($currentLearner) || (int)($currentLearner['roster_id'] ?? 0) !== $rosterId) {
                    $_SESSION['online_assessment_attempt_history'] = [];
                }
                $_SESSION['online_assessment_learner'] = [
                    'roster_id' => $rosterId,
                    'class_id' => $classId,
                    'name' => (string)$row['learner_name'],
                ];
                $_SESSION['online_assessment_attempt'] = ['id' => $attemptId, 'token' => $token];
                $_SESSION['online_assessment_attempt_history'][(string)$attemptId] = $token;
                return $this->current();
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $exception;
        }
    }

    public function current(): array
    {
        $attempt = $_SESSION['online_assessment_attempt'] ?? null;
        if (!is_array($attempt) || !isset($attempt['id'], $attempt['token'])) {
            throw new RuntimeException('Enter the learner access code provided by your teacher to begin.', 401);
        }
        $statement = Connection::get()->prepare(
            'SELECT t.id, t.status, t.expires_at, t.question_order_json, r.learner_name,
                    a.title, a.assessment_type, a.question_format, a.duration_minutes, a.security_level,
                    a.total_marks, a.instructions, a.questions_json,
                    TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), t.expires_at) AS remaining_seconds
             FROM assessment_attempts t
             JOIN assessment_roster r ON r.id = t.roster_id
             JOIN online_assessments a ON a.id = t.assessment_id
             WHERE t.id = :id AND t.attempt_token_hash = :token_hash LIMIT 1'
        );
        $statement->execute([
            'id' => (int)$attempt['id'],
            'token_hash' => hash('sha256', (string)$attempt['token'], true),
        ]);
        $row = $statement->fetch();
        if (!$row) {
            unset($_SESSION['online_assessment_attempt']);
            throw new RuntimeException('This assessment attempt is no longer available. Contact your teacher.', 401);
        }
        if ($row['status'] !== 'in_progress') {
            unset($_SESSION['online_assessment_attempt']);
            throw new RuntimeException('This assessment attempt is already closed or submitted.', 409);
        }
        if ((int)$row['remaining_seconds'] <= 0) {
            Connection::get()->prepare("UPDATE assessment_attempts SET status = 'expired' WHERE id = :id AND status = 'in_progress'")
                ->execute(['id' => (int)$attempt['id']]);
            unset($_SESSION['online_assessment_attempt']);
            throw new RuntimeException('The assessment time has ended. Your teacher will be notified of the expired attempt.', 410);
        }
        $questions = json_decode((string)$row['questions_json'], true, 64, JSON_THROW_ON_ERROR);
        if (is_string($row['question_order_json']) && $row['question_order_json'] !== '') {
            $order = json_decode($row['question_order_json'], true, 32, JSON_THROW_ON_ERROR);
            if (is_array($order) && count($order) === count($questions)
                && array_values(array_unique($order)) === array_values($order)
                && array_reduce($order, static fn(bool $valid, mixed $index): bool => $valid && is_int($index) && array_key_exists($index, $questions), true)) {
                $questions = array_map(static fn(int $index): array => $questions[$index], $order);
            }
        }
        $publicQuestions = array_map(static function (array $question): array {
            $public = [
                'prompt' => $question['question_type'] === 'mcq'
                    ? self::removeEmbeddedMcqOptions((string)$question['prompt'])
                    : (string)$question['prompt'],
                'marks' => (int)$question['marks'],
                'question_type' => (string)$question['question_type'],
            ];
            if (isset($question['options'])) {
                $public['options'] = array_values($question['options']);
            }
            if (isset($question['visual'])) {
                $public['visual'] = self::cleanQuestionVisual($question['visual']);
            }
            return $public;
        }, $questions);
        return [
            'attempt_id' => (int)$attempt['id'],
            'learner_name' => (string)$row['learner_name'],
            'title' => (string)$row['title'],
            'assessment_type' => (string)$row['assessment_type'],
            'question_format' => (string)$row['question_format'],
            'security_level' => (string)$row['security_level'],
            'security_instructions' => self::securityGuidance((string)$row['security_level']),
            'duration_minutes' => (int)$row['duration_minutes'],
            'average_seconds_per_question' => (int)round(((int)$row['duration_minutes'] * 60) / max(1, count($publicQuestions))),
            'total_marks' => (int)$row['total_marks'],
            'instructions' => (string)$row['instructions'],
            'remaining_seconds' => max(0, (int)$row['remaining_seconds']),
            'questions' => $publicQuestions,
        ];
    }

    public function saveDraft(array $answers, array $timedOutQuestions = []): array
    {
        $attempt = $_SESSION['online_assessment_attempt'] ?? null;
        if (!is_array($attempt) || !isset($attempt['id'], $attempt['token'])) {
            throw new RuntimeException('Your assessment session is not active. Contact your teacher before retrying.', 401);
        }

        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $statement = $pdo->prepare(
                'SELECT t.status, t.expires_at, t.assessment_id, t.question_order_json,
                        a.questions_json,
                        TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), t.expires_at) AS remaining_seconds
                 FROM assessment_attempts t JOIN online_assessments a ON a.id = t.assessment_id
                 WHERE t.id = :id AND t.attempt_token_hash = :token_hash LIMIT 1 FOR UPDATE'
            );
            $statement->execute([
                'id' => (int)$attempt['id'],
                'token_hash' => hash('sha256', (string)$attempt['token'], true),
            ]);
            $row = $statement->fetch();
            if (!$row || $row['status'] !== 'in_progress') {
                throw new RuntimeException('This assessment attempt has already been submitted or closed.', 409);
            }
            if ((int)$row['remaining_seconds'] <= 0) {
                $pdo->prepare("UPDATE assessment_attempts SET status = 'expired' WHERE id = :id AND status = 'in_progress'")
                    ->execute(['id' => (int)$attempt['id']]);
                $pdo->commit();
                unset($_SESSION['online_assessment_attempt']);
                throw new RuntimeException('The assessment time has ended. Your saved answers were preserved.', 410);
            }

            $questions = json_decode((string)$row['questions_json'], true, 64, JSON_THROW_ON_ERROR);
            $questionOrder = is_string($row['question_order_json']) && $row['question_order_json'] !== ''
                ? json_decode($row['question_order_json'], true, 32, JSON_THROW_ON_ERROR)
                : array_keys($questions);
            if (!is_array($questionOrder) || count($questionOrder) !== count($questions)) {
                throw new RuntimeException('The question order for this attempt is invalid. Contact your teacher.', 409);
            }
            if (count($answers) > count($questions)) {
                throw new RuntimeException('The saved answers do not match this assessment.', 422);
            }

            $cleanAnswers = [];
            foreach ($questionOrder as $presentedIndex => $originalIndex) {
                if (!is_int($originalIndex) || !array_key_exists($originalIndex, $questions)) {
                    throw new RuntimeException('The question order for this attempt is invalid. Contact your teacher.', 409);
                }
                $question = $questions[$originalIndex];
                $answer = $answers[(string)$presentedIndex] ?? '';
                if (!is_string($answer) || mb_strlen($answer) > 5000) {
                    throw new RuntimeException('An answer is too long or invalid.', 422);
                }
                if ($answer !== '' && ($question['question_type'] ?? '') === 'mcq') {
                    $option = filter_var($answer, FILTER_VALIDATE_INT);
                    if ($option === false || !isset($question['options'][$option])) {
                        throw new RuntimeException('A saved multiple-choice answer is invalid.', 422);
                    }
                }
                $cleanAnswers[(string)$originalIndex] = trim($answer);
            }

            $cleanTimedOutQuestions = [];
            foreach ($timedOutQuestions as $presentedIndex) {
                if (!is_int($presentedIndex) || !array_key_exists($presentedIndex, $questionOrder)) {
                    throw new RuntimeException('The timed-out question list is invalid.', 422);
                }
                $cleanTimedOutQuestions[] = $questionOrder[$presentedIndex];
            }
            $cleanTimedOutQuestions = array_values(array_unique($cleanTimedOutQuestions));

            $update = $pdo->prepare(
                "UPDATE assessment_attempts
                 SET answers_json = :answers, timed_out_questions_json = :timed_out
                 WHERE id = :id AND status = 'in_progress' AND expires_at > UTC_TIMESTAMP()"
            );
            $update->execute([
                'answers' => json_encode($cleanAnswers, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'timed_out' => json_encode($cleanTimedOutQuestions, JSON_THROW_ON_ERROR),
                'id' => (int)$attempt['id'],
            ]);
            if ($update->rowCount() !== 1) {
                $activeAttempt = $pdo->prepare(
                    "SELECT status = 'in_progress' AND expires_at > UTC_TIMESTAMP()
                     FROM assessment_attempts WHERE id = :id LIMIT 1"
                );
                $activeAttempt->execute(['id' => (int)$attempt['id']]);
                if (!$activeAttempt->fetchColumn()) {
                    $pdo->prepare(
                        "UPDATE assessment_attempts SET status = 'expired'
                         WHERE id = :id AND status = 'in_progress' AND expires_at <= UTC_TIMESTAMP()"
                    )->execute(['id' => (int)$attempt['id']]);
                    $pdo->commit();
                    unset($_SESSION['online_assessment_attempt']);
                    throw new RuntimeException('The assessment time has ended. Your saved answers were preserved.', 410);
                }
            }
            $pdo->commit();
            return ['saved' => true];
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $exception;
        }
    }

    public function submit(array $answers, array $timedOutQuestions = []): array
    {
        $attempt = $_SESSION['online_assessment_attempt'] ?? null;
        if (!is_array($attempt) || !isset($attempt['id'], $attempt['token'])) {
            throw new RuntimeException('Your assessment session is not active. Contact your teacher before retrying.', 401);
        }
        $pdo = Connection::get();
        $statement = $pdo->prepare(
            'SELECT t.status, t.expires_at, t.assessment_id, t.question_order_json, a.total_marks, a.questions_json,
                    TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), t.expires_at) AS remaining_seconds
             FROM assessment_attempts t JOIN online_assessments a ON a.id = t.assessment_id
             WHERE t.id = :id AND t.attempt_token_hash = :token_hash LIMIT 1'
        );
        $statement->execute([
            'id' => (int)$attempt['id'],
            'token_hash' => hash('sha256', (string)$attempt['token'], true),
        ]);
        $row = $statement->fetch();
        if (!$row || $row['status'] !== 'in_progress') {
            throw new RuntimeException('This assessment attempt has already been submitted or closed.', 409);
        }
        if ((int)$row['remaining_seconds'] <= 0) {
            $pdo->prepare("UPDATE assessment_attempts SET status = 'expired' WHERE id = :id AND status = 'in_progress'")
                ->execute(['id' => (int)$attempt['id']]);
            unset($_SESSION['online_assessment_attempt']);
            throw new RuntimeException('The assessment time has ended. Your answers were not submitted.', 410);
        }
        $questions = json_decode((string)$row['questions_json'], true, 64, JSON_THROW_ON_ERROR);
        $questionOrder = is_string($row['question_order_json']) && $row['question_order_json'] !== ''
            ? json_decode($row['question_order_json'], true, 32, JSON_THROW_ON_ERROR)
            : array_keys($questions);
        if (!is_array($questionOrder) || count($questionOrder) !== count($questions)) {
            throw new RuntimeException('The question order for this attempt is invalid. Contact your teacher.', 409);
        }
        if (count($answers) > count($questions)) {
            throw new RuntimeException('The submitted answers do not match this assessment.', 422);
        }
        $timedOutIndexes = [];
        foreach ($timedOutQuestions as $index) {
            if (!is_int($index) || $index < 0 || $index >= count($questions) || isset($timedOutIndexes[$index])) {
                throw new RuntimeException('The timed-out question list is invalid.', 422);
            }
            $timedOutIndexes[$index] = true;
        }
        $cleanAnswers = [];
        $cleanTimedOutQuestions = [];
        $autoScore = 0;
        $needsManualReview = false;
        foreach ($questionOrder as $presentedIndex => $originalIndex) {
            if (!is_int($originalIndex) || !array_key_exists($originalIndex, $questions)) {
                throw new RuntimeException('The question order for this attempt is invalid. Contact your teacher.', 409);
            }
            $question = $questions[$originalIndex];
            $answer = $answers[(string)$presentedIndex] ?? '';
            if (!is_string($answer) || mb_strlen($answer) > 5000) {
                throw new RuntimeException('An answer is too long or invalid.', 422);
            }
            if (isset($timedOutIndexes[$presentedIndex])) {
                $cleanTimedOutQuestions[] = $originalIndex;
            }
            $cleanAnswers[(string)$originalIndex] = trim($answer);
            if ($question['question_type'] === 'mcq') {
                if ($answer !== '' && !in_array($answer, ['0', '1', '2', '3'], true)) {
                    throw new RuntimeException('A multiple-choice response is invalid.', 422);
                }
                if (!isset($timedOutIndexes[$presentedIndex]) && $answer !== '' && (int)$answer === (int)$question['correct_option']) {
                    $autoScore += (int)$question['marks'];
                }
            } else {
                $needsManualReview = true;
            }
        }
        $pdo->beginTransaction();
        try {
            $save = $pdo->prepare(
                "UPDATE assessment_attempts
                 SET answers_json = :answers, timed_out_questions_json = :timed_out,
                     auto_score = :score, needs_manual_review = :manual,
                     status = 'submitted', submitted_at = UTC_TIMESTAMP()
                 WHERE id = :id AND status = 'in_progress'"
            );
            $save->execute([
                'answers' => json_encode($cleanAnswers, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'timed_out' => json_encode($cleanTimedOutQuestions, JSON_THROW_ON_ERROR),
                'score' => $autoScore,
                'manual' => $needsManualReview ? 1 : 0,
                'id' => (int)$attempt['id'],
            ]);
            if ($save->rowCount() !== 1) {
                throw new RuntimeException('The assessment was already submitted.', 409);
            }
            $pdo->commit();
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $exception;
        }
        unset($_SESSION['online_assessment_attempt']);
        return [
            'submitted' => true,
            'auto_score' => $autoScore,
            'total_marks' => (int)$row['total_marks'],
            'needs_manual_review' => $needsManualReview,
            'message' => $needsManualReview
                ? 'Your answers have been submitted. Your objective score is shown below; your teacher will mark written responses.'
                : 'Your answers have been submitted. Your score is shown below.',
        ];
    }

    public function recordEvent(string $eventType): void
    {
        if (!in_array($eventType, self::EVENT_TYPES, true)) {
            throw new RuntimeException('This assessment activity event is not supported.', 422);
        }
        $attempt = $_SESSION['online_assessment_attempt'] ?? null;
        if (!is_array($attempt) || !isset($attempt['id'], $attempt['token'])) {
            throw new RuntimeException('Your assessment session is not active.', 401);
        }
        $pdo = Connection::get();
        $verify = $pdo->prepare(
            "SELECT id FROM assessment_attempts
             WHERE id = :id AND attempt_token_hash = :token_hash AND status = 'in_progress'
               AND expires_at > UTC_TIMESTAMP() LIMIT 1"
        );
        $verify->execute([
            'id' => (int)$attempt['id'],
            'token_hash' => hash('sha256', (string)$attempt['token'], true),
        ]);
        if (!$verify->fetchColumn()) {
            throw new RuntimeException('This assessment attempt is no longer active.', 409);
        }
        $recent = $pdo->prepare(
            'SELECT 1 FROM assessment_attempt_events
             WHERE attempt_id = :id AND event_type = :event
               AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 SECOND) LIMIT 1'
        );
        $recent->execute(['id' => (int)$attempt['id'], 'event' => $eventType]);
        if ($recent->fetchColumn()) return;
        $pdo->prepare('INSERT INTO assessment_attempt_events (attempt_id, event_type) VALUES (:id, :event)')
            ->execute(['id' => (int)$attempt['id'], 'event' => $eventType]);
    }

    public function listForOwner(int $ownerId, bool $includeAll = false): array
    {
        $this->processExpiredResults();
        $statement = Connection::get()->prepare(
            "SELECT a.id, a.title, a.status, a.security_level, a.created_at, a.duration_days, a.expires_at,
                    a.result_published_at, a.result_email_sent_at,
                    TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), a.expires_at) AS remaining_seconds,
                    (SELECT GROUP_CONCAT(c2.name ORDER BY c2.name SEPARATOR ', ')
                     FROM online_assessment_classes ac2 JOIN assessment_classes c2 ON c2.id = ac2.class_id
                     WHERE ac2.assessment_id = a.id) AS class_name,
                    (SELECT COUNT(*) FROM online_assessment_roster ar WHERE ar.assessment_id = a.id) AS learner_count
             FROM online_assessments a JOIN assessment_classes c ON c.id = a.class_id
             " . ($includeAll ? '' : 'WHERE a.owner_user_id = :owner ') . "ORDER BY a.created_at DESC LIMIT 500"
        );
        $statement->execute($includeAll ? [] : ['owner' => $ownerId]);
        return ['assessments' => $statement->fetchAll()];
    }

    public function resetLearnerAccess(int $ownerId, int $assessmentId, int $rosterId, bool $allowAnyOwner = false): array
    {
        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $assessmentQuery = $pdo->prepare(
                'SELECT a.status, a.result_published_at, ac.status AS class_status
                 FROM online_assessments a
                 JOIN online_assessment_roster ar ON ar.assessment_id = a.id
                 JOIN assessment_roster r ON r.id = ar.roster_id
                 JOIN online_assessment_classes ac ON ac.assessment_id = a.id AND ac.class_id = r.class_id
                 WHERE a.id = :assessment AND r.id = :roster '
                    . ($allowAnyOwner ? '' : 'AND a.owner_user_id = :owner ')
                    . 'LIMIT 1 FOR UPDATE'
            );
            $parameters = ['assessment' => $assessmentId, 'roster' => $rosterId];
            if (!$allowAnyOwner) $parameters['owner'] = $ownerId;
            $assessmentQuery->execute($parameters);
            $assessment = $assessmentQuery->fetch();
            if (!$assessment) throw new RuntimeException('The learner was not found on this assessment.', 404);
            if (!in_array($assessment['status'], ['published', 'paused'], true)
                || $assessment['result_published_at'] !== null || $assessment['class_status'] === 'closed') {
                throw new RuntimeException('Retakes are unavailable for this assessment or class.', 409);
            }

            $attemptQuery = $pdo->prepare(
                'SELECT id, status FROM assessment_attempts
                 WHERE assessment_id = :assessment AND roster_id = :roster
                 ORDER BY attempt_number DESC LIMIT 1 FOR UPDATE'
            );
            $attemptQuery->execute(['assessment' => $assessmentId, 'roster' => $rosterId]);
            $attempt = $attemptQuery->fetch();
            if (!$attempt || $attempt['status'] === 'superseded') {
                throw new RuntimeException('This learner does not have an attempt that needs resetting.', 409);
            }

            $pdo->prepare(
                "UPDATE assessment_attempts SET superseded_from_status = status, status = 'superseded'
                 WHERE id = :id AND status IN ('in_progress', 'submitted', 'expired')"
            )->execute(['id' => (int)$attempt['id']]);
            $pdo->prepare(
                'UPDATE online_assessment_roster SET access_used_at = NULL
                 WHERE assessment_id = :assessment AND roster_id = :roster'
            )->execute(['assessment' => $assessmentId, 'roster' => $rosterId]);
            $pdo->commit();
            return ['reset' => true, 'message' => 'Learner access reset. Their previous attempt and integrity record remain in the assessment history.'];
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $exception;
        }
    }

    public function updateClassAvailability(
        int $ownerId,
        int $assessmentId,
        int $classId,
        string $action,
        bool $allowAnyOwner = false
    ): array {
        if (!in_array($action, ['pause', 'resume', 'end'], true)) {
            throw new RuntimeException('Choose a valid class availability action.', 422);
        }
        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $query = $pdo->prepare(
                'SELECT a.status AS assessment_status, ac.status AS class_status
                 FROM online_assessments a
                 JOIN online_assessment_classes ac ON ac.assessment_id = a.id
                 WHERE a.id = :assessment AND ac.class_id = :class '
                    . ($allowAnyOwner ? '' : 'AND a.owner_user_id = :owner ')
                    . 'LIMIT 1 FOR UPDATE'
            );
            $parameters = ['assessment' => $assessmentId, 'class' => $classId];
            if (!$allowAnyOwner) $parameters['owner'] = $ownerId;
            $query->execute($parameters);
            $row = $query->fetch();
            if (!$row) throw new RuntimeException('The class is not assigned to this assessment.', 404);
            if (!in_array($row['assessment_status'], ['published', 'paused'], true)) {
                throw new RuntimeException('Class availability can only be changed on an open or paused assessment.', 409);
            }
            $nextStatus = match ($action) {
                'pause' => 'paused',
                'resume' => 'active',
                'end' => 'closed',
            };
            if (($action === 'pause' && $row['class_status'] !== 'active')
                || ($action === 'resume' && $row['class_status'] !== 'paused')
                || ($action === 'end' && $row['class_status'] === 'closed')) {
                throw new RuntimeException('Refresh the assessment to see the current class status before changing it.', 409);
            }
            $pdo->prepare(
                'UPDATE online_assessment_classes SET status = :status
                 WHERE assessment_id = :assessment AND class_id = :class'
            )->execute(['status' => $nextStatus, 'assessment' => $assessmentId, 'class' => $classId]);
            if ($action === 'end') {
                $pdo->prepare(
                    "UPDATE assessment_attempts t
                     JOIN assessment_roster r ON r.id = t.roster_id
                     SET t.status = 'expired'
                     WHERE t.assessment_id = :assessment AND r.class_id = :class
                       AND t.status = 'in_progress'"
                )->execute(['assessment' => $assessmentId, 'class' => $classId]);
            }
            $pdo->commit();
            return ['class_status' => $nextStatus];
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $exception;
        }
    }

    public function updateAvailability(int $ownerId, int $assessmentId, string $action, ?int $durationDays = null): array
    {
        $this->processExpiredResults();
        if (!in_array($action, ['start', 'pause', 'unpublish', 'publish', 'end', 'duration'], true)) {
            throw new RuntimeException('Choose a valid assessment availability action.', 422);
        }
        $pdo = Connection::get();
        if ($action === 'unpublish') {
            $pdo->beginTransaction();
            try {
                $query = $pdo->prepare(
                    'SELECT status, result_published_at FROM online_assessments
                     WHERE id = :id AND owner_user_id = :owner LIMIT 1 FOR UPDATE'
                );
                $query->execute(['id' => $assessmentId, 'owner' => $ownerId]);
                $assessment = $query->fetch();
                if (!$assessment) throw new RuntimeException('The assessment was not found in your account.', 404);
                if (!in_array($assessment['status'], ['published', 'paused'], true) || $assessment['result_published_at'] !== null) {
                    throw new RuntimeException('Only an open or paused assessment with unpublished results can be unpublished.', 409);
                }
                $attempts = $pdo->prepare('SELECT 1 FROM assessment_attempts WHERE assessment_id = :assessment LIMIT 1');
                $attempts->execute(['assessment' => $assessmentId]);
                if ($attempts->fetchColumn()) {
                    throw new RuntimeException('This assessment cannot be unpublished because a learner has already started. End or pause it to preserve the attempt and scoring history.', 409);
                }
                $pdo->prepare(
                    "UPDATE online_assessments SET status = 'draft', paused_at = NULL
                     WHERE id = :id AND owner_user_id = :owner"
                )->execute(['id' => $assessmentId, 'owner' => $ownerId]);
                $pdo->commit();
            } catch (\Throwable $exception) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $exception;
            }
        } else {
            $query = $pdo->prepare(
                'SELECT status, expires_at, duration_days, paused_at, paused_seconds
                 FROM online_assessments WHERE id = :id AND owner_user_id = :owner LIMIT 1'
            );
            $query->execute(['id' => $assessmentId, 'owner' => $ownerId]);
            $assessment = $query->fetch();
            if (!$assessment) throw new RuntimeException('The assessment was not found in your account.', 404);
            $now = time();

            if ($action === 'duration') {
                if ($durationDays === null || $durationDays < 1 || $durationDays > 90) {
                    throw new RuntimeException('Set an availability period from 1 to 90 days.', 422);
                }
                if (in_array($assessment['status'], ['closed', 'expired'], true)) {
                    throw new RuntimeException('Ended or expired assessments cannot have their availability changed.', 409);
                }
                if ($assessment['status'] === 'draft') {
                    $update = $pdo->prepare(
                        'UPDATE online_assessments SET duration_days = :days
                         WHERE id = :id AND owner_user_id = :owner'
                    );
                    $update->execute(['days' => $durationDays, 'id' => $assessmentId, 'owner' => $ownerId]);
                } else {
                    $update = $pdo->prepare(
                        'UPDATE online_assessments
                         SET duration_days = :days,
                             expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL :days DAY)
                         WHERE id = :id AND owner_user_id = :owner'
                    );
                    $update->execute(['days' => $durationDays, 'id' => $assessmentId, 'owner' => $ownerId]);
                }
            } elseif ($action === 'pause') {
                if ($assessment['status'] !== 'published') throw new RuntimeException('Only an open assessment can be paused.', 409);
                $pdo->prepare("UPDATE online_assessments SET status = 'paused', paused_at = UTC_TIMESTAMP() WHERE id = :id AND owner_user_id = :owner")
                    ->execute(['id' => $assessmentId, 'owner' => $ownerId]);
            } elseif ($action === 'publish') {
                if ($assessment['status'] !== 'draft') {
                    throw new RuntimeException('Only an unpublished assessment can be published.', 409);
                }
                $publish = $pdo->prepare(
                    "UPDATE online_assessments
                     SET status = 'published', published_at = UTC_TIMESTAMP(),
                         expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL duration_days DAY),
                         paused_at = NULL, paused_seconds = 0
                     WHERE id = :id AND owner_user_id = :owner AND status = 'draft'
                       AND result_published_at IS NULL
                       AND NOT EXISTS (SELECT 1 FROM assessment_attempts t WHERE t.assessment_id = :assessment)"
                );
                $publish->execute(['id' => $assessmentId, 'owner' => $ownerId, 'assessment' => $assessmentId]);
                if ($publish->rowCount() !== 1) {
                    throw new RuntimeException('This assessment can no longer be published. Refresh and check its status and learner attempts.', 409);
                }
            } elseif ($action === 'start') {
                if ($assessment['status'] !== 'paused' || $assessment['paused_at'] === null) {
                    throw new RuntimeException('Only a paused assessment can be resumed. Ended or expired links cannot be reopened.', 409);
                }
                $pausedSeconds = max(0, $now - strtotime((string)$assessment['paused_at'] . ' UTC'));
                $pdo->prepare("UPDATE online_assessments SET status = 'published', paused_seconds = paused_seconds + :paused_seconds, expires_at = DATE_ADD(expires_at, INTERVAL :extend_seconds SECOND), paused_at = NULL WHERE id = :id AND owner_user_id = :owner")
                    ->execute([
                        'paused_seconds' => $pausedSeconds,
                        'extend_seconds' => $pausedSeconds,
                        'id' => $assessmentId,
                        'owner' => $ownerId,
                    ]);
            } else {
                if (!in_array($assessment['status'], ['published', 'paused'], true)) {
                    throw new RuntimeException('Only an open or paused assessment can be ended.', 409);
                }
                $pdo->prepare("UPDATE online_assessments SET status = 'closed', paused_at = NULL, result_published_at = COALESCE(result_published_at, UTC_TIMESTAMP()) WHERE id = :id AND owner_user_id = :owner")
                    ->execute(['id' => $assessmentId, 'owner' => $ownerId]);
                $this->processExpiredResults();
            }
        }

        $current = $pdo->prepare('SELECT status, duration_days, expires_at, result_published_at FROM online_assessments WHERE id = :id LIMIT 1');
        $current->execute(['id' => $assessmentId]);
        return ['assessment' => $current->fetch()];
    }

    public function publishResultsAsAdmin(int $assessmentId): array
    {
        $pdo = Connection::get();
        $update = $pdo->prepare('UPDATE online_assessments SET result_published_at = COALESCE(result_published_at, UTC_TIMESTAMP()), status = IF(status = \'published\', \'closed\', status), paused_at = NULL WHERE id = :id');
        $update->execute(['id' => $assessmentId]);
        if ($update->rowCount() < 1) {
            $check = $pdo->prepare('SELECT id FROM online_assessments WHERE id = :id');
            $check->execute(['id' => $assessmentId]);
            if (!$check->fetchColumn()) throw new RuntimeException('The assessment could not be found.', 404);
        }
        $this->processExpiredResults();
        return ['published' => true];
    }

    public function processExpiredResults(): int
    {
        $pdo = Connection::get();
        $pdo->exec("UPDATE online_assessments SET status = 'expired', result_published_at = COALESCE(result_published_at, UTC_TIMESTAMP()) WHERE status = 'published' AND expires_at <= UTC_TIMESTAMP()");
        $pending = $pdo->query('SELECT id, owner_user_id FROM online_assessments WHERE result_published_at IS NOT NULL AND result_email_sent_at IS NULL ORDER BY result_published_at LIMIT 100')->fetchAll();
        $sent = 0;
        foreach ($pending as $item) {
            $assessmentId = (int)$item['id'];
            $lockName = 'akademi_exam_result_' . $assessmentId;
            $lock = $pdo->prepare('SELECT GET_LOCK(:lock_name, 0)');
            $lock->execute(['lock_name' => $lockName]);
            if ((int)$lock->fetchColumn() !== 1) continue;
            try {
                $this->emailScoreSheet((int)$item['owner_user_id'], $assessmentId);
                $pdo->prepare('UPDATE online_assessments SET result_email_sent_at = UTC_TIMESTAMP() WHERE id = :id AND result_email_sent_at IS NULL')
                    ->execute(['id' => $assessmentId]);
                $sent++;
            } catch (\Throwable $error) {
                write_log('error', 'Automatic assessment result email failed', ['assessment_id' => $assessmentId, 'detail' => $error->getMessage()]);
            } finally {
                $release = $pdo->prepare('SELECT RELEASE_LOCK(:lock_name)');
                $release->execute(['lock_name' => $lockName]);
            }
        }
        return $sent;
    }

    public function results(int $ownerId, int $assessmentId, bool $allowAnyOwner = false): array
    {
        $pdo = Connection::get();
        $assessment = $pdo->prepare(
            'SELECT a.id, a.title, a.status, a.total_marks, a.duration_minutes, a.duration_days, a.expires_at,
                    a.paused_at, a.paused_seconds, a.result_published_at, a.result_email_sent_at,
                    TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), a.expires_at) AS remaining_seconds,
                    a.security_level, a.access_mode, a.questions_json, a.share_token, a.owner_user_id,
                    a.question_revision_counts_json,
                    c.name AS class_name, a.subject_name AS subject
             FROM online_assessments a JOIN assessment_classes c ON c.id = a.class_id
             WHERE a.id = :id ' . ($allowAnyOwner ? '' : 'AND a.owner_user_id = :owner ') . 'LIMIT 1'
        );
        $assessment->execute($allowAnyOwner ? ['id' => $assessmentId] : ['id' => $assessmentId, 'owner' => $ownerId]);
        $details = $assessment->fetch();
        if (!$details) throw new RuntimeException('The assessment was not found in your account.', 404);
        $classNames = $pdo->prepare(
            'SELECT c.id, c.name, ac.status FROM online_assessment_classes ac JOIN assessment_classes c ON c.id = ac.class_id
             WHERE ac.assessment_id = :assessment ORDER BY c.name'
        );
        $classNames->execute(['assessment' => $assessmentId]);
        $details['classes'] = array_map(static fn(array $class): array => [
            'id' => (int)$class['id'],
            'name' => (string)$class['name'],
            'status' => (string)$class['status'],
        ], $classNames->fetchAll());
        $details['class_name'] = implode(', ', array_column($details['classes'], 'name'));
        $details['take_url'] = \app_url('assessment/take?assessment=' . $details['share_token']);
        unset($details['share_token']);
        $questions = json_decode((string)$details['questions_json'], true, 64, JSON_THROW_ON_ERROR);
        unset($details['questions_json']);
        foreach ($questions as &$question) {
            if (($question['question_type'] ?? '') === 'mcq') {
                $question['prompt'] = self::removeEmbeddedMcqOptions((string)$question['prompt']);
            }
        }
        unset($question);
        $manualPointsPossible = 0;
        foreach ($questions as $question) {
            if ($question['question_type'] !== 'mcq') $manualPointsPossible += (int)$question['marks'];
        }
        $details['manual_points_possible'] = $manualPointsPossible;
        $details['question_revision_counts'] = $details['question_revision_counts_json'] === null
            ? array_fill(0, count($questions), 0)
            : json_decode((string)$details['question_revision_counts_json'], true, 32, JSON_THROW_ON_ERROR);
        unset($details['question_revision_counts_json']);
        $details['security_instructions'] = self::securityGuidance((string)$details['security_level']);
        $rows = $pdo->prepare(
            'SELECT r.id AS roster_id, r.learner_name, c.name AS class_name, ac.status AS class_status, ar.access_code_encrypted,
                    t.id AS attempt_id, t.attempt_number, t.status, t.started_at, t.submitted_at,
                    t.auto_score, t.manual_score, t.needs_manual_review,
                    t.answers_json, t.timed_out_questions_json, t.question_reviews_json,
                    ir.decision AS integrity_review_decision,
                    ir.marks_deducted AS integrity_marks_deducted,
                    ir.reason AS integrity_review_reason
             FROM online_assessment_roster ar
             JOIN assessment_roster r ON r.id = ar.roster_id
             JOIN assessment_classes c ON c.id = r.class_id
             JOIN online_assessment_classes ac ON ac.assessment_id = ar.assessment_id AND ac.class_id = r.class_id
             LEFT JOIN assessment_attempts t ON t.id = (
                 SELECT MAX(t2.id) FROM assessment_attempts t2
                 WHERE t2.assessment_id = :assessment AND t2.roster_id = r.id
             )
             LEFT JOIN assessment_integrity_reviews ir ON ir.id = (
                 SELECT MAX(ir2.id) FROM assessment_integrity_reviews ir2 WHERE ir2.attempt_id = t.id
             )
             WHERE ar.assessment_id = :assessment2
             ORDER BY c.name, r.learner_name'
        );
        $rows->execute(['assessment' => $assessmentId, 'assessment2' => $assessmentId]);
        $attemptHistoryQuery = $pdo->prepare(
            'SELECT t.roster_id, t.id, t.attempt_number, COALESCE(t.superseded_from_status, t.status) AS status,
                    t.status AS stored_status, t.auto_score, t.manual_score, t.needs_manual_review, t.submitted_at,
                    t.answers_json, t.timed_out_questions_json,
                    ir.decision AS integrity_review_decision,
                    ir.marks_deducted AS integrity_marks_deducted,
                    ir.reason AS integrity_review_reason
             FROM assessment_attempts t
             LEFT JOIN assessment_integrity_reviews ir ON ir.id = (
                 SELECT MAX(ir2.id) FROM assessment_integrity_reviews ir2 WHERE ir2.attempt_id = t.id
             )
             WHERE t.assessment_id = :assessment
             ORDER BY t.roster_id, t.attempt_number DESC'
        );
        $attemptHistoryQuery->execute(['assessment' => $assessmentId]);
        $attemptHistory = [];
        $historyEventsQuery = $pdo->prepare(
            'SELECT e.attempt_id, e.event_type, COUNT(*) AS event_count
             FROM assessment_attempt_events e
             JOIN assessment_attempts t ON t.id = e.attempt_id
             WHERE t.assessment_id = :assessment GROUP BY e.attempt_id, e.event_type'
        );
        $historyEventsQuery->execute(['assessment' => $assessmentId]);
        $historyEvents = [];
        foreach ($historyEventsQuery->fetchAll() as $event) {
            $historyEvents[(int)$event['attempt_id']][(string)$event['event_type']] = (int)$event['event_count'];
        }
        foreach ($attemptHistoryQuery->fetchAll() as $history) {
            $attemptHistory[(int)$history['roster_id']][] = [
                'attempt_id' => (int)$history['id'],
                'attempt_number' => (int)$history['attempt_number'],
                'status' => (string)$history['status'],
                'stored_status' => (string)$history['stored_status'],
                'auto_score' => (int)$history['auto_score'],
                'manual_score' => $history['manual_score'] === null ? null : (int)$history['manual_score'],
                'needs_manual_review' => (bool)$history['needs_manual_review'],
                'submitted_at' => $history['submitted_at'],
                'answers' => $history['answers_json'] === null ? [] : json_decode((string)$history['answers_json'], true, 32, JSON_THROW_ON_ERROR),
                'timed_out_questions' => $history['timed_out_questions_json'] === null ? [] : json_decode((string)$history['timed_out_questions_json'], true, 32, JSON_THROW_ON_ERROR),
                'integrity_review_decision' => $history['integrity_review_decision'],
                'integrity_marks_deducted' => (int)($history['integrity_marks_deducted'] ?? 0),
                'integrity_review_reason' => $history['integrity_review_reason'],
                'integrity_events' => $historyEvents[(int)$history['id']] ?? [],
            ];
        }
        $students = [];
        foreach ($rows->fetchAll() as $row) {
            $accessCode = '';
            if ($details['access_mode'] === 'individual_code' && $row['access_code_encrypted'] !== null) {
                $accessCode = SecretCipher::decrypt((string)$row['access_code_encrypted'], 'assessment-roster-code-v1');
            }
            $events = [];
            if ($row['attempt_id'] !== null) {
                $eventStatement = $pdo->prepare(
                    'SELECT event_type, COUNT(*) AS event_count
                     FROM assessment_attempt_events WHERE attempt_id = :attempt GROUP BY event_type'
                );
                $eventStatement->execute(['attempt' => (int)$row['attempt_id']]);
                foreach ($eventStatement->fetchAll() as $event) {
                    $events[(string)$event['event_type']] = (int)$event['event_count'];
                }
            }
            $previousAttempts = array_values(array_filter(
                $attemptHistory[(int)$row['roster_id']] ?? [],
                static fn(array $history): bool => (int)$history['attempt_id'] !== (int)($row['attempt_id'] ?? 0)
            ));
            $students[] = [
                'roster_id' => (int)$row['roster_id'],
                'learner_name' => (string)$row['learner_name'],
                'class_name' => (string)$row['class_name'],
                'class_status' => (string)$row['class_status'],
                'access_code' => $accessCode,
                'attempt_id' => $row['attempt_id'] === null ? null : (int)$row['attempt_id'],
                'attempt_number' => $row['attempt_number'] === null ? null : (int)$row['attempt_number'],
                'previous_attempts' => $previousAttempts,
                'status' => $row['status'] === null ? 'not_started' : (string)$row['status'],
                'started_at' => $row['started_at'],
                'submitted_at' => $row['submitted_at'],
                'auto_score' => (int)($row['auto_score'] ?? 0),
                'manual_score' => $row['manual_score'] === null ? null : (int)$row['manual_score'],
                'needs_manual_review' => (bool)$row['needs_manual_review'],
                'integrity_events' => $events,
                'answers' => $row['answers_json'] === null ? null : json_decode((string)$row['answers_json'], true, 32, JSON_THROW_ON_ERROR),
                'timed_out_questions' => $row['timed_out_questions_json'] === null ? [] : json_decode((string)$row['timed_out_questions_json'], true, 32, JSON_THROW_ON_ERROR),
                'question_reviews' => $row['question_reviews_json'] === null ? [] : json_decode((string)$row['question_reviews_json'], true, 32, JSON_THROW_ON_ERROR),
                'integrity_review' => $row['integrity_review_decision'] === null ? null : [
                    'decision' => (string)$row['integrity_review_decision'],
                    'marks_deducted' => (int)$row['integrity_marks_deducted'],
                    'reason' => (string)$row['integrity_review_reason'],
                ],
                'integrity_marks_deducted' => (int)($row['integrity_marks_deducted'] ?? 0),
            ];
        }
        return ['assessment' => $details, 'questions' => $questions, 'students' => $students];
    }

    public function emailScoreSheet(int $ownerId, int $assessmentId, bool $allowAnyOwner = false): array
    {
        $result = $this->results($ownerId, $assessmentId, $allowAnyOwner);
        $recipientQuery = Connection::get()->prepare('SELECT email FROM users WHERE id = :owner LIMIT 1');
        $recipientQuery->execute(['owner' => (int)$result['assessment']['owner_user_id']]);
        $recipient = $recipientQuery->fetchColumn();
        if (!is_string($recipient) || filter_var($recipient, FILTER_VALIDATE_EMAIL) === false) {
            throw new RuntimeException('The creator account does not have a valid email address.', 422);
        }

        $assessment = $result['assessment'];
        unset($assessment['owner_user_id']);
        $stream = fopen('php://temp', 'w+b');
        if ($stream === false) throw new RuntimeException('The score sheet could not be prepared.', 500);
        fwrite($stream, "\xEF\xBB\xBF");
        $safeCell = static function ($value): string {
            $text = (string)$value;
            return preg_match('/^[\s]*[=+\-@]/u', $text) === 1 ? "'" . $text : $text;
        };
        fputcsv($stream, ['Assessment', $safeCell($assessment['title'])], ',', '"', '');
        fputcsv($stream, ['Class', $safeCell($assessment['class_name'])], ',', '"', '');
        fputcsv($stream, ['Total marks', (int)$assessment['total_marks']], ',', '"', '');
        fputcsv($stream, [], ',', '"', '');
        fputcsv($stream, ['Learner', 'Status', 'Objective score', 'Written score', 'Integrity deduction', 'Integrity review reason', 'Final score', 'Maximum marks', 'Percentage', 'Submitted at', 'Manual review', 'Browser events'], ',', '"', '');
        foreach ($result['students'] as $student) {
            $manualPending = (bool)$student['needs_manual_review'] && $student['manual_score'] === null;
            $score = $student['status'] === 'submitted' && !$manualPending
                ? max(0, (int)$student['auto_score'] + (int)($student['manual_score'] ?? 0) - (int)($student['integrity_marks_deducted'] ?? 0))
                : null;
            $percentage = $score === null || (int)$assessment['total_marks'] < 1
                ? ''
                : number_format(($score / (int)$assessment['total_marks']) * 100, 1, '.', '');
            $eventSummary = [];
            foreach ($student['integrity_events'] as $event => $count) $eventSummary[] = $event . ': ' . (int)$count;
            fputcsv($stream, [
                $safeCell($student['learner_name']), str_replace('_', ' ', $student['status']),
                $student['status'] === 'submitted' ? (int)$student['auto_score'] : '',
                $student['manual_score'] ?? '', (int)($student['integrity_marks_deducted'] ?? 0),
                $safeCell($student['integrity_review']['reason'] ?? ''), $score ?? '',
                (int)$assessment['total_marks'], $percentage,
                $student['submitted_at'] ?? '', $manualPending ? 'Pending' : 'No', $safeCell(implode('; ', $eventSummary)),
            ], ',', '"', '');
        }
        rewind($stream);
        $csv = stream_get_contents($stream);
        fclose($stream);
        if (!is_string($csv)) throw new RuntimeException('The score sheet could not be prepared.', 500);
        $className = (string)$assessment['class_name'];
        $title = (string)$assessment['title'];
        $fileName = preg_replace('/[^A-Za-z0-9_-]+/', '-', $title . '-' . $className) ?: 'assessment-score-sheet';
        Mailer::sendScoreSheet($recipient, $title, $className, $csv, trim($fileName, '-') . '-scores.csv');
        return ['sent' => true];
    }

    public function grade(int $ownerId, int $attemptId, int $manualScore, array $questionReviews = []): array
    {
        $pdo = Connection::get();
        $statement = $pdo->prepare(
            "SELECT t.id, t.auto_score, a.total_marks, a.questions_json
             FROM assessment_attempts t JOIN online_assessments a ON a.id = t.assessment_id
             WHERE t.id = :attempt AND a.owner_user_id = :owner AND t.status = 'submitted' LIMIT 1"
        );
        $statement->execute(['attempt' => $attemptId, 'owner' => $ownerId]);
        $row = $statement->fetch();
        if (!$row) throw new RuntimeException('The submitted attempt was not found in your account.', 404);
        $questions = json_decode((string)$row['questions_json'], true, 64, JSON_THROW_ON_ERROR);
        $objectivePossible = 0;
        foreach ($questions as $question) {
            if ($question['question_type'] !== 'mcq') $objectivePossible += (int)$question['marks'];
        }
        if ($manualScore < 0 || $manualScore > $objectivePossible) {
            throw new RuntimeException("The written-response score must be between 0 and {$objectivePossible}.", 422);
        }
        $cleanReviews = [];
        if ($questionReviews !== []) {
            $manualScore = 0;
            foreach ($questions as $index => $question) {
                if ($question['question_type'] === 'mcq') continue;
                $review = $questionReviews[(string)$index] ?? null;
                $score = is_array($review) ? filter_var($review['score'] ?? null, FILTER_VALIDATE_INT) : false;
                $comment = is_array($review) ? ($review['comment'] ?? '') : null;
                if ($score === false || $score < 0 || $score > (int)$question['marks']
                    || !is_string($comment) || mb_strlen($comment) > 1000) {
                    throw new RuntimeException('Enter a valid mark and a comment of no more than 1,000 characters for each written question.', 422);
                }
                $manualScore += $score;
                $cleanReviews[(string)$index] = ['score' => $score, 'comment' => trim($comment)];
            }
        }
        if ($manualScore < 0 || $manualScore > $objectivePossible) {
            throw new RuntimeException("The written-response score must be between 0 and {$objectivePossible}.", 422);
        }
        $pdo->prepare('UPDATE assessment_attempts SET manual_score = :score, question_reviews_json = :reviews, needs_manual_review = 0 WHERE id = :id')
            ->execute([
                'score' => $manualScore,
                'reviews' => json_encode($cleanReviews, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'id' => $attemptId,
            ]);
        return ['attempt_id' => $attemptId, 'manual_score' => $manualScore, 'total_score' => (int)$row['auto_score'] + $manualScore];
    }

    public function reviewIntegrityMarks(
        int $reviewerId,
        int $attemptId,
        string $decision,
        int $marksDeducted,
        string $reason,
        bool $allowAnyOwner = false
    ): array {
        $reason = trim($reason);
        if (!in_array($decision, ['maintain', 'deduct'], true)
            || mb_strlen($reason) < 10 || mb_strlen($reason) > 1000) {
            throw new RuntimeException('Choose maintain or deduct, and provide a clear reason of 10 to 1,000 characters.', 422);
        }
        if (($decision === 'maintain' && $marksDeducted !== 0)
            || ($decision === 'deduct' && $marksDeducted < 1)) {
            throw new RuntimeException('Maintaining marks requires a zero deduction; deducting marks requires at least one mark.', 422);
        }

        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $attemptQuery = $pdo->prepare(
                "SELECT t.id, t.status, t.auto_score, t.manual_score, t.needs_manual_review,
                        a.total_marks,
                        (SELECT COUNT(*) FROM assessment_attempt_events e WHERE e.attempt_id = t.id) AS event_count
                 FROM assessment_attempts t
                 JOIN online_assessments a ON a.id = t.assessment_id
                 WHERE t.id = :attempt " . ($allowAnyOwner ? '' : 'AND a.owner_user_id = :owner ') . "
                   AND t.status IN ('submitted', 'expired')
                 LIMIT 1 FOR UPDATE"
            );
            $parameters = ['attempt' => $attemptId];
            if (!$allowAnyOwner) $parameters['owner'] = $reviewerId;
            $attemptQuery->execute($parameters);
            $attempt = $attemptQuery->fetch();
            if (!$attempt) {
                throw new RuntimeException('The submitted attempt was not found in your account.', 404);
            }
            if ((int)$attempt['event_count'] < 1) {
                throw new RuntimeException('This learner has no recorded integrity events to review.', 409);
            }
            if ($marksDeducted > (int)$attempt['total_marks']) {
                throw new RuntimeException('The deduction cannot exceed the assessment total marks.', 422);
            }

            $review = $pdo->prepare(
                'INSERT INTO assessment_integrity_reviews
                    (attempt_id, reviewed_by_user_id, decision, marks_deducted, reason)
                 VALUES (:attempt, :reviewer, :decision, :deducted, :reason)'
            );
            $review->execute([
                'attempt' => $attemptId,
                'reviewer' => $reviewerId,
                'decision' => $decision,
                'deducted' => $marksDeducted,
                'reason' => $reason,
            ]);
            $pdo->commit();
            $manualPending = (bool)$attempt['needs_manual_review'] && $attempt['manual_score'] === null;
            $grossScore = (int)$attempt['auto_score'] + (int)($attempt['manual_score'] ?? 0);
            return [
                'attempt_id' => $attemptId,
                'decision' => $decision,
                'marks_deducted' => $marksDeducted,
                'reason' => $reason,
                'final_score' => $manualPending ? null : max(0, $grossScore - $marksDeducted),
            ];
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $exception;
        }
    }
}
