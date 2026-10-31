<?php
declare(strict_types=1);

namespace Akademi\Services;

use Akademi\Database\Connection;
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
    private const MAX_PRESENTATION_BYTES = 500000;

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
             (user_id, share_token_hash, title, presentation_data, reveal_mode, reveal_interval_seconds, expires_at)
             VALUES (:user_id, :token_hash, :title, :presentation_data, :reveal_mode, :reveal_interval, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 12 HOUR))'
        );
        $statement->execute([
            'user_id' => $userId,
            'token_hash' => hash('sha256', $token, true),
            'title' => $title,
            'presentation_data' => $encodedPresentation,
            'reveal_mode' => $revealMode,
            'reveal_interval' => $revealInterval,
        ]);
        $id = (int)Connection::get()->lastInsertId();
        return [
            'id' => $id,
            'url' => app_url('presentation/follow?token=' . rawurlencode($token)),
            'expires_at' => gmdate('c', time() + 12 * 60 * 60),
        ];
    }

    public function update(int $userId, int $simulationId, array $input): array
    {
        $pdo = Connection::get();
        $select = $pdo->prepare(
            'SELECT presentation_data, active_slide, status, reveal_mode, reveal_step
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
        if (array_key_exists('active_poll', $input)) {
            $poll = self::validatePoll($input['active_poll']);
            $assignments[] = 'active_poll = :active_poll';
            $parameters['active_poll'] = self::encodeNullable($poll);
        }

        if ($assignments !== []) {
            $sql = 'UPDATE presentation_simulations SET ' . implode(', ', $assignments)
                . ' WHERE id = :id AND user_id = :user_id AND status = \'active\' AND expires_at > UTC_TIMESTAMP()';
            $update = $pdo->prepare($sql);
            $update->execute($parameters);
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
                    reveal_interval_seconds, annotation_data, pointer_data, timer_ends_at,
                    timer_duration_seconds, active_poll, expires_at
             FROM presentation_simulations
             WHERE id = :id AND user_id = :user_id LIMIT 1'
        );
        $statement->execute(['id' => $simulationId, 'user_id' => $userId]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            throw new RuntimeException('The live presentation was not found.', 404);
        }
        return $this->stateFromRow($row, false);
    }

    public function read(string $token): array
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
        return $this->stateFromRow($row, true);
    }

    public function interact(string $token, array $input): array
    {
        $participantId = strtolower(trim((string)($input['participant_id'] ?? '')));
        if (!preg_match('/^[a-f0-9-]{36}$/D', $participantId)) {
            throw new RuntimeException('Refresh the student presentation and try again.', 422);
        }
        $lookup = Connection::get()->prepare(
            'SELECT id, status, active_poll, expires_at FROM presentation_simulations
             WHERE share_token_hash = :token_hash LIMIT 1'
        );
        $lookup->execute(['token_hash' => hash('sha256', $token, true)]);
        $simulation = $lookup->fetch(PDO::FETCH_ASSOC);
        if (!$simulation || $simulation['status'] !== 'active'
            || strtotime((string)$simulation['expires_at'] . ' UTC') <= time()) {
            throw new RuntimeException('This live presentation is no longer available.', 404);
        }

        $simulationId = (int)$simulation['id'];
        $participantHash = hash('sha256', $participantId);
        $type = (string)($input['type'] ?? '');
        $pdo = Connection::get();
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
                 (simulation_id, participant_hash, interaction_type, interaction_key, answer_index)
                 VALUES (:simulation_id, :participant_hash, \'poll\', :interaction_key, :answer_index)
                 ON DUPLICATE KEY UPDATE answer_index = VALUES(answer_index), updated_at = UTC_TIMESTAMP()'
            );
            $save->execute([
                'simulation_id' => $simulationId,
                'participant_hash' => $participantHash,
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
                 (simulation_id, participant_hash, interaction_type, interaction_key, reaction)
                 VALUES (:simulation_id, :participant_hash, \'reaction\', \'reaction\', :reaction)
                 ON DUPLICATE KEY UPDATE reaction = VALUES(reaction), updated_at = UTC_TIMESTAMP()'
            );
            $save->execute([
                'simulation_id' => $simulationId,
                'participant_hash' => $participantHash,
                'reaction' => $reaction,
            ]);
        } else {
            throw new RuntimeException('Choose a supported presentation interaction.', 422);
        }

        return $this->read($token);
    }

    private function stateFromRow(array $row, bool $forStudent): array
    {
        $presentation = json_decode((string)$row['presentation_data'], true, 32, JSON_THROW_ON_ERROR);
        $slides = $presentation['slides'] ?? [];
        $activeSlide = (int)$row['active_slide'];
        $ended = $row['status'] !== 'active' || strtotime((string)$row['expires_at'] . ' UTC') <= time();
        $poll = $row['active_poll'] === null ? null : json_decode((string)$row['active_poll'], true, 8, JSON_THROW_ON_ERROR);
        if (is_array($poll)) {
            $poll['results'] = $this->pollResults((int)$row['id'], (string)($poll['id'] ?? ''));
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
            'expires_at' => gmdate('c', strtotime((string)$row['expires_at'] . ' UTC')),
        ];
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
            + (int)!empty($slide['visual'])
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
        foreach (['visual', 'visual_suggestion', 'activity'] as $field) {
            if (empty($slide[$field])) {
                continue;
            }
            if ($remaining > 0) {
                $remaining--;
            } else {
                unset($slide[$field]);
            }
        }
        return $slide;
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
