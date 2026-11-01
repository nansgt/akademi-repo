<?php
declare(strict_types=1);

namespace Akademi\Services;

use Akademi\Database\Connection;
use Akademi\Security\SecretCipher;
use PDO;
use RuntimeException;

final class PresentationSimulationService
{
    private const THEMES = ['modern', 'editorial', 'vibrant', 'data', 'minimal'];
    private const TEMPLATES = ['lesson', 'inquiry', 'worked', 'discussion', 'project', 'revision', 'flipped'];
    private const REVEAL_MODES = ['all', 'group', 'item', 'timed'];
    private const REACTIONS = ['understood', 'confused', 'slower', 'faster'];
    private const COLORS = ['#e5484d', '#2f80ed', '#27ae60', '#f2c94c', '#ffffff'];
    private const MAX_SLIDES = 100;
    private const MAX_PRESENTATION_BYTES = 2500000;

    public function create(int $userId, array $input): array
    {
        $title = trim((string)($input['title'] ?? ''));
        $presentation = $input['presentation'] ?? null;
        if ($title === '' || mb_strlen($title) > 255 || !is_array($presentation)) {
            throw new RuntimeException('The presentation details are invalid.', 422);
        }
        $slides = $presentation['slides'] ?? null;
        if (!is_array($slides) || count($slides) < 1 || count($slides) > self::MAX_SLIDES) {
            throw new RuntimeException('A live presentation must contain between 1 and 100 slides.', 422);
        }
        $theme = (string)($presentation['visual_theme'] ?? 'modern');
        $template = (string)($presentation['template'] ?? 'lesson');
        $revealMode = (string)($presentation['reveal_mode'] ?? 'all');
        $revealInterval = filter_var($presentation['reveal_interval_seconds'] ?? 5, FILTER_VALIDATE_INT);
        if (!in_array($theme, self::THEMES, true) || !in_array($template, self::TEMPLATES, true)
            || !in_array($revealMode, self::REVEAL_MODES, true)
            || $revealInterval === false || $revealInterval < 2 || $revealInterval > 60) {
            throw new RuntimeException('The presentation design, reveal mode or reveal timing is invalid.', 422);
        }
        foreach ($slides as $slide) {
            if (!is_array($slide) || !is_string($slide['title'] ?? null)) {
                throw new RuntimeException('One or more presentation slides are invalid.', 422);
            }
        }
        $encodedPresentation = json_encode([
            'subject' => mb_substr(trim((string)($presentation['subject'] ?? '')), 0, 190, 'UTF-8'),
            'year' => mb_substr(trim((string)($presentation['year'] ?? '')), 0, 40, 'UTF-8'),
            'template' => $template,
            'visual_theme' => $theme,
            'slides' => array_values($slides),
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        if (strlen($encodedPresentation) > self::MAX_PRESENTATION_BYTES) {
            throw new RuntimeException('This presentation is too large to share live. Reduce the slide content and try again.', 413);
        }
        $token = bin2hex(random_bytes(32));
        $statement = Connection::get()->prepare(
            'INSERT INTO presentation_simulations
             (user_id, share_token_hash, share_token_encrypted, title, presentation_data, reveal_mode, reveal_interval_seconds, expires_at)
             VALUES (:user_id, :token_hash, :token_encrypted, :title, :presentation_data, :reveal_mode, :reveal_interval, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 12 HOUR))'
        );
        $statement->execute([
            'user_id' => $userId,
            'token_hash' => hash('sha256', $token, true),
            'token_encrypted' => SecretCipher::encrypt($token, 'presentation-share-token-v1'),
            'title' => $title,
            'presentation_data' => $encodedPresentation,
            'reveal_mode' => $revealMode,
            'reveal_interval' => $revealInterval,
        ]);
        $id = (int)Connection::get()->lastInsertId();
        return [
            'id' => $id,
            'url' => self::studentUrl($token),
            'expires_at' => gmdate('c', time() + 12 * 60 * 60),
        ];
    }

    public function update(int $userId, int $simulationId, array $input): array
    {
        $pdo = Connection::get();
        $select = $pdo->prepare(
            'SELECT presentation_data, active_slide, status, reveal_mode, reveal_step, active_poll
             FROM presentation_simulations
             WHERE id = :id AND user_id = :user_id AND expires_at > UTC_TIMESTAMP() LIMIT 1'
        );
        $select->execute(['id' => $simulationId, 'user_id' => $userId]);
        $row = $select->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            throw new RuntimeException('The live presentation is no longer available.', 404);
        }
        if ($row['status'] !== 'active') {
            throw new RuntimeException('This live presentation has already ended.', 409);
        }

        $presentation = json_decode((string)$row['presentation_data'], true, 32, JSON_THROW_ON_ERROR);
        $slides = $presentation['slides'] ?? [];
        $activeSlide = array_key_exists('active_slide', $input)
            ? filter_var($input['active_slide'], FILTER_VALIDATE_INT)
            : (int)$row['active_slide'];
        $status = (string)($input['status'] ?? 'active');
        $revealMode = (string)($input['reveal_mode'] ?? $row['reveal_mode']);
        $revealStep = array_key_exists('reveal_step', $input)
            ? filter_var($input['reveal_step'], FILTER_VALIDATE_INT)
            : (int)$row['reveal_step'];
        if ($activeSlide === false || $activeSlide < 0 || $activeSlide >= count($slides)
            || !in_array($status, ['active', 'ended'], true)
            || !in_array($revealMode, self::REVEAL_MODES, true)
            || $revealStep === false || $revealStep < 0 || $revealStep > 200) {
            throw new RuntimeException('The live presentation update is invalid.', 422);
        }
        if ($activeSlide !== (int)$row['active_slide']) {
            $revealStep = 0;
        }

        $assignments = [];
        $parameters = ['id' => $simulationId, 'user_id' => $userId];
        foreach ([
            'active_slide' => $activeSlide,
            'status' => $status,
            'reveal_mode' => $revealMode,
            'reveal_step' => $revealStep,
        ] as $field => $value) {
            if (array_key_exists($field, $input)) {
                $assignments[] = $field . ' = :' . $field;
                $parameters[$field] = $value;
            }
        }

        if ($activeSlide !== (int)$row['active_slide']) {
            if (!array_key_exists('annotations', $input)) {
                $assignments[] = 'annotation_data = NULL';
            }
            if (!array_key_exists('pointer', $input)) {
                $assignments[] = 'pointer_data = NULL';
            }
            if (!array_key_exists('reveal_step', $input)) {
                $assignments[] = 'reveal_step = 0';
            }
        }
        if (array_key_exists('annotations', $input)) {
            $assignments[] = 'annotation_data = :annotations';
            $parameters['annotations'] = self::encodeNullable(self::validateAnnotations($input['annotations']));
        }
        if (array_key_exists('pointer', $input)) {
            $assignments[] = 'pointer_data = :pointer';
            $parameters['pointer'] = self::encodeNullable(self::validatePointer($input['pointer']));
        }
        if (array_key_exists('timer_duration_seconds', $input)) {
            $duration = filter_var($input['timer_duration_seconds'], FILTER_VALIDATE_INT);
            if ($duration === false || $duration < 0 || $duration > 7200) {
                throw new RuntimeException('Choose a timer between 1 second and 2 hours.', 422);
            }
            $assignments[] = 'timer_duration_seconds = :timer_duration';
            $assignments[] = 'timer_ends_at = :timer_ends_at';
            $parameters['timer_duration'] = $duration === 0 ? null : $duration;
            $parameters['timer_ends_at'] = $duration === 0 ? null : gmdate('Y-m-d H:i:s', time() + $duration);
        }
        if (array_key_exists('reveal_interval_seconds', $input)) {
            $interval = filter_var($input['reveal_interval_seconds'], FILTER_VALIDATE_INT);
            if ($interval === false || $interval < 2 || $interval > 60) {
                throw new RuntimeException('Timed reveals must be between 2 and 60 seconds apart.', 422);
            }
            $assignments[] = 'reveal_interval_seconds = :reveal_interval';
            $parameters['reveal_interval'] = $interval;
        }
        $poll = null;
        if (array_key_exists('active_poll', $input)) {
            $poll = self::validatePoll($input['active_poll']);
            if ($poll === null) {
                $assignments[] = 'active_poll = NULL';
            } else {
                $assignments[] = 'active_poll = :active_poll';
                $parameters['active_poll'] = self::encodeNullable($poll);
            }
        } elseif ($status === 'ended' && $row['active_poll'] !== null) {
            $poll = self::validatePoll(json_decode((string)$row['active_poll'], true, 8, JSON_THROW_ON_ERROR));
            if ($poll !== null) {
                $poll['open'] = false;
                $assignments[] = 'active_poll = :active_poll';
                $parameters['active_poll'] = self::encodeNullable($poll);
            }
        }
        $recordPollHistory = array_key_exists('active_poll', $input) || $status === 'ended';
        if ($status === 'ended') {
            $assignments[] = 'ended_at = COALESCE(ended_at, UTC_TIMESTAMP())';
        }

        if ($assignments !== []) {
            if ($recordPollHistory) {
                $pdo->beginTransaction();
            }
            try {
                $sql = 'UPDATE presentation_simulations SET ' . implode(', ', $assignments)
                    . ' WHERE id = :id AND user_id = :user_id AND status = \'active\' AND expires_at > UTC_TIMESTAMP()';
                $update = $pdo->prepare($sql);
                $update->execute($parameters);
                if ($recordPollHistory) {
                    $previousPoll = $row['active_poll'] === null
                        ? null
                        : json_decode((string)$row['active_poll'], true, 8, JSON_THROW_ON_ERROR);
                    if (is_array($previousPoll) && (!is_array($poll)
                        || !hash_equals((string)($previousPoll['id'] ?? ''), (string)($poll['id'] ?? ''))
                        || empty($poll['open']))) {
                        $savePreviousPoll = $pdo->prepare(
                            'INSERT INTO presentation_simulation_polls
                             (simulation_id, poll_id, question, options, closed_at)
                             VALUES (:simulation_id, :poll_id, :question, :options, UTC_TIMESTAMP())
                             ON DUPLICATE KEY UPDATE question = VALUES(question), options = VALUES(options), closed_at = COALESCE(closed_at, UTC_TIMESTAMP())'
                        );
                        $savePreviousPoll->execute([
                            'simulation_id' => $simulationId,
                            'poll_id' => (string)$previousPoll['id'],
                            'question' => (string)$previousPoll['question'],
                            'options' => json_encode($previousPoll['options'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                        ]);
                        $close = $pdo->prepare(
                            'UPDATE presentation_simulation_polls SET closed_at = COALESCE(closed_at, UTC_TIMESTAMP())
                             WHERE simulation_id = :simulation_id AND poll_id = :poll_id'
                        );
                        $close->execute(['simulation_id' => $simulationId, 'poll_id' => (string)$previousPoll['id']]);
                    }
                    if (is_array($poll)) {
                        $savePoll = $pdo->prepare(
                            'INSERT INTO presentation_simulation_polls
                             (simulation_id, poll_id, question, options, closed_at)
                             VALUES (:simulation_id, :poll_id, :question, :options, :closed_at)
                             ON DUPLICATE KEY UPDATE question = VALUES(question), options = VALUES(options), closed_at = VALUES(closed_at)'
                        );
                        $savePoll->execute([
                            'simulation_id' => $simulationId,
                            'poll_id' => $poll['id'],
                            'question' => $poll['question'],
                            'options' => json_encode($poll['options'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                            'closed_at' => !empty($poll['open']) ? null : gmdate('Y-m-d H:i:s'),
                        ]);
                    }
                    $pdo->commit();
                }
            } catch (\Throwable $exception) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $exception;
            }
        }
        $state = $this->ownerState($userId, $simulationId);
        if ($state['status'] !== 'active' && $status !== 'ended') {
            throw new RuntimeException('The live presentation changed before this update was saved. Refresh and try again.', 409);
        }
        return $state;
    }

    public function ownerState(int $userId, int $simulationId): array
    {
        $statement = Connection::get()->prepare(
            'SELECT id, title, presentation_data, active_slide, status, reveal_mode, reveal_step,
                    reveal_interval_seconds, annotation_data, pointer_data, timer_ends_at, share_token_encrypted,
                    timer_duration_seconds, active_poll, expires_at
             FROM presentation_simulations
             WHERE id = :id AND user_id = :user_id LIMIT 1'
        );
        $statement->execute(['id' => $simulationId, 'user_id' => $userId]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            throw new RuntimeException('The live presentation was not found.', 404);
        }
        $state = $this->stateFromRow($row, false);
        $state['student_url'] = $row['share_token_encrypted'] === null
            ? null
            : self::studentUrl(
                SecretCipher::decrypt((string)$row['share_token_encrypted'], 'presentation-share-token-v1')
            );
        return $state;
    }

    public function studentLink(int $userId, int $simulationId, mixed $existingToken = null): array
    {
        $statement = Connection::get()->prepare(
            'SELECT share_token_hash, share_token_encrypted
             FROM presentation_simulations WHERE id = :id AND user_id = :user_id LIMIT 1'
        );
        $statement->execute(['id' => $simulationId, 'user_id' => $userId]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            throw new RuntimeException('The live presentation was not found.', 404);
        }
        if ($row['share_token_encrypted'] !== null) {
            $token = SecretCipher::decrypt((string)$row['share_token_encrypted'], 'presentation-share-token-v1');
        } elseif (is_string($existingToken) && preg_match('/^[a-f0-9]{64}$/iD', $existingToken)) {
            $tokenHash = hash('sha256', strtolower($existingToken), true);
            if (!hash_equals((string)$row['share_token_hash'], $tokenHash)) {
                throw new RuntimeException('The saved student link no longer matches this presentation. A new link will be created.', 409);
            }
            $token = strtolower($existingToken);
            $save = Connection::get()->prepare(
                'UPDATE presentation_simulations SET share_token_encrypted = :encrypted
                 WHERE id = :id AND user_id = :user_id AND share_token_encrypted IS NULL'
            );
            $save->execute([
                'encrypted' => SecretCipher::encrypt($token, 'presentation-share-token-v1'),
                'id' => $simulationId,
                'user_id' => $userId,
            ]);
            if ($save->rowCount() === 0) {
                $statement->execute(['id' => $simulationId, 'user_id' => $userId]);
                $savedRow = $statement->fetch(PDO::FETCH_ASSOC);
                if (!is_array($savedRow) || $savedRow['share_token_encrypted'] === null) {
                    throw new RuntimeException('The student presentation link could not be saved.', 500);
                }
                $token = SecretCipher::decrypt((string)$savedRow['share_token_encrypted'], 'presentation-share-token-v1');
            }
        } else {
            $token = bin2hex(random_bytes(32));
            $save = Connection::get()->prepare(
                'UPDATE presentation_simulations
                 SET share_token_hash = :token_hash, share_token_encrypted = :encrypted
                 WHERE id = :id AND user_id = :user_id AND share_token_encrypted IS NULL'
            );
            $save->execute([
                'token_hash' => hash('sha256', $token, true),
                'encrypted' => SecretCipher::encrypt($token, 'presentation-share-token-v1'),
                'id' => $simulationId,
                'user_id' => $userId,
            ]);
            if ($save->rowCount() === 0) {
                $statement->execute(['id' => $simulationId, 'user_id' => $userId]);
                $savedRow = $statement->fetch(PDO::FETCH_ASSOC);
                if (!is_array($savedRow) || $savedRow['share_token_encrypted'] === null) {
                    throw new RuntimeException('The student presentation link could not be recovered.', 500);
                }
                $token = SecretCipher::decrypt((string)$savedRow['share_token_encrypted'], 'presentation-share-token-v1');
            }
        }
        return ['url' => self::studentUrl($token)];
    }

    private static function studentUrl(string $token): string
    {
        return app_url('presentation/follow?token=' . rawurlencode($token));
    }

    public function history(int $userId): array
    {
        $statement = Connection::get()->prepare(
            'SELECT id, title,
                    CASE WHEN status = \'active\' AND expires_at <= UTC_TIMESTAMP() THEN \'ended\' ELSE status END AS status,
                    active_slide, presentation_data, created_at, updated_at,
                    COALESCE(ended_at, CASE WHEN status = \'active\' AND expires_at <= UTC_TIMESTAMP() THEN expires_at END) AS ended_at
             FROM presentation_simulations WHERE user_id = :user_id
             ORDER BY COALESCE(ended_at, updated_at, created_at) DESC LIMIT 50'
        );
        $statement->execute(['user_id' => $userId]);
        $sessions = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $presentation = json_decode((string)$row['presentation_data'], true, 32, JSON_THROW_ON_ERROR);
            $simulationId = (int)$row['id'];
            $counts = Connection::get()->prepare(
                'SELECT
                    (SELECT COUNT(*) FROM presentation_simulation_interactions WHERE simulation_id = :poll_session AND interaction_type = \'poll\') AS poll_responses,
                    (SELECT COUNT(*) FROM presentation_simulation_interactions WHERE simulation_id = :pace_session AND interaction_type = \'reaction\') AS pace_responses,
                    (SELECT COUNT(*) FROM presentation_simulation_questions WHERE simulation_id = :question_session) AS questions'
            );
            $counts->execute([
                'poll_session' => $simulationId,
                'pace_session' => $simulationId,
                'question_session' => $simulationId,
            ]);
            $summary = $counts->fetch(PDO::FETCH_ASSOC) ?: [];
            $sessions[] = [
                'id' => $simulationId,
                'title' => (string)$row['title'],
                'subject' => (string)($presentation['subject'] ?? ''),
                'status' => (string)$row['status'],
                'slide_count' => count($presentation['slides'] ?? []),
                'participant_count' => $this->participantCount($simulationId),
                'poll_responses' => (int)($summary['poll_responses'] ?? 0),
                'pace_responses' => (int)($summary['pace_responses'] ?? 0),
                'question_count' => (int)($summary['questions'] ?? 0),
                'created_at' => self::isoDate($row['created_at']),
                'ended_at' => $row['ended_at'] === null ? null : self::isoDate($row['ended_at']),
            ];
        }
        return ['sessions' => $sessions];
    }

    public function historyDetails(int $userId, int $simulationId): array
    {
        $statement = Connection::get()->prepare(
            'SELECT id, title, presentation_data, status, active_slide, active_poll, created_at, updated_at, ended_at
             FROM presentation_simulations WHERE id = :id AND user_id = :user_id LIMIT 1'
        );
        $statement->execute(['id' => $simulationId, 'user_id' => $userId]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            throw new RuntimeException('The presentation history was not found.', 404);
        }
        $pollStatement = Connection::get()->prepare(
            'SELECT poll_id, question, options, opened_at, closed_at
             FROM presentation_simulation_polls WHERE simulation_id = :simulation_id ORDER BY opened_at'
        );
        $pollStatement->execute(['simulation_id' => $simulationId]);
        $polls = [];
        foreach ($pollStatement->fetchAll(PDO::FETCH_ASSOC) as $poll) {
            $poll['options'] = json_decode((string)$poll['options'], true, 8, JSON_THROW_ON_ERROR);
            $poll['opened_at'] = self::isoDate($poll['opened_at']);
            $poll['closed_at'] = $poll['closed_at'] === null ? null : self::isoDate($poll['closed_at']);
            $responses = Connection::get()->prepare(
                'SELECT participant_name, answer_index, updated_at FROM presentation_simulation_interactions
                 WHERE simulation_id = :simulation_id AND interaction_type = \'poll\' AND interaction_key = :poll_id
                 ORDER BY updated_at'
            );
            $responses->execute(['simulation_id' => $simulationId, 'poll_id' => $poll['poll_id']]);
            $poll['responses'] = array_map(static fn(array $response): array => [
                'participant_name' => (string)$response['participant_name'],
                'answer_index' => (int)$response['answer_index'],
                'updated_at' => self::isoDate($response['updated_at']),
            ], $responses->fetchAll(PDO::FETCH_ASSOC));
            $polls[] = $poll;
        }
        $activePoll = $row['active_poll'] === null
            ? null
            : json_decode((string)$row['active_poll'], true, 8, JSON_THROW_ON_ERROR);
        $activePollId = is_array($activePoll) ? (string)($activePoll['id'] ?? '') : '';
        if ($activePollId !== '' && !in_array($activePollId, array_column($polls, 'poll_id'), true)) {
            $activePoll['poll_id'] = $activePollId;
            $activePoll['results'] = $this->pollResults($simulationId, $activePollId);
            $activePoll['responses'] = $this->pollRespondents($simulationId, $activePollId);
            $polls[] = $activePoll;
        }
        $paceStatement = Connection::get()->prepare(
            'SELECT participant_name, reaction, updated_at FROM presentation_simulation_interactions
             WHERE simulation_id = :simulation_id AND interaction_type = \'reaction\' ORDER BY updated_at'
        );
        $paceStatement->execute(['simulation_id' => $simulationId]);
        $questions = $this->questionsForSimulation($simulationId);
        return [
            'id' => (int)$row['id'],
            'title' => (string)$row['title'],
            'presentation' => json_decode((string)$row['presentation_data'], true, 32, JSON_THROW_ON_ERROR),
            'status' => (string)$row['status'],
            'active_slide' => (int)$row['active_slide'],
            'created_at' => self::isoDate($row['created_at']),
            'ended_at' => $row['ended_at'] === null ? null : self::isoDate($row['ended_at']),
            'polls' => $polls,
            'pace_responses' => array_map(static fn(array $response): array => [
                'participant_name' => (string)$response['participant_name'],
                'reaction' => (string)$response['reaction'],
                'updated_at' => self::isoDate($response['updated_at']),
            ], $paceStatement->fetchAll(PDO::FETCH_ASSOC)),
            'questions' => $questions,
        ];
    }

    public function replyToQuestion(int $userId, int $simulationId, int $questionId, mixed $feedback): array
    {
        if (!is_string($feedback)) {
            throw new RuntimeException('Write a reply of 1 to 1000 characters.', 422);
        }
        $feedback = trim($feedback);
        if ($feedback === '' || mb_strlen($feedback) > 1000) {
            throw new RuntimeException('Write a reply of 1 to 1000 characters.', 422);
        }
        $pdo = Connection::get();
        $lookup = $pdo->prepare(
            'SELECT q.id FROM presentation_simulation_questions q
             INNER JOIN presentation_simulations s ON s.id = q.simulation_id
             WHERE q.id = :question_id AND q.simulation_id = :simulation_id AND s.user_id = :user_id LIMIT 1'
        );
        $lookup->execute(['question_id' => $questionId, 'simulation_id' => $simulationId, 'user_id' => $userId]);
        if (!$lookup->fetchColumn()) {
            throw new RuntimeException('The student question was not found.', 404);
        }
        $pdo->beginTransaction();
        try {
            $insertReply = $pdo->prepare(
                'INSERT INTO presentation_simulation_question_replies (question_id, feedback)
                 VALUES (:question_id, :feedback)'
            );
            $insertReply->execute(['question_id' => $questionId, 'feedback' => $feedback]);
            $update = $pdo->prepare(
                'UPDATE presentation_simulation_questions
                 SET teacher_feedback = :feedback, answered_at = UTC_TIMESTAMP()
                 WHERE id = :question_id AND simulation_id = :simulation_id'
            );
            $update->execute(['feedback' => $feedback, 'question_id' => $questionId, 'simulation_id' => $simulationId]);
            $question = $pdo->prepare(
                'SELECT id, participant_name, question, teacher_feedback, created_at, answered_at
                 FROM presentation_simulation_questions WHERE id = :id LIMIT 1'
            );
            $question->execute(['id' => $questionId]);
            $formattedQuestion = $this->formatQuestions([$question->fetch(PDO::FETCH_ASSOC)])[0];
            $pdo->commit();
            return ['question' => $formattedQuestion];
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
    }

    public function read(string $token, ?string $participantId = null): array
    {
        $statement = Connection::get()->prepare(
            'SELECT id, title, presentation_data, active_slide, status, reveal_mode, reveal_step,
                    reveal_interval_seconds, annotation_data, pointer_data, timer_ends_at,
                    timer_duration_seconds, active_poll, expires_at
             FROM presentation_simulations WHERE share_token_hash = :token_hash LIMIT 1'
        );
        $statement->execute(['token_hash' => hash('sha256', $token, true)]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            throw new RuntimeException('This presentation link is invalid or no longer available.', 404);
        }
        $participantHash = $participantId !== null && preg_match('/^[a-f0-9-]{36}$/iD', $participantId)
            ? hash('sha256', strtolower($participantId))
            : null;
        return $this->stateFromRow($row, true, $participantHash);
    }

    public function studentDirectMessages(string $token, string $participantId): array
    {
        $participantId = strtolower(trim($participantId));
        if (!preg_match('/^[a-f0-9-]{36}$/D', $participantId)) {
            throw new RuntimeException('Refresh the student presentation and try again.', 422);
        }
        $participantHash = hash('sha256', $participantId);
        $statement = Connection::get()->prepare(
            'SELECT s.id FROM presentation_simulations s
             INNER JOIN presentation_simulation_participants p ON p.simulation_id = s.id
             WHERE s.share_token_hash = :token_hash AND s.status = \'active\' AND s.expires_at > UTC_TIMESTAMP()
               AND p.participant_hash = :participant_hash
             LIMIT 1'
        );
        $statement->execute([
            'token_hash' => hash('sha256', $token, true),
            'participant_hash' => $participantHash,
        ]);
        $simulationId = $statement->fetchColumn();
        if ($simulationId === false) {
            throw new RuntimeException('Join the live presentation before opening private chat.', 409);
        }
        return [
            'participants' => $this->participantsForStudent((int)$simulationId, $participantHash),
            'messages' => $this->directMessagesForParticipant((int)$simulationId, $participantHash),
        ];
    }

    public function join(string $token, array $input): array
    {
        $participantId = strtolower(trim((string)($input['participant_id'] ?? '')));
        if (!preg_match('/^[a-f0-9-]{36}$/D', $participantId)) {
            throw new RuntimeException('Refresh the student presentation and try again.', 422);
        }
        $participantName = self::validateParticipantName($input['participant_name'] ?? null);
        $statement = Connection::get()->prepare(
            'SELECT id FROM presentation_simulations
             WHERE share_token_hash = :token_hash AND status = \'active\' AND expires_at > UTC_TIMESTAMP()
             LIMIT 1'
        );
        $statement->execute(['token_hash' => hash('sha256', $token, true)]);
        $simulationId = $statement->fetchColumn();
        if ($simulationId === false) {
            throw new RuntimeException('This live presentation is no longer available.', 404);
        }
        $save = Connection::get()->prepare(
            'INSERT INTO presentation_simulation_participants
             (simulation_id, participant_hash, participant_name, joined_at, last_seen_at)
             VALUES (:simulation_id, :participant_hash, :participant_name, UTC_TIMESTAMP(), UTC_TIMESTAMP())
             ON DUPLICATE KEY UPDATE participant_name = VALUES(participant_name), last_seen_at = UTC_TIMESTAMP()'
        );
        $save->execute([
            'simulation_id' => (int)$simulationId,
            'participant_hash' => hash('sha256', $participantId),
            'participant_name' => $participantName,
        ]);
        return ['joined' => true];
    }

    public function interact(string $token, array $input): array
    {
        $participantId = strtolower(trim((string)($input['participant_id'] ?? '')));
        if (!preg_match('/^[a-f0-9-]{36}$/D', $participantId)) {
            throw new RuntimeException('Refresh the student presentation and try again.', 422);
        }
        $participantName = self::validateParticipantName($input['participant_name'] ?? null);
        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $lookup = $pdo->prepare(
                'SELECT id, status, active_poll, expires_at FROM presentation_simulations
                 WHERE share_token_hash = :token_hash LIMIT 1 FOR UPDATE'
            );
            $lookup->execute(['token_hash' => hash('sha256', $token, true)]);
            $simulation = $lookup->fetch(PDO::FETCH_ASSOC);
            if (!$simulation || $simulation['status'] !== 'active'
                || strtotime((string)$simulation['expires_at'] . ' UTC') <= time()) {
                throw new RuntimeException('This live presentation is no longer available.', 404);
            }

            $simulationId = (int)$simulation['id'];
            $participantHash = hash('sha256', $participantId);
            $registerParticipant = $pdo->prepare(
                'INSERT INTO presentation_simulation_participants
                 (simulation_id, participant_hash, participant_name, joined_at, last_seen_at)
                 VALUES (:simulation_id, :participant_hash, :participant_name, UTC_TIMESTAMP(), UTC_TIMESTAMP())
                 ON DUPLICATE KEY UPDATE participant_name = VALUES(participant_name), last_seen_at = UTC_TIMESTAMP()'
            );
            $registerParticipant->execute([
                'simulation_id' => $simulationId,
                'participant_hash' => $participantHash,
                'participant_name' => $participantName,
            ]);
            $type = (string)($input['type'] ?? '');
            if ($type === 'poll') {
                $poll = $simulation['active_poll'] === null
                    ? null
                    : json_decode((string)$simulation['active_poll'], true, 8, JSON_THROW_ON_ERROR);
                $pollId = (string)($input['poll_id'] ?? '');
                $answer = filter_var($input['answer_index'] ?? null, FILTER_VALIDATE_INT);
                if (!is_array($poll) || empty($poll['open']) || !hash_equals((string)($poll['id'] ?? ''), $pollId)
                    || $answer === false || $answer < 0 || $answer >= count($poll['options'] ?? [])) {
                    throw new RuntimeException('That poll is closed or the selected answer is invalid.', 409);
                }
                $save = $pdo->prepare(
                    'INSERT INTO presentation_simulation_interactions
                     (simulation_id, participant_hash, participant_name, interaction_type, interaction_key, answer_index)
                      VALUES (:simulation_id, :participant_hash, :participant_name, \'poll\', :interaction_key, :answer_index)
                      ON DUPLICATE KEY UPDATE participant_name = VALUES(participant_name), answer_index = VALUES(answer_index), updated_at = UTC_TIMESTAMP()'
                );
                $save->execute([
                    'simulation_id' => $simulationId,
                    'participant_hash' => $participantHash,
                    'participant_name' => $participantName,
                    'interaction_key' => $pollId,
                    'answer_index' => $answer,
                ]);
            } elseif ($type === 'reaction') {
                $reaction = (string)($input['reaction'] ?? '');
                if (!in_array($reaction, self::REACTIONS, true)) {
                    throw new RuntimeException('Choose a valid classroom reaction.', 422);
                }
                $save = $pdo->prepare(
                    'INSERT INTO presentation_simulation_interactions
                     (simulation_id, participant_hash, participant_name, interaction_type, interaction_key, reaction)
                      VALUES (:simulation_id, :participant_hash, :participant_name, \'reaction\', \'reaction\', :reaction)
                      ON DUPLICATE KEY UPDATE participant_name = VALUES(participant_name), reaction = VALUES(reaction), updated_at = UTC_TIMESTAMP()'
                );
                $save->execute([
                    'simulation_id' => $simulationId,
                    'participant_hash' => $participantHash,
                    'participant_name' => $participantName,
                    'reaction' => $reaction,
                ]);
            } elseif ($type === 'question') {
                $questionInput = $input['question'] ?? null;
                if (!is_string($questionInput)) {
                    throw new RuntimeException('Write a question of 1 to 1000 characters.', 422);
                }
                $question = trim($questionInput);
                if ($question === '' || mb_strlen($question) > 1000) {
                    throw new RuntimeException('Write a question of 1 to 1000 characters.', 422);
                }
                $rateLimit = $pdo->prepare(
                    'SELECT COUNT(*) FROM presentation_simulation_questions
                     WHERE simulation_id = :simulation_id AND participant_hash = :participant_hash
                     AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE)'
                );
                $rateLimit->execute(['simulation_id' => $simulationId, 'participant_hash' => $participantHash]);
                if ((int)$rateLimit->fetchColumn() >= 3) {
                    throw new RuntimeException('Please wait a moment before asking another question.', 429);
                }
                $save = $pdo->prepare(
                    'INSERT INTO presentation_simulation_questions
                     (simulation_id, participant_hash, participant_name, question)
                     VALUES (:simulation_id, :participant_hash, :participant_name, :question)'
                );
                $save->execute([
                    'simulation_id' => $simulationId,
                    'participant_hash' => $participantHash,
                    'participant_name' => $participantName,
                    'question' => $question,
                ]);
            } elseif ($type === 'direct_message') {
                $messageInput = $input['message'] ?? null;
                $recipientInput = $input['recipient_id'] ?? null;
                if (!is_string($messageInput) || !is_string($recipientInput)) {
                    throw new RuntimeException('Choose a recipient and write a message of 1 to 1000 characters.', 422);
                }
                $message = trim($messageInput);
                if ($message === '' || mb_strlen($message) > 1000) {
                    throw new RuntimeException('Write a message of 1 to 1000 characters.', 422);
                }
                if ($recipientInput === 'teacher') {
                    $recipientHash = null;
                } elseif (preg_match('/^[a-f0-9]{64}$/D', $recipientInput)) {
                    $recipientHash = strtolower($recipientInput);
                    if (hash_equals($participantHash, $recipientHash)) {
                        throw new RuntimeException('Choose another participant to message.', 422);
                    }
                    $recipient = $pdo->prepare(
                        'SELECT 1 FROM presentation_simulation_participants
                         WHERE simulation_id = :simulation_id AND participant_hash = :participant_hash
                           AND last_seen_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 60 SECOND)
                         LIMIT 1'
                    );
                    $recipient->execute(['simulation_id' => $simulationId, 'participant_hash' => $recipientHash]);
                    if (!$recipient->fetchColumn()) {
                        throw new RuntimeException('That student is no longer online. Choose another recipient.', 409);
                    }
                } else {
                    throw new RuntimeException('Choose an online participant to message.', 422);
                }
                $rateLimit = $pdo->prepare(
                    'SELECT COUNT(*) FROM presentation_simulation_direct_messages
                     WHERE simulation_id = :simulation_id AND sender_hash = :sender_hash
                       AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE)'
                );
                $rateLimit->execute(['simulation_id' => $simulationId, 'sender_hash' => $participantHash]);
                if ((int)$rateLimit->fetchColumn() >= 20) {
                    throw new RuntimeException('Please wait a moment before sending another message.', 429);
                }
                $save = $pdo->prepare(
                    'INSERT INTO presentation_simulation_direct_messages
                     (simulation_id, sender_hash, recipient_hash, sender_name, message)
                     VALUES (:simulation_id, :sender_hash, :recipient_hash, :sender_name, :message)'
                );
                $save->execute([
                    'simulation_id' => $simulationId,
                    'sender_hash' => $participantHash,
                    'recipient_hash' => $recipientHash,
                    'sender_name' => $participantName,
                    'message' => $message,
                ]);
            } else {
                throw new RuntimeException('Choose a supported presentation interaction.', 422);
            }
            $pdo->commit();
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
        return $this->read($token, $participantId);
    }

    public function teacherDirectMessages(int $userId, int $simulationId, string $participantHash): array
    {
        if (!preg_match('/^[a-f0-9]{64}$/D', $participantHash)) {
            throw new RuntimeException('The student conversation is invalid.', 422);
        }
        $pdo = Connection::get();
        $owner = $pdo->prepare(
            'SELECT 1 FROM presentation_simulations
             WHERE id = :id AND user_id = :user_id AND status = \'active\'
               AND expires_at > UTC_TIMESTAMP() LIMIT 1'
        );
        $owner->execute(['id' => $simulationId, 'user_id' => $userId]);
        if (!$owner->fetchColumn()) {
            throw new RuntimeException('The live presentation is no longer available.', 404);
        }
        $student = $pdo->prepare(
            'SELECT 1 FROM presentation_simulation_participants
             WHERE simulation_id = :simulation_id AND participant_hash = :participant_hash LIMIT 1'
        );
        $student->execute(['simulation_id' => $simulationId, 'participant_hash' => $participantHash]);
        if (!$student->fetchColumn()) {
            throw new RuntimeException('The student conversation was not found.', 404);
        }
        $messages = $pdo->prepare(
            'SELECT sender_name, message, created_at, sender_hash IS NULL AS from_teacher
             FROM presentation_simulation_direct_messages
             WHERE simulation_id = :simulation_id
               AND ((sender_hash IS NULL AND recipient_hash = :teacher_recipient)
                 OR (sender_hash = :student_sender AND recipient_hash IS NULL))
             ORDER BY id DESC LIMIT 200'
        );
        $messages->execute([
            'simulation_id' => $simulationId,
            'teacher_recipient' => $participantHash,
            'student_sender' => $participantHash,
        ]);
        $rows = array_reverse($messages->fetchAll(PDO::FETCH_ASSOC));
        return ['messages' => array_map(static fn(array $row): array => [
            'sender_name' => (bool)$row['from_teacher'] ? 'Teacher' : (string)$row['sender_name'],
            'message' => (string)$row['message'],
            'mine' => (bool)$row['from_teacher'],
            'created_at' => self::isoDate($row['created_at']),
        ], $rows)];
    }

    public function sendTeacherDirectMessage(int $userId, int $simulationId, string $participantHash, mixed $messageInput): array
    {
        if (!preg_match('/^[a-f0-9]{64}$/D', $participantHash)) {
            throw new RuntimeException('The student conversation is invalid.', 422);
        }
        if (!is_string($messageInput)) {
            throw new RuntimeException('Write a message of 1 to 1000 characters.', 422);
        }
        $message = trim($messageInput);
        if ($message === '' || mb_strlen($message) > 1000) {
            throw new RuntimeException('Write a message of 1 to 1000 characters.', 422);
        }
        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $owner = $pdo->prepare(
                'SELECT id FROM presentation_simulations
                 WHERE id = :id AND user_id = :user_id AND status = \'active\'
                   AND expires_at > UTC_TIMESTAMP() LIMIT 1 FOR UPDATE'
            );
            $owner->execute(['id' => $simulationId, 'user_id' => $userId]);
            if (!$owner->fetchColumn()) {
                throw new RuntimeException('The live presentation is no longer available.', 404);
            }
            $student = $pdo->prepare(
                'SELECT 1 FROM presentation_simulation_participants
                 WHERE simulation_id = :simulation_id AND participant_hash = :participant_hash
                   AND last_seen_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 60 SECOND)
                 LIMIT 1'
            );
            $student->execute(['simulation_id' => $simulationId, 'participant_hash' => $participantHash]);
            if (!$student->fetchColumn()) {
                throw new RuntimeException('That student is no longer online.', 409);
            }
            $save = $pdo->prepare(
                'INSERT INTO presentation_simulation_direct_messages
                 (simulation_id, sender_hash, recipient_hash, sender_name, message)
                 VALUES (:simulation_id, NULL, :recipient_hash, \'Teacher\', :message)'
            );
            $save->execute([
                'simulation_id' => $simulationId,
                'recipient_hash' => $participantHash,
                'message' => $message,
            ]);
            $pdo->commit();
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
        return $this->teacherDirectMessages($userId, $simulationId, $participantHash);
    }

    private function stateFromRow(array $row, bool $forStudent, ?string $participantHash = null): array
    {
        $presentation = json_decode((string)$row['presentation_data'], true, 32, JSON_THROW_ON_ERROR);
        $slides = $presentation['slides'] ?? [];
        $activeSlide = (int)$row['active_slide'];
        $ended = $row['status'] !== 'active' || strtotime((string)$row['expires_at'] . ' UTC') <= time();
        $poll = $row['active_poll'] === null ? null : json_decode((string)$row['active_poll'], true, 8, JSON_THROW_ON_ERROR);
        if (is_array($poll)) {
            $poll['results'] = $this->pollResults((int)$row['id'], (string)($poll['id'] ?? ''));
            if (!$forStudent) {
                $poll['responses'] = $this->pollRespondents((int)$row['id'], (string)($poll['id'] ?? ''));
            }
        }
        $pointer = $row['pointer_data'] === null ? null : json_decode((string)$row['pointer_data'], true, 8, JSON_THROW_ON_ERROR);
        if (is_array($pointer) && isset($pointer['updated_at']) && (time() - (int)$pointer['updated_at'] > 4)) {
            $pointer['active'] = false;
        }
        $slide = $ended ? null : ($slides[$activeSlide] ?? null);
        $revealMode = (string)$row['reveal_mode'];
        $revealStep = (int)$row['reveal_step'];
        $revealTotal = is_array($slide) ? self::revealUnitCount($slide, $revealMode) : 0;
        if ($forStudent && is_array($slide)) {
            $slide = self::revealedSlide($slide, $revealMode, $revealStep);
            unset($slide['presenter_notes'], $slide['speaker_notes'], $slide['notes']);
        }
        $reactionCounts = $this->reactionCounts((int)$row['id']);
        $participants = $forStudent ? [] : $this->participantsForSimulation((int)$row['id']);
        return [
            'id' => (int)$row['id'],
            'title' => (string)$row['title'],
            'subject' => (string)($presentation['subject'] ?? ''),
            'year' => (string)($presentation['year'] ?? ''),
            'template' => (string)($presentation['template'] ?? 'lesson'),
            'visual_theme' => (string)($presentation['visual_theme'] ?? 'modern'),
            'active_slide' => $activeSlide,
            'slide_count' => count($slides),
            'slide' => $slide,
            'status' => $ended ? 'ended' : 'active',
            'reveal_mode' => $revealMode,
            'reveal_step' => $revealStep,
            'reveal_total' => $revealTotal,
            'reveal_interval_seconds' => (int)$row['reveal_interval_seconds'],
            'annotations' => $row['annotation_data'] === null ? [] : json_decode((string)$row['annotation_data'], true, 16, JSON_THROW_ON_ERROR),
            'pointer' => $pointer,
            'timer_ends_at' => $row['timer_ends_at'] === null ? null : gmdate('c', strtotime((string)$row['timer_ends_at'] . ' UTC')),
            'timer_duration_seconds' => $row['timer_duration_seconds'] === null ? null : (int)$row['timer_duration_seconds'],
            'active_poll' => $poll,
            'reaction_counts' => $reactionCounts,
            'reaction_responses' => $forStudent ? [] : $this->reactionRespondents((int)$row['id']),
            'own_poll_answers' => $forStudent ? $this->ownPollAnswers((int)$row['id'], $participantHash) : [],
            'participants' => $participants,
            'participant_count' => count($participants),
            'questions' => $forStudent
                ? $this->questionsForParticipant((int)$row['id'], $participantHash)
                : $this->questionsForSimulation((int)$row['id'], true),
            'expires_at' => gmdate('c', strtotime((string)$row['expires_at'] . ' UTC')),
        ];
    }

    private function pollRespondents(int $simulationId, string $pollId): array
    {
        if ($pollId === '') {
            return [];
        }
        $statement = Connection::get()->prepare(
            'SELECT participant_name, answer_index FROM presentation_simulation_interactions
             WHERE simulation_id = :simulation_id AND interaction_type = \'poll\' AND interaction_key = :poll_id
             ORDER BY updated_at'
        );
        $statement->execute(['simulation_id' => $simulationId, 'poll_id' => $pollId]);
        return array_map(static fn(array $row): array => [
            'participant_name' => (string)$row['participant_name'],
            'answer_index' => (int)$row['answer_index'],
        ], $statement->fetchAll(PDO::FETCH_ASSOC));
    }

    private function reactionRespondents(int $simulationId): array
    {
        $statement = Connection::get()->prepare(
            'SELECT participant_name, reaction FROM presentation_simulation_interactions
             WHERE simulation_id = :simulation_id AND interaction_type = \'reaction\' ORDER BY updated_at'
        );
        $statement->execute(['simulation_id' => $simulationId]);
        return array_map(static fn(array $row): array => [
            'participant_name' => (string)$row['participant_name'],
            'reaction' => (string)$row['reaction'],
        ], $statement->fetchAll(PDO::FETCH_ASSOC));
    }

    private function ownPollAnswers(int $simulationId, ?string $participantHash): array
    {
        if ($participantHash === null) {
            return [];
        }
        $statement = Connection::get()->prepare(
            'SELECT interaction_key, answer_index FROM presentation_simulation_interactions
             WHERE simulation_id = :simulation_id AND participant_hash = :participant_hash
             AND interaction_type = \'poll\''
        );
        $statement->execute(['simulation_id' => $simulationId, 'participant_hash' => $participantHash]);
        $answers = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if ($row['answer_index'] !== null) {
                $answers[(string)$row['interaction_key']] = (int)$row['answer_index'];
            }
        }
        return $answers;
    }

    private function questionsForSimulation(int $simulationId, bool $recentOnly = false): array
    {
        $limit = $recentOnly ? ' LIMIT 100' : '';
        $statement = Connection::get()->prepare(
            'SELECT id, participant_name, question, teacher_feedback, created_at, answered_at
             FROM presentation_simulation_questions WHERE simulation_id = :simulation_id ORDER BY created_at DESC' . $limit
        );
        $statement->execute(['simulation_id' => $simulationId]);
        $questions = $this->formatQuestions($statement->fetchAll(PDO::FETCH_ASSOC));
        return array_reverse($questions);
    }

    private function questionsForParticipant(int $simulationId, ?string $participantHash): array
    {
        if ($participantHash === null) {
            return [];
        }
        $statement = Connection::get()->prepare(
            'SELECT id, participant_name, question, teacher_feedback, created_at, answered_at
             FROM presentation_simulation_questions
             WHERE simulation_id = :simulation_id AND participant_hash = :participant_hash
             ORDER BY created_at'
        );
        $statement->execute(['simulation_id' => $simulationId, 'participant_hash' => $participantHash]);
        return $this->formatQuestions($statement->fetchAll(PDO::FETCH_ASSOC));
    }

    private function formatQuestions(array $rows): array
    {
        if ($rows === []) {
            return [];
        }
        $questions = array_map(static fn(array $row): array => [
            'id' => (int)$row['id'],
            'participant_name' => (string)$row['participant_name'],
            'question' => (string)$row['question'],
            'teacher_feedback' => $row['teacher_feedback'] === null ? null : (string)$row['teacher_feedback'],
            'teacher_replies' => [],
            'created_at' => self::isoDate($row['created_at']),
            'answered_at' => $row['answered_at'] === null ? null : self::isoDate($row['answered_at']),
        ], $rows);
        $ids = array_column($questions, 'id');
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $statement = Connection::get()->prepare(
            "SELECT id, question_id, feedback, created_at
             FROM presentation_simulation_question_replies
             WHERE question_id IN ($placeholders)
             ORDER BY question_id, created_at, id"
        );
        $statement->execute($ids);
        $repliesByQuestion = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $reply) {
            $repliesByQuestion[(int)$reply['question_id']][] = [
                'id' => (int)$reply['id'],
                'feedback' => (string)$reply['feedback'],
                'created_at' => self::isoDate($reply['created_at']),
            ];
        }
        foreach ($questions as &$question) {
            $question['teacher_replies'] = $repliesByQuestion[$question['id']] ?? [];
            if ($question['teacher_replies'] === [] && $question['teacher_feedback'] !== null) {
                $question['teacher_replies'][] = [
                    'id' => 0,
                    'feedback' => $question['teacher_feedback'],
                    'created_at' => $question['answered_at'] ?? $question['created_at'],
                ];
            }
            if ($question['teacher_replies'] !== []) {
                $lastReply = $question['teacher_replies'][array_key_last($question['teacher_replies'])];
                $question['teacher_feedback'] = $lastReply['feedback'];
            }
        }
        unset($question);
        return $questions;
    }

    private function participantCount(int $simulationId): int
    {
        $statement = Connection::get()->prepare(
            'SELECT COUNT(DISTINCT participant_hash) FROM (
                SELECT participant_hash FROM presentation_simulation_participants WHERE simulation_id = :participant_session
                UNION
                SELECT participant_hash FROM presentation_simulation_interactions WHERE simulation_id = :interaction_session
                UNION
                SELECT participant_hash FROM presentation_simulation_questions WHERE simulation_id = :question_session
             ) AS participants'
        );
        $statement->execute([
            'participant_session' => $simulationId,
            'interaction_session' => $simulationId,
            'question_session' => $simulationId,
        ]);
        return (int)$statement->fetchColumn();
    }

    private function participantsForSimulation(int $simulationId): array
    {
        $statement = Connection::get()->prepare(
            'SELECT participant_hash, participant_name, joined_at,
                    last_seen_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 60 SECOND) AS online
             FROM presentation_simulation_participants
             WHERE simulation_id = :simulation_id
             ORDER BY joined_at, participant_name'
        );
        $statement->execute(['simulation_id' => $simulationId]);
        return array_map(static fn(array $row): array => [
            'id' => (string)$row['participant_hash'],
            'name' => (string)$row['participant_name'],
            'joined_at' => self::isoDate($row['joined_at']),
            'online' => (bool)$row['online'],
        ], $statement->fetchAll(PDO::FETCH_ASSOC));
    }

    private function participantsForStudent(int $simulationId, ?string $participantHash): array
    {
        $statement = Connection::get()->prepare(
            'SELECT participant_hash, participant_name
             FROM presentation_simulation_participants
             WHERE simulation_id = :simulation_id AND participant_hash <> :participant_hash
               AND last_seen_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 60 SECOND)
             ORDER BY participant_name'
        );
        $statement->execute([
            'simulation_id' => $simulationId,
            'participant_hash' => $participantHash ?? '',
        ]);
        $students = array_map(static fn(array $row): array => [
            'id' => (string)$row['participant_hash'],
            'name' => (string)$row['participant_name'],
            'role' => 'student',
            'online' => true,
        ], $statement->fetchAll(PDO::FETCH_ASSOC));
        array_unshift($students, ['id' => 'teacher', 'name' => 'Teacher', 'role' => 'teacher', 'online' => true]);
        return $students;
    }

    private function directMessagesForParticipant(int $simulationId, string $participantHash): array
    {
        $statement = Connection::get()->prepare(
            'SELECT sender_hash, recipient_hash, sender_name, message, created_at
             FROM presentation_simulation_direct_messages
             WHERE simulation_id = :simulation_id
               AND (sender_hash = :sender_hash OR recipient_hash = :recipient_hash)
             ORDER BY id DESC LIMIT 200'
        );
        $statement->execute([
            'simulation_id' => $simulationId,
            'sender_hash' => $participantHash,
            'recipient_hash' => $participantHash,
        ]);
        $rows = array_reverse($statement->fetchAll(PDO::FETCH_ASSOC));
        return array_map(static function (array $row) use ($participantHash): array {
            $mine = $row['sender_hash'] !== null && hash_equals($participantHash, (string)$row['sender_hash']);
            $peerHash = $mine
                ? ($row['recipient_hash'] === null ? 'teacher' : (string)$row['recipient_hash'])
                : ($row['sender_hash'] === null ? 'teacher' : (string)$row['sender_hash']);
            return [
                'peer_id' => $peerHash,
                'sender_name' => $mine ? 'You' : ($row['sender_hash'] === null ? 'Teacher' : (string)$row['sender_name']),
                'message' => (string)$row['message'],
                'mine' => $mine,
                'created_at' => self::isoDate($row['created_at']),
            ];
        }, $rows);
    }

    private static function validateParticipantName(mixed $value): string
    {
        if (!is_string($value)) {
            throw new RuntimeException('Enter your name using 1 to 80 characters.', 422);
        }
        $name = trim($value);
        if ($name === '' || mb_strlen($name) > 80 || preg_match('/[\x00-\x1F\x7F]/u', $name)) {
            throw new RuntimeException('Enter your name using 1 to 80 characters.', 422);
        }
        return $name;
    }

    private static function isoDate(mixed $value): string
    {
        return gmdate('c', strtotime((string)$value . ' UTC'));
    }

    private function pollResults(int $simulationId, string $pollId): array
    {
        if ($pollId === '') {
            return [];
        }
        $statement = Connection::get()->prepare(
            'SELECT answer_index, COUNT(*) AS votes FROM presentation_simulation_interactions
             WHERE simulation_id = :simulation_id AND interaction_type = \'poll\' AND interaction_key = :poll_id
             GROUP BY answer_index'
        );
        $statement->execute(['simulation_id' => $simulationId, 'poll_id' => $pollId]);
        $results = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if ($row['answer_index'] !== null) {
                $results[(int)$row['answer_index']] = (int)$row['votes'];
            }
        }
        return $results;
    }

    private function reactionCounts(int $simulationId): array
    {
        $statement = Connection::get()->prepare(
            'SELECT reaction, COUNT(*) AS total FROM presentation_simulation_interactions
             WHERE simulation_id = :simulation_id AND interaction_type = \'reaction\'
             GROUP BY reaction'
        );
        $statement->execute(['simulation_id' => $simulationId]);
        $counts = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if ($row['reaction'] !== null) {
                $counts[(string)$row['reaction']] = (int)$row['total'];
            }
        }
        return $counts;
    }

    private static function revealUnitCount(array $slide, string $mode): int
    {
        $points = array_slice(array_filter(
            is_array($slide['key_points'] ?? null) ? $slide['key_points'] : [],
            static fn(mixed $point): bool => is_string($point) && trim($point) !== ''
        ), 0, 12);
        $groupSize = in_array($mode, ['item', 'timed'], true) ? 1 : 2;
        return (int)ceil(count($points) / $groupSize)
            + (int)ceil(self::visualRevealUnitCount($slide['visual'] ?? null) / $groupSize) * (int)!empty($slide['visual'])
            + (int)!empty($slide['image'])
            + (int)!empty($slide['visual_suggestion'])
            + (int)!empty($slide['activity']);
    }

    private static function revealedSlide(array $slide, string $mode, int $step): array
    {
        if ($mode === 'all') {
            return $slide;
        }
        $points = array_slice(array_filter(
            is_array($slide['key_points'] ?? null) ? $slide['key_points'] : [],
            static fn(mixed $point): bool => is_string($point) && trim($point) !== ''
        ), 0, 12);
        $groupSize = in_array($mode, ['item', 'timed'], true) ? 1 : 2;
        $pointGroups = (int)ceil(count($points) / $groupSize);
        $visiblePointCount = min(count($points), $step * $groupSize);
        $slide['key_points'] = array_slice($points, 0, $visiblePointCount);
        $remaining = max(0, $step - $pointGroups);
        foreach (['image', 'visual', 'visual_suggestion', 'activity'] as $field) {
            if (empty($slide[$field])) {
                continue;
            }
            $unitCount = $field === 'visual' ? self::visualRevealUnitCount($slide[$field]) : 1;
            $unitGroups = (int)ceil($unitCount / $groupSize);
            if ($remaining >= $unitGroups) {
                $remaining -= $unitGroups;
                if ($field === 'visual') {
                    $slide[$field] = self::revealedVisual($slide[$field], $unitCount);
                }
            } elseif ($remaining > 0 && $field === 'visual') {
                $slide[$field] = self::revealedVisual($slide[$field], min($unitCount, $remaining * $groupSize));
                $remaining = 0;
            } else {
                unset($slide[$field]);
                $remaining = 0;
            }
        }
        return $slide;
    }

    private static function visualRevealUnitCount(mixed $value): int
    {
        if (!is_array($value)) {
            return 1;
        }
        $type = strtolower((string)($value['type'] ?? ''));
        if ($type === 'table') {
            $rows = array_slice(array_filter(is_array($value['rows'] ?? null) ? $value['rows'] : [], 'is_array'), 0, 3);
            return max(1, count($rows));
        }
        if (in_array($type, ['bar_chart', 'chart'], true)) {
            $labels = array_slice(is_array($value['labels'] ?? null) ? $value['labels'] : [], 0, 6);
            $values = array_slice(is_array($value['values'] ?? null) ? $value['values'] : [], 0, count($labels));
            return count($labels) === count($values)
                && !array_filter($values, static fn(mixed $item): bool => !is_numeric($item) || !is_finite((float)$item))
                ? max(1, count($labels))
                : 1;
        }
        if (in_array($type, ['process', 'timeline', 'cards', 'comparison'], true)) {
            $field = is_array($value['steps'] ?? null) ? 'steps' : 'items';
            $items = array_slice(is_array($value[$field] ?? null) ? $value[$field] : [], 0, 5);
            $items = array_filter($items, static function (mixed $item): bool {
                if (is_string($item)) {
                    return trim($item) !== '';
                }
                if (!is_array($item)) {
                    return false;
                }
                foreach (['label', 'title', 'details'] as $key) {
                    if (is_string($item[$key] ?? null) && trim($item[$key]) !== '') {
                        return true;
                    }
                }
                return false;
            });
            return max(1, count($items));
        }
        if ($type === 'graph') {
            $points = array_slice(is_array($value['points'] ?? null) ? $value['points'] : [], 0, 12);
            $points = array_filter($points, static fn(mixed $point): bool => is_array($point)
                && count($point) === 2
                && is_numeric($point[0]) && is_finite((float)$point[0])
                && is_numeric($point[1]) && is_finite((float)$point[1]));
            return max(1, count($points));
        }
        if ($type === 'line_chart') {
            $counts = [];
            foreach (array_slice(is_array($value['series'] ?? null) ? $value['series'] : [], 0, 4) as $series) {
                if (!is_array($series) || !is_array($series['values'] ?? null)) {
                    continue;
                }
                $values = array_slice($series['values'], 0, 12);
                $values = array_filter($values, static fn(mixed $item): bool => is_numeric($item) && is_finite((float)$item));
                $counts[] = count($values);
            }
            return max(1, ...$counts);
        }
        return 1;
    }

    private static function revealedVisual(mixed $value, int $visibleCount): mixed
    {
        if (!is_array($value)) {
            return $value;
        }
        $type = strtolower((string)($value['type'] ?? ''));
        if ($type === 'table') {
            $rows = array_slice(array_filter(is_array($value['rows'] ?? null) ? $value['rows'] : [], 'is_array'), 0, 3);
            $value['rows'] = array_slice($rows, 0, $visibleCount);
        } elseif (in_array($type, ['bar_chart', 'chart'], true)) {
            $labels = array_slice(is_array($value['labels'] ?? null) ? $value['labels'] : [], 0, 6);
            $values = array_slice(is_array($value['values'] ?? null) ? $value['values'] : [], 0, count($labels));
            $value['labels'] = array_slice($labels, 0, $visibleCount);
            $value['values'] = array_slice($values, 0, $visibleCount);
        } elseif (in_array($type, ['process', 'timeline', 'cards', 'comparison'], true)) {
            $field = is_array($value['steps'] ?? null) ? 'steps' : 'items';
            $items = array_slice(is_array($value[$field] ?? null) ? $value[$field] : [], 0, 5);
            $items = array_values(array_filter($items, static function (mixed $item): bool {
                if (is_string($item)) {
                    return trim($item) !== '';
                }
                if (!is_array($item)) {
                    return false;
                }
                foreach (['label', 'title', 'details'] as $key) {
                    if (is_string($item[$key] ?? null) && trim($item[$key]) !== '') {
                        return true;
                    }
                }
                return false;
            }));
            $value[$field] = array_slice($items, 0, $visibleCount);
        } elseif ($type === 'graph') {
            $points = array_slice(is_array($value['points'] ?? null) ? $value['points'] : [], 0, 12);
            $points = array_values(array_filter($points, static fn(mixed $point): bool => is_array($point)
                && count($point) === 2
                && is_numeric($point[0]) && is_finite((float)$point[0])
                && is_numeric($point[1]) && is_finite((float)$point[1])));
            $value['points'] = array_slice($points, 0, $visibleCount);
        } elseif ($type === 'line_chart' && is_array($value['series'] ?? null)) {
            $value['series'] = array_map(static function (mixed $series) use ($visibleCount): mixed {
                if (is_array($series) && is_array($series['values'] ?? null)) {
                    $values = array_filter(array_slice($series['values'], 0, 12), static fn(mixed $item): bool => is_numeric($item) && is_finite((float)$item));
                    $series['values'] = array_slice(array_values($values), 0, min(12, $visibleCount));
                }
                return $series;
            }, array_slice($value['series'], 0, 4));
        }
        return $value;
    }

    private static function validateAnnotations(mixed $value): array
    {
        if (!is_array($value) || count($value) > 25) {
            throw new RuntimeException('The annotation update is invalid.', 422);
        }
        $strokes = [];
        foreach ($value as $stroke) {
            if (!is_array($stroke) || !in_array($stroke['tool'] ?? '', ['pen', 'highlighter'], true)
                || !in_array($stroke['color'] ?? '', self::COLORS, true)
                || !is_array($stroke['points'] ?? null) || count($stroke['points']) < 2 || count($stroke['points']) > 100) {
                throw new RuntimeException('One or more presentation strokes are invalid.', 422);
            }
            $points = [];
            foreach ($stroke['points'] as $point) {
                if (!is_array($point) || count($point) !== 2
                    || !is_numeric($point[0]) || !is_numeric($point[1])
                    || (float)$point[0] < 0 || (float)$point[0] > 1
                    || (float)$point[1] < 0 || (float)$point[1] > 1) {
                    throw new RuntimeException('One or more presentation points are invalid.', 422);
                }
                $points[] = [(float)$point[0], (float)$point[1]];
            }
            $strokes[] = [
                'tool' => $stroke['tool'],
                'color' => $stroke['color'],
                'points' => $points,
            ];
        }
        if (strlen(json_encode($strokes, JSON_THROW_ON_ERROR)) > 30000) {
            throw new RuntimeException('This drawing is too large to share. Clear some marks and try again.', 413);
        }
        return $strokes;
    }

    private static function validatePointer(mixed $value): ?array
    {
        if ($value === null) {
            return null;
        }
        if (!is_array($value) || !is_numeric($value['x'] ?? null) || !is_numeric($value['y'] ?? null)
            || (float)$value['x'] < 0 || (float)$value['x'] > 1
            || (float)$value['y'] < 0 || (float)$value['y'] > 1
            || !in_array($value['color'] ?? '', self::COLORS, true)) {
            throw new RuntimeException('The presentation pointer position is invalid.', 422);
        }
        return [
            'x' => (float)$value['x'],
            'y' => (float)$value['y'],
            'color' => $value['color'],
            'active' => (bool)($value['active'] ?? true),
            'updated_at' => time(),
        ];
    }

    private static function validatePoll(mixed $value): ?array
    {
        if ($value === null) {
            return null;
        }
        if (!is_array($value) || !preg_match('/^[a-f0-9-]{8,64}$/iD', (string)($value['id'] ?? ''))
            || !is_string($value['question'] ?? null) || trim($value['question']) === ''
            || mb_strlen($value['question']) > 240 || !is_array($value['options'] ?? null)
            || count($value['options']) < 2 || count($value['options']) > 6) {
            throw new RuntimeException('The classroom poll needs a question and two to six choices.', 422);
        }
        $options = [];
        foreach ($value['options'] as $option) {
            if (!is_string($option) || trim($option) === '' || mb_strlen($option) > 120) {
                throw new RuntimeException('Poll choices must contain 1 to 120 characters.', 422);
            }
            $options[] = trim($option);
        }
        return [
            'id' => strtolower((string)$value['id']),
            'question' => trim($value['question']),
            'options' => $options,
            'open' => (bool)($value['open'] ?? true),
        ];
    }

    private static function encodeNullable(?array $value): ?string
    {
        return $value === null ? null : json_encode($value, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }
}
