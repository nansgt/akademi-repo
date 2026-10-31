<?php
declare(strict_types=1);

namespace Akademi\Services;

use Akademi\Database\Connection;
use PDO;
use RuntimeException;

final class CurriculumStructureService
{
    private const BATCH_SIZE = 10;
    private const SECTION_TYPES = [
        'subject',
        'strand',
        'sub_strand',
        'focal_area',
        'content_standard',
        'learning_outcome',
        'learning_indicator',
        'learning_objective',
        'topic',
        'section',
    ];

    public function extractBatch(int $documentId, int $offset, int $actorUserId): array
    {
        if ($documentId < 1 || $offset < 0) {
            throw new RuntimeException('Document and batch offset must be positive numbers.', 422);
        }
        $pdo = Connection::get();
        $document = $pdo->prepare(
            'SELECT id, extraction_status FROM curriculum_documents WHERE id = :id LIMIT 1'
        );
        $document->execute(['id' => $documentId]);
        $documentRow = $document->fetch();
        if (!$documentRow) {
            throw new RuntimeException('Curriculum document was not found.', 404);
        }
        if ($documentRow['extraction_status'] !== 'extracted') {
            throw new RuntimeException('Only text-extracted curriculum documents can be processed.', 422);
        }

        $chunkQuery = $pdo->prepare(
            'SELECT id, chunk_index, page_start, content
             FROM curriculum_chunks WHERE document_id = :document_id AND chunk_index >= :offset
             ORDER BY chunk_index LIMIT ' . self::BATCH_SIZE
        );
        $chunkQuery->bindValue(':document_id', $documentId, PDO::PARAM_INT);
        $chunkQuery->bindValue(':offset', $offset, PDO::PARAM_INT);
        $chunkQuery->execute();
        $chunks = $chunkQuery->fetchAll();
        if ($chunks === []) {
            return ['document_id' => $documentId, 'next_offset' => null, 'created' => 0, 'existing' => 0, 'sections' => []];
        }

        $contextChunks = [];
        if ($offset > 0) {
            $contextQuery = $pdo->prepare(
                'SELECT id, chunk_index, page_start, content
                 FROM curriculum_chunks
                 WHERE document_id = :document_id AND chunk_index < :offset
                 ORDER BY chunk_index DESC LIMIT 2'
            );
            $contextQuery->bindValue(':document_id', $documentId, PDO::PARAM_INT);
            $contextQuery->bindValue(':offset', $offset, PDO::PARAM_INT);
            $contextQuery->execute();
            $contextChunks = array_reverse($contextQuery->fetchAll());
        }
        $processingChunks = [...$contextChunks, ...$chunks];
        $chunkMap = [];
        foreach ($processingChunks as $chunk) {
            $chunkMap[(int)$chunk['id']] = $chunk;
        }
        $previousWeekQuery = $pdo->prepare(
            "SELECT lesson.source_chunk_id, lesson.semester_number, lesson.week_number,
                    lesson.topic, lesson.focal_areas, lesson.learning_indicators,
                    lesson.learning_outcomes, lesson.assessment_mode,
                    source_chunk.content AS source_chunk_content
             FROM curriculum_weekly_lessons lesson
             JOIN curriculum_chunks source_chunk ON source_chunk.id = lesson.source_chunk_id
             WHERE lesson.document_id = :document_id AND source_chunk.chunk_index < :offset
               AND lesson.ai_generated = 0
             ORDER BY source_chunk.chunk_index DESC, lesson.id DESC LIMIT 1"
        );
        $previousWeekQuery->bindValue(':document_id', $documentId, PDO::PARAM_INT);
        $previousWeekQuery->bindValue(':offset', $offset, PDO::PARAM_INT);
        $previousWeekQuery->execute();
        $previousWeekContext = $previousWeekQuery->fetch() ?: null;
        $extracted = $this->extractSourceStructure($processingChunks, $previousWeekContext);
        $created = [];
        $existingCount = 0;
        $createdWeekly = [];
        $existingWeekly = 0;

        $pdo->beginTransaction();
        try {
            foreach ($extracted['sections'] as $candidate) {
                $duplicate = $pdo->prepare(
                    'SELECT id FROM curriculum_sections
                     WHERE document_id = :document_id AND source_chunk_id = :chunk_id
                       AND section_type = :section_type AND title = :title LIMIT 1'
                );
                $duplicate->execute([
                    'document_id' => $documentId,
                    'chunk_id' => $candidate['chunk_id'],
                    'section_type' => $candidate['type'],
                    'title' => $candidate['title'],
                ]);
                if ($duplicate->fetchColumn()) {
                    $existingCount++;
                    continue;
                }
                $parentId = null;
                if ($candidate['parent_title'] !== '') {
                    $parent = $pdo->prepare(
                        'SELECT id FROM curriculum_sections
                         WHERE document_id = :document_id AND title = :title
                         ORDER BY id LIMIT 1'
                    );
                    $parent->execute([
                        'document_id' => $documentId,
                        'title' => $candidate['parent_title'],
                    ]);
                    $parentValue = $parent->fetchColumn();
                    $parentId = $parentValue === false ? null : (int)$parentValue;
                }
                $sourceChunk = $chunkMap[$candidate['chunk_id']];
                $pdo->prepare(
                    'INSERT INTO curriculum_sections
                     (document_id, parent_id, section_type, source_chunk_id, ai_generated,
                      model_used, code, title, body, page_number, review_status)
                     VALUES (:document_id, :parent_id, :section_type, :source_chunk_id, 0,
                             NULL, :code, :title, :body, :page_number, \'unreviewed\')'
                )->execute([
                    'document_id' => $documentId,
                    'parent_id' => $parentId,
                    'section_type' => $candidate['type'],
                    'source_chunk_id' => $candidate['chunk_id'],
                    'code' => $candidate['code'] !== '' ? $candidate['code'] : null,
                    'title' => $candidate['title'],
                    'body' => $candidate['details'] !== '' ? $candidate['details'] : null,
                    'page_number' => $sourceChunk['page_start'],
                ]);
                $created[] = [
                    'id' => (int)$pdo->lastInsertId(),
                    'type' => $candidate['type'],
                    'title' => $candidate['title'],
                    'page' => $sourceChunk['page_start'],
                ];
            }

            foreach ($extracted['weekly_lessons'] as $candidate) {
                $duplicate = $pdo->prepare(
                    'SELECT id, topic, focal_areas, learning_indicators, learning_outcomes,
                            assessment_mode, review_status, ai_generated
                     FROM curriculum_weekly_lessons
                     WHERE document_id = :document_id AND source_chunk_id = :chunk_id
                       AND semester_number <=> :semester_number AND week_number = :week_number
                     ORDER BY id LIMIT 1'
                );
                $duplicate->execute([
                    'document_id' => $documentId,
                    'chunk_id' => $candidate['chunk_id'],
                    'semester_number' => $candidate['semester'],
                    'week_number' => $candidate['week'],
                ]);
                $existingLesson = $duplicate->fetch();
                if ($existingLesson) {
                    if (!(bool)$existingLesson['ai_generated']) {
                        $existingFocalAreas = json_decode((string)$existingLesson['focal_areas'], true, 16, JSON_THROW_ON_ERROR);
                        if (!is_array($existingFocalAreas) || array_filter($existingFocalAreas, 'is_string') !== $existingFocalAreas) {
                            throw new RuntimeException('A stored weekly lesson contains invalid focal-area data.', 500);
                        }
                        $existingIndicators = $this->decodeLearningTargets($existingLesson['learning_indicators'] ?? null);
                        $existingOutcomes = $this->decodeLearningTargets($existingLesson['learning_outcomes'] ?? null);
                        $learningIndicators = array_values(array_unique([...$existingIndicators, ...$candidate['learning_indicators']]));
                        $learningOutcomes = array_values(array_unique([...$existingOutcomes, ...$candidate['learning_outcomes']]));
                        $isUnreviewed = $existingLesson['review_status'] === 'unreviewed';
                        $focalAreas = $isUnreviewed
                            ? array_values(array_unique([...$existingFocalAreas, ...$candidate['focal_areas']]))
                            : ($existingFocalAreas === [] ? $candidate['focal_areas'] : $existingFocalAreas);
                        $topic = $isUnreviewed && $this->isBetterTopic($candidate['topic'], (string)$existingLesson['topic'])
                            ? $candidate['topic']
                            : (string)$existingLesson['topic'];
                        $assessmentMode = $isUnreviewed
                            ? ($candidate['assessment_mode'] ?? $existingLesson['assessment_mode'])
                            : $existingLesson['assessment_mode'];
                        if ($topic !== $existingLesson['topic']
                            || $focalAreas !== $existingFocalAreas
                            || $learningIndicators !== $existingIndicators
                            || $learningOutcomes !== $existingOutcomes
                            || $assessmentMode !== $existingLesson['assessment_mode']) {
                            $pdo->prepare(
                                'UPDATE curriculum_weekly_lessons
                                 SET topic = :topic, focal_areas = :focal_areas,
                                     learning_indicators = :learning_indicators,
                                     learning_outcomes = :learning_outcomes,
                                     assessment_mode = :assessment_mode
                                 WHERE id = :id'
                            )->execute([
                                'topic' => $topic,
                                'focal_areas' => json_encode($focalAreas, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                                'learning_indicators' => json_encode($learningIndicators, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                                'learning_outcomes' => json_encode($learningOutcomes, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                                'assessment_mode' => $assessmentMode,
                                'id' => (int)$existingLesson['id'],
                            ]);
                        }
                    }
                    $existingWeekly++;
                    continue;
                }
                $sourceChunk = $chunkMap[$candidate['chunk_id']];
                $pdo->prepare(
                    'INSERT INTO curriculum_weekly_lessons
                     (document_id, source_chunk_id, semester_number, week_number, topic, focal_areas,
                      learning_indicators, learning_outcomes,
                      assessment_mode, source_page, ai_generated, model_used, review_status)
                     VALUES (:document_id, :source_chunk_id, :semester_number, :week_number, :topic, :focal_areas,
                             :learning_indicators, :learning_outcomes,
                             :assessment_mode, :source_page, 0, NULL, \'unreviewed\')'
                )->execute([
                    'document_id' => $documentId,
                    'source_chunk_id' => $candidate['chunk_id'],
                    'semester_number' => $candidate['semester'],
                    'week_number' => $candidate['week'],
                    'topic' => $candidate['topic'],
                    'focal_areas' => json_encode($candidate['focal_areas'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                    'learning_indicators' => json_encode($candidate['learning_indicators'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                    'learning_outcomes' => json_encode($candidate['learning_outcomes'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                    'assessment_mode' => $candidate['assessment_mode'],
                    'source_page' => $sourceChunk['page_start'],
                ]);
                $createdWeekly[] = [
                    'id' => (int)$pdo->lastInsertId(),
                    'semester' => $candidate['semester'],
                    'week' => $candidate['week'],
                    'topic' => $candidate['topic'],
                    'page' => $sourceChunk['page_start'],
                ];
            }

            $this->registerWeeklyLearningTargets($pdo, $documentId);

            if ($extracted['assessment_schedules'] !== []) {
                $lessonRows = $pdo->prepare(
                    "SELECT id, topic, assessment_mode
                     FROM curriculum_weekly_lessons
                     WHERE document_id = :document_id AND ai_generated = 0 AND review_status = 'unreviewed'"
                );
                $lessonRows->execute(['document_id' => $documentId]);
                $weeklyRows = $lessonRows->fetchAll();
                $updateAssessment = $pdo->prepare(
                    "UPDATE curriculum_weekly_lessons
                     SET assessment_mode = :assessment_mode
                     WHERE id = :id AND review_status = 'unreviewed'"
                );
                foreach ($weeklyRows as $weeklyRow) {
                    if (trim((string)$weeklyRow['assessment_mode']) !== '') {
                        continue;
                    }
                    $bestSchedule = null;
                    $bestScore = 0.0;
                    foreach ($extracted['assessment_schedules'] as $schedule) {
                        $score = $this->assessmentTopicMatchScore(
                            (string)$weeklyRow['topic'],
                            (string)$schedule['indicator']
                        );
                        if ($score > $bestScore) {
                            $bestScore = $score;
                            $bestSchedule = $schedule;
                        }
                    }
                    if ($bestSchedule !== null && $bestScore >= 0.75) {
                        $updateAssessment->execute([
                            'assessment_mode' => mb_substr($bestSchedule['assessment_mode'], 0, 500, 'UTF-8'),
                            'id' => (int)$weeklyRow['id'],
                        ]);
                    }
                }
            }

            $pdo->prepare(
                "INSERT INTO audit_logs (actor_user_id, action_name, target_type, target_id, metadata)
                 VALUES (:actor, 'curriculum.structure_extracted', 'curriculum_document', :target_id, :metadata)"
            )->execute([
                'actor' => $actorUserId,
                'target_id' => (string)$documentId,
                'metadata' => json_encode([
                    'offset' => $offset,
                    'chunks' => count($chunks),
                    'created' => count($created),
                    'existing' => $existingCount,
                    'weekly_created' => count($createdWeekly),
                    'weekly_existing' => $existingWeekly,
                    'extractor' => 'deterministic-rules-v1',
                ], JSON_THROW_ON_ERROR),
            ]);
            $pdo->commit();
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }

        $nextOffset = $offset + self::BATCH_SIZE;
        $nextChunk = $pdo->prepare(
            'SELECT 1 FROM curriculum_chunks WHERE document_id = :document_id AND chunk_index >= :offset LIMIT 1'
        );
        $nextChunk->bindValue(':document_id', $documentId, PDO::PARAM_INT);
        $nextChunk->bindValue(':offset', $nextOffset, PDO::PARAM_INT);
        $nextChunk->execute();
        return [
            'document_id' => $documentId,
            'next_offset' => $nextChunk->fetchColumn() ? $nextOffset : null,
            'created' => count($created),
            'existing' => $existingCount,
            'sections' => $created,
            'weekly_lessons_created' => count($createdWeekly),
            'weekly_lessons_existing' => $existingWeekly,
            'weekly_lessons' => $createdWeekly,
        ];
    }

    private function extractSourceStructure(array $chunks, ?array $previousWeekContext = null): array
    {
        $sections = [];
        $lessons = [];
        $assessmentSchedules = $this->assessmentSchedulesFromContent(implode(
            "\n",
            array_map(static fn(array $chunk): string => (string)$chunk['content'], $chunks)
        ));
        $semester = $previousWeekContext && $previousWeekContext['semester_number'] !== null
            ? (int)$previousWeekContext['semester_number']
            : null;
        $week = $previousWeekContext ? (int)$previousWeekContext['week_number'] : null;
        $activeWeekNumbers = $week === null ? [] : [$week];
        $weekChunkId = $previousWeekContext ? (int)$previousWeekContext['source_chunk_id'] : null;
        $activeSectionNumber = null;
        $activeLearningType = null;
        $activeContentType = null;
        $activeContentCode = '';
        $expectingWeekTopic = false;
        $parents = [];
        if ($previousWeekContext) {
            if (preg_match('/\bsect(?:ion|in)\s+(\d+)\s*:/i', (string)$previousWeekContext['source_chunk_content'], $sectionMatch)) {
                $activeSectionNumber = (int)$sectionMatch[1];
            }
            $focalAreas = json_decode((string)$previousWeekContext['focal_areas'], true, 16, JSON_THROW_ON_ERROR);
            if (!is_array($focalAreas) || array_filter($focalAreas, 'is_string') !== $focalAreas) {
                throw new RuntimeException('A stored weekly lesson contains invalid focal-area data.', 500);
            }
            $lessonKey = $this->lessonKey($weekChunkId, $semester, $week);
            $lessons[$lessonKey] = [
                'chunk_id' => $weekChunkId,
                'semester' => $semester,
                'week' => $week,
                'topic' => (string)$previousWeekContext['topic'],
                'focal_areas' => $focalAreas,
                'learning_indicators' => $this->decodeLearningTargets($previousWeekContext['learning_indicators'] ?? null),
                'learning_outcomes' => $this->decodeLearningTargets($previousWeekContext['learning_outcomes'] ?? null),
                'assessment_mode' => $previousWeekContext['assessment_mode'],
            ];
        }
        foreach ($chunks as $chunk) {
            $chunkId = (int)$chunk['id'];
            $inAssessmentSummary = false;
            $tableHeaders = [];
            $lines = preg_split('/\R/u', (string)$chunk['content']) ?: [];
            for ($lineIndex = 0; $lineIndex < count($lines); $lineIndex++) {
                $line = trim($lines[$lineIndex]);
                if ($line === '' || preg_match('/^\|?[\s:|-]+\|?$/u', $line)) {
                    continue;
                }
                if (preg_match('/^learning[\s-]*(?:target|indicator|outcome|objective)s?\s*[:.)-]\s*.+$/iu', $line)) {
                    for ($continuation = 0; $continuation < 2 && isset($lines[$lineIndex + 1]); $continuation++) {
                        $nextLine = trim((string)$lines[$lineIndex + 1]);
                        if ($nextLine === '' || $this->isStructureBoundary($nextLine)) {
                            break;
                        }
                        $line .= ' ' . $nextLine;
                        $lineIndex++;
                    }
                }
                if ($activeLearningType !== null && preg_match('/^\s*(?:[-*•]|\d+[.)])\s+/u', $line)) {
                    for ($continuation = 0; $continuation < 2 && isset($lines[$lineIndex + 1]); $continuation++) {
                        $nextLine = trim((string)$lines[$lineIndex + 1]);
                        if ($nextLine === '' || $this->isStructureBoundary($nextLine)) {
                            break;
                        }
                        $line .= ' ' . $nextLine;
                        $lineIndex++;
                    }
                }
                $line = preg_replace('/^\s{0,3}#{1,6}\s*/u', '', $line) ?? $line;
                $startsBullet = preg_match('/^\s*(?:[-*•]\s+|\d+[.)]\s+)/u', $line) === 1;
                $line = preg_replace('/^\s*(?:[-*•]\s+|\d+[.)]\s+|[a-z][.)]\s+)/iu', '', $line) ?? $line;
                if (preg_match('/^assessment summary\b/i', $line)) {
                    $inAssessmentSummary = true;
                    $week = null;
                    $activeWeekNumbers = [];
                    $weekChunkId = null;
                    $activeLearningType = null;
                    $activeContentType = null;
                    $activeContentCode = '';
                    $expectingWeekTopic = false;
                } elseif (preg_match('/^sect(?:ion|in)\s+(\d+)\s*:/i', $line, $sectionMatch)) {
                    $sectionNumber = (int)$sectionMatch[1];
                    if (($activeSectionNumber === null && $week !== null)
                        || ($activeSectionNumber !== null && $activeSectionNumber !== $sectionNumber)) {
                        $week = null;
                        $activeWeekNumbers = [];
                        $weekChunkId = null;
                        $activeLearningType = null;
                        $activeContentType = null;
                        $activeContentCode = '';
                        $expectingWeekTopic = false;
                    }
                    $activeSectionNumber = $sectionNumber;
                } elseif (preg_match('/^(?:summary of pedagogical|introduction and section summary)\b/i', $line)) {
                    $week = null;
                    $activeWeekNumbers = [];
                    $weekChunkId = null;
                    $activeLearningType = null;
                    $activeContentType = null;
                    $activeContentCode = '';
                    $expectingWeekTopic = false;
                }

                $learningHeading = $this->parseLearningHeading($line);
                if ($learningHeading !== null) {
                    $activeLearningType = $learningHeading;
                    $activeContentType = null;
                    $activeContentCode = '';
                    continue;
                }
                $contentHeading = $this->parseContentHeading($line);
                if ($contentHeading !== null) {
                    [$activeContentType, $activeContentCode] = $contentHeading;
                    $activeLearningType = null;
                    continue;
                }
                if (str_contains($line, '|')) {
                    $cells = array_map(
                        static fn(string $cell): string => trim($cell, " \t\n\r\0\x0B|"),
                        explode('|', $line)
                    );
                    if ($this->isTableHeader($cells)) {
                        $tableHeaders = $cells;
                        continue;
                    }
                    if ($tableHeaders !== []) {
                        foreach ($this->sectionsFromTableRow($chunkId, $tableHeaders, $cells) as $candidate) {
                            $sectionKey = $chunkId . ':' . $candidate['type'] . ':' . mb_strtolower($candidate['title'], 'UTF-8');
                            $sections[$sectionKey] = $candidate;
                        }
                        foreach ($this->lessonsFromTableRow($chunkId, $tableHeaders, $cells, $semester) as $lesson) {
                            $key = $this->lessonKey($chunkId, $lesson['semester'], $lesson['week']);
                            $lessons[$key] = $this->mergeLesson($lessons[$key] ?? null, $lesson);
                            $week = $lesson['week'];
                            $activeWeekNumbers = [$week];
                            $weekChunkId = $chunkId;
                            $activeLearningType = null;
                            $expectingWeekTopic = false;
                            continue;
                        }
                    }
                    $line = implode(' ', array_filter($cells, static fn(string $cell): bool => $cell !== ' ' && $cell !== ''));
                }

                if (preg_match('/^semester\s*([12])\b/i', $line, $semesterMatch)) {
                    $semester = (int)$semesterMatch[1];
                    $week = null;
                    $activeWeekNumbers = [];
                    $weekChunkId = null;
                    $expectingWeekTopic = false;
                }
                if (preg_match(
                    '/^weeks?\s*[:.]?\s*(?:no\.?\s*)?((?:5[0-2]|[1-4][0-9]|[1-9])'
                    . '(?:(?:\s*,\s*|\s*(?:and|&)\s*|\s*(?:-|\x{2013}|\x{2014}|to)\s*)'
                    . '(?:weeks?\s*)?(?:5[0-2]|[1-4][0-9]|[1-9]))*)\b/iu',
                    $line,
                    $weekMatch
                )) {
                    preg_match_all(
                        '/(5[0-2]|[1-4][0-9]|[1-9])'
                        . '(?:\s*(?:-|\x{2013}|\x{2014}|to)\s*(?:weeks?\s*)?(5[0-2]|[1-4][0-9]|[1-9]))?/iu',
                        $weekMatch[1],
                        $weekNumbers,
                        PREG_SET_ORDER
                    );
                    $activeWeekNumbers = [];
                    foreach ($weekNumbers as $weekNumberMatch) {
                        $firstWeek = (int)$weekNumberMatch[1];
                        $lastWeek = isset($weekNumberMatch[2]) && $weekNumberMatch[2] !== ''
                            ? (int)$weekNumberMatch[2]
                            : $firstWeek;
                        if ($lastWeek >= $firstWeek) {
                            array_push($activeWeekNumbers, ...range($firstWeek, $lastWeek));
                        }
                    }
                    $activeWeekNumbers = array_values(array_unique($activeWeekNumbers));
                    if ($activeWeekNumbers === []) {
                        continue;
                    }
                    $firstWeek = $activeWeekNumbers[0];
                    $week = $firstWeek;
                    $weekChunkId = $chunkId;
                    $expectingWeekTopic = true;
                    $activeLearningType = null;
                    $activeContentType = null;
                    $activeContentCode = '';
                    $inAssessmentSummary = false;
                    foreach ($activeWeekNumbers as $weekNumber) {
                        $key = $this->lessonKey($weekChunkId, $semester, $weekNumber);
                        $lessons[$key] ??= [
                            'chunk_id' => $chunkId,
                            'semester' => $semester,
                            'week' => $weekNumber,
                            'topic' => '',
                            'focal_areas' => [],
                            'learning_indicators' => [],
                            'learning_outcomes' => [],
                            'assessment_mode' => null,
                        ];
                    }
                    $line = trim(substr($line, strlen($weekMatch[0])), " \t:.-");
                }

                if (preg_match('/^sect(?:ion|in)\s+(\d+)\s*:\s*(.*)$/iu', $line, $sectionTitleMatch)) {
                    $sectionNumber = (int)$sectionTitleMatch[1];
                    $sectionTitle = trim($sectionTitleMatch[2]);
                    if ($sectionTitle === '' && isset($lines[$lineIndex + 1])) {
                        $nextLine = trim(preg_replace('/^\s{0,3}#{1,6}\s*/u', '', (string)$lines[$lineIndex + 1]) ?? '');
                        if ($nextLine !== '' && !$this->isStructureBoundary($nextLine)) {
                            $sectionTitle = $nextLine;
                            $lineIndex++;
                        }
                    }
                    $labelled = $sectionTitle === ''
                        ? null
                        : ['section', 'SECTION ' . $sectionNumber . ': ' . $sectionTitle];
                } else {
                    $labelled = $this->parseLabelledLine($line);
                }
                if ($labelled === null) {
                    if ($activeLearningType !== null && $startsBullet && mb_strlen($line, 'UTF-8') <= 500
                        && preg_match('/[\p{L}]{3,}/u', $line)) {
                        foreach ($activeWeekNumbers ?: [null] as $activeWeek) {
                            $this->addExtractedLearningTarget(
                                $sections,
                                $lessons,
                                $chunkId,
                                $weekChunkId,
                                $semester,
                                $activeWeek,
                                $activeLearningType,
                                $line,
                                $parents
                            );
                        }
                        continue;
                    }
                    if ($activeContentType !== null && $startsBullet
                        && mb_strlen($line, 'UTF-8') <= 500
                        && preg_match('/[\p{L}]{3,}/u', $line)) {
                        $value = $activeContentCode !== '' ? $activeContentCode . ' ' . $line : $line;
                        $sectionKey = $chunkId . ':' . $activeContentType . ':' . mb_strtolower($value, 'UTF-8');
                        $parentTitle = '';
                        foreach (array_reverse(['subject', 'strand', 'sub_strand', 'focal_area', 'content_standard', 'learning_outcome']) as $parentType) {
                            if (isset($parents[$parentType])) {
                                $parentTitle = $parents[$parentType];
                                break;
                            }
                        }
                        $sections[$sectionKey] = [
                            'chunk_id' => $chunkId,
                            'type' => $activeContentType,
                            'title' => $line,
                            'code' => $activeContentCode,
                            'details' => '',
                            'parent_title' => $parentTitle,
                        ];
                        if ($activeContentType === 'topic' && $week !== null && $weekChunkId !== null) {
                            foreach ($activeWeekNumbers ?: [$week] as $activeWeek) {
                                $key = $this->lessonKey($weekChunkId, $semester, $activeWeek);
                                if (isset($lessons[$key]) && $lessons[$key]['topic'] === '') {
                                    $lessons[$key]['topic'] = $line;
                                }
                            }
                        }
                        if (in_array($activeContentType, ['subject', 'strand', 'sub_strand', 'focal_area', 'content_standard', 'learning_outcome'], true)) {
                            $this->clearChildParents($parents, $activeContentType);
                            $parents[$activeContentType] = $line;
                        }
                        $activeContentCode = '';
                        continue;
                    }
                    $key = $week === null || $weekChunkId === null ? null : $this->lessonKey($weekChunkId, $semester, $week);
                    $topicIsEmpty = $key !== null && $lessons[$key]['topic'] === '';
                    if ($week !== null && $expectingWeekTopic && $line !== '' && (!$startsBullet || $topicIsEmpty)
                        && $this->isLikelyTopic($line)) {
                        foreach ($activeWeekNumbers ?: [$week] as $activeWeek) {
                            $activeKey = $this->lessonKey($weekChunkId, $semester, $activeWeek);
                            if (!isset($lessons[$activeKey])) {
                                continue;
                            }
                            if ($lessons[$activeKey]['topic'] === '') {
                                $lessons[$activeKey]['topic'] = $line;
                            } elseif ($activeWeek === $week && $this->isBetterTopic($line, $lessons[$activeKey]['topic'])) {
                                $lessons[$activeKey]['topic'] .= ' ' . $line;
                            }
                        }
                        if (preg_match('/[.!?]["\']?$/u', $line)) {
                            $expectingWeekTopic = false;
                        }
                    }
                    if ($line !== '' && ($startsBullet || !$expectingWeekTopic)) {
                        $expectingWeekTopic = false;
                    }
                    continue;
                }
                [$type, $value] = $labelled;
                $activeContentType = null;
                $activeContentCode = '';
                if (in_array($type, ['learning_indicator', 'learning_outcome', 'learning_objective'], true)) {
                    $activeLearningType = $type;
                } elseif ($type !== 'assessment_mode') {
                    $activeLearningType = null;
                }
                if ($type === 'topic' && $week !== null) {
                    $expectingWeekTopic = false;
                } elseif ($line !== '') {
                    $expectingWeekTopic = false;
                }
                if (in_array($type, ['learning_indicator', 'learning_outcome', 'learning_objective'], true)) {
                    foreach ($activeWeekNumbers ?: [null] as $activeWeek) {
                        $this->addExtractedLearningTarget(
                            $sections,
                            $lessons,
                            $chunkId,
                            $weekChunkId,
                            $semester,
                            $activeWeek,
                            $type,
                            $value,
                            $parents
                        );
                    }
                    continue;
                }
                if (in_array($type, ['topic', 'focal_area'], true) && $week !== null) {
                    foreach ($activeWeekNumbers ?: [$week] as $activeWeek) {
                        $key = $weekChunkId === null ? null : $this->lessonKey($weekChunkId, $semester, $activeWeek);
                        if ($key === null || !isset($lessons[$key])) {
                            continue;
                        }
                        if ($type === 'topic' && $lessons[$key]['topic'] === '') {
                            $lessons[$key]['topic'] = $value;
                        } elseif ($type === 'focal_area') {
                            $lessons[$key]['focal_areas'] = array_values(array_unique([
                                ...$lessons[$key]['focal_areas'],
                                ...$this->splitFocalAreas($value),
                            ]));
                        }
                    }
                } elseif ($type === 'assessment_mode' && $week !== null && !$inAssessmentSummary) {
                    foreach ($activeWeekNumbers ?: [$week] as $activeWeek) {
                        $key = $weekChunkId === null ? null : $this->lessonKey($weekChunkId, $semester, $activeWeek);
                        if ($key !== null && isset($lessons[$key]) && $value !== '') {
                            $lessons[$key]['assessment_mode'] = $value;
                        }
                    }
                }
                if (!in_array($type, self::SECTION_TYPES, true)) {
                    continue;
                }

                $code = $type === 'section' && $activeSectionNumber !== null
                    ? 'SECTION ' . $activeSectionNumber
                    : '';
                if ($type !== 'section' && preg_match('/^((?:[A-Z]{1,5}\d+|\d+)(?:[.-][A-Z\d]+)*)\s*[:.)-]?\s*(.+)$/u', $value, $codeMatch)) {
                    $code = $codeMatch[1];
                    $value = trim($codeMatch[2]);
                }
                if ($value === '' || mb_strlen($value, 'UTF-8') > 500) {
                    continue;
                }
                $parentTitle = '';
                foreach (array_reverse(['subject', 'strand', 'sub_strand', 'focal_area', 'content_standard', 'learning_outcome']) as $parentType) {
                    if (isset($parents[$parentType])) {
                        $parentTitle = $parents[$parentType];
                        break;
                    }
                }
                $sectionKey = $chunkId . ':' . $type . ':' . mb_strtolower($value, 'UTF-8');
                $sections[$sectionKey] = [
                    'chunk_id' => $chunkId,
                    'type' => $type,
                    'title' => $value,
                    'code' => $code,
                    'details' => '',
                    'parent_title' => $parentTitle,
                ];
                if (in_array($type, ['subject', 'strand', 'sub_strand', 'focal_area', 'content_standard', 'learning_outcome'], true)) {
                    $this->clearChildParents($parents, $type);
                    $parents[$type] = $value;
                }
            }
        }
        foreach ($lessons as &$lesson) {
            if ($lesson['topic'] === '' && !empty($lesson['focal_areas'][0])) {
                $lesson['topic'] = $lesson['focal_areas'][0];
            }
        }
        unset($lesson);
        $weeklyLessons = array_values(array_filter(
            $lessons,
            fn(array $lesson): bool => $this->isLikelyTopic($lesson['topic'])
                && mb_strlen($lesson['topic'], 'UTF-8') <= 500
        ));
        return [
            'sections' => array_values($sections),
            'weekly_lessons' => $weeklyLessons,
            'assessment_schedules' => $assessmentSchedules,
        ];
    }

    private function parseLabelledLine(string $line): ?array
    {
        if (!preg_match(
            '/^(subjects?|strands?|sub[\s-]?strands?|focal[\s-]?areas?|content[\s-]?standards?|learning[\s-]?(?:targets?|indicators?|outcomes?|objectives?)|LIs?|LOs?|topics?|sections?|assessment(?:[\s-]?(?:mode|schedule|strategy))?)\s*(?:#?((?:[A-Z]{1,5}\d+|\d+)(?:[.-][A-Z\d]+)*))?\s*[:.)-]\s*(.+)$/iu',
            trim($line),
            $matches
        )) {
            return null;
        }
        $label = mb_strtolower(preg_replace('/[\s-]+/u', ' ', $matches[1]) ?? $matches[1], 'UTF-8');
        $type = match (true) {
            str_starts_with($label, 'subject') => 'subject',
            str_starts_with($label, 'strand') => 'strand',
            str_contains($label, 'sub strand') => 'sub_strand',
            str_contains($label, 'focal') => 'focal_area',
            str_contains($label, 'content standard') => 'content_standard',
            str_contains($label, 'target') => 'learning_outcome',
            $label === 'li', $label === 'lis', str_contains($label, 'indicator') => 'learning_indicator',
            $label === 'lo', $label === 'los', str_contains($label, 'outcome') => 'learning_outcome',
            str_contains($label, 'objective') => 'learning_objective',
            str_starts_with($label, 'topic') => 'topic',
            str_starts_with($label, 'section') => 'section',
            str_contains($label, 'assessment') => 'assessment_mode',
            default => null,
        };
        $code = trim((string)($matches[2] ?? ''));
        $value = trim(($code !== '' ? $code . ' ' : '') . $matches[3]);
        if (preg_match('/^((?:[A-Z]{1,5}\d+|\d+)(?:[.-][A-Z\d]+)*)\s*[:.)-]?\s*(.+)$/u', $value, $codeMatch)) {
            $value = trim($codeMatch[1] . ' ' . $codeMatch[2]);
        }
        return $type !== null && $value !== '' ? [$type, $value] : null;
    }

    private function isStructureBoundary(string $line): bool
    {
        $line = trim(preg_replace('/^\s{0,3}#{1,6}\s*/u', '', $line) ?? $line);
        $line = preg_replace('/^\s*(?:[-*•]\s+|\d+[.)]\s+|[a-z][.)]\s+)/iu', '', $line) ?? $line;
        return preg_match('/^(?:weeks?\b|semester\b|sect(?:ion|in)\b|assessment summary\b|introduction and section summary\b|summary of pedagogical exemplars\b)/iu', $line) === 1
            || $this->parseLearningHeading($line) !== null
            || $this->parseContentHeading($line) !== null
            || $this->parseLabelledLine($line) !== null;
    }

    private function parseContentHeading(string $line): ?array
    {
        if (!preg_match(
            '/^(subjects?|strands?|sub[\s-]?strands?|focal[\s-]?areas?|content[\s-]?standards?|topics?|sections?)(?:\s+#?([A-Z]?\d+(?:[.-]\d+)*))?$/iu',
            trim($line),
            $matches
        )) {
            return null;
        }
        $label = mb_strtolower(preg_replace('/[\s-]+/u', ' ', $matches[1]) ?? $matches[1], 'UTF-8');
        $type = match (true) {
            str_starts_with($label, 'subject') => 'subject',
            str_starts_with($label, 'strand') => 'strand',
            str_contains($label, 'sub strand') => 'sub_strand',
            str_contains($label, 'focal') => 'focal_area',
            str_contains($label, 'content standard') => 'content_standard',
            str_starts_with($label, 'topic') => 'topic',
            default => 'section',
        };
        return [$type, trim((string)($matches[2] ?? ''))];
    }

    private function clearChildParents(array &$parents, string $type): void
    {
        $hierarchy = ['subject', 'strand', 'sub_strand', 'focal_area', 'content_standard', 'learning_outcome'];
        $index = array_search($type, $hierarchy, true);
        if ($index === false) {
            return;
        }
        foreach (array_slice($hierarchy, $index + 1) as $childType) {
            unset($parents[$childType]);
        }
    }

    private function isTableHeader(array $cells): bool
    {
        $recognized = 0;
        foreach ($cells as $cell) {
            if (preg_match('/\b(?:week|topic|strand|sub[\s-]?strand|focal area|content standard|learning targets?|learning indicators?|learning outcomes?|learning objectives?|assessment(?: mode| schedule)?)\b/i', $cell)) {
                $recognized++;
            }
        }
        return $recognized >= 2;
    }

    private function sectionsFromTableRow(int $chunkId, array $headers, array $cells): array
    {
        $sections = [];
        foreach ($headers as $index => $header) {
            $type = match (true) {
                preg_match('/^subject$/i', trim($header)) === 1 => 'subject',
                preg_match('/^strand$/i', trim($header)) === 1 => 'strand',
                preg_match('/^sub[\s-]?strand$/i', trim($header)) === 1 => 'sub_strand',
                preg_match('/focal area/i', $header) === 1 => 'focal_area',
                preg_match('/content standard/i', $header) === 1 => 'content_standard',
                preg_match('/learning indicators?|\bLIs?\b/i', $header) === 1 => 'learning_indicator',
                preg_match('/learning targets?/i', $header) === 1 => 'learning_outcome',
                preg_match('/learning outcomes?|\bLOs?\b/i', $header) === 1 => 'learning_outcome',
                preg_match('/learning objectives?/i', $header) === 1 => 'learning_objective',
                preg_match('/^topic$/i', trim($header)) === 1 => 'topic',
                default => null,
            };
            $value = trim((string)($cells[$index] ?? ''));
            if ($type === null || $value === '') {
                continue;
            }
            $values = in_array($type, ['learning_indicator', 'learning_outcome', 'learning_objective'], true)
                ? $this->splitSourceValues($value)
                : [$value];
            foreach ($values as $sectionValue) {
                if ($sectionValue === '' || mb_strlen($sectionValue, 'UTF-8') > 500) {
                    continue;
                }
                $sections[] = [
                    'chunk_id' => $chunkId,
                    'type' => $type,
                    'title' => $sectionValue,
                    'code' => '',
                    'details' => '',
                    'parent_title' => '',
                ];
            }
        }
        return $sections;
    }

    private function lessonsFromTableRow(int $chunkId, array $headers, array $cells, ?int $currentSemester): array
    {
        $values = [];
        foreach ($headers as $index => $header) {
            $values[mb_strtolower(trim($header), 'UTF-8')] = trim((string)($cells[$index] ?? ''));
        }
        $weekValue = '';
        $topic = '';
        $focalAreas = [];
        $learningIndicators = [];
        $learningOutcomes = [];
        $assessment = null;
        $semester = $currentSemester;
        foreach ($values as $header => $value) {
            if (str_contains($header, 'week')) {
                $weekValue = $value;
            } elseif (str_contains($header, 'topic')) {
                $topic = $value;
            } elseif (str_contains($header, 'focal')) {
                $focalAreas = $this->splitFocalAreas($value);
            } elseif (preg_match('/learning indicators?|\bLIs?\b/i', $header)) {
                $learningIndicators = $this->splitSourceValues($value);
            } elseif (preg_match('/learning outcomes?|\bLOs?\b|learning objectives?|learning targets?/i', $header)) {
                $learningOutcomes = $this->splitSourceValues($value);
            } elseif (str_contains($header, 'assessment')) {
                $assessment = $value !== '' ? $value : null;
            } elseif (str_contains($header, 'semester') || str_contains($header, 'term')) {
                if (preg_match('/\b([12])\b/', $value, $match)) {
                    $semester = (int)$match[1];
                }
            }
        }
        if ($topic === '' || mb_strlen($topic, 'UTF-8') > 500
            || !preg_match('/^\s*(?:weeks?\s*[:.]?\s*)?([1-9]|[1-4][0-9]|5[0-2])(?:\s*(?:-|\x{2013}|\x{2014}|to|and|&)\s*(?:weeks?\s*)?([1-9]|[1-4][0-9]|5[0-2]))?\b/iu', $weekValue, $weekMatch)) {
            return [];
        }
        $firstWeek = (int)$weekMatch[1];
        $lastWeek = isset($weekMatch[2]) && $weekMatch[2] !== '' ? (int)$weekMatch[2] : $firstWeek;
        $weeks = $lastWeek >= $firstWeek ? range($firstWeek, $lastWeek) : [$firstWeek];
        return array_map(static fn(int $week): array => [
            'chunk_id' => $chunkId,
            'semester' => $semester,
            'week' => $week,
            'topic' => $topic,
            'focal_areas' => $focalAreas,
            'learning_indicators' => $learningIndicators,
            'learning_outcomes' => $learningOutcomes,
            'assessment_mode' => $assessment,
        ], $weeks);
    }

    private function mergeLesson(?array $existing, array $lesson): array
    {
        if ($existing === null) {
            return $lesson;
        }
        if ($existing['topic'] === '' && $lesson['topic'] !== '') {
            $existing['topic'] = $lesson['topic'];
        }
        $existing['focal_areas'] = array_values(array_unique([
            ...$existing['focal_areas'],
            ...$lesson['focal_areas'],
        ]));
        $existing['learning_indicators'] = array_values(array_unique([
            ...($existing['learning_indicators'] ?? []),
            ...($lesson['learning_indicators'] ?? []),
        ]));
        $existing['learning_outcomes'] = array_values(array_unique([
            ...($existing['learning_outcomes'] ?? []),
            ...($lesson['learning_outcomes'] ?? []),
        ]));
        $existing['assessment_mode'] ??= $lesson['assessment_mode'];
        return $existing;
    }

    private function splitSourceValues(string $value): array
    {
        $value = preg_replace('/\s+(?=[A-Z]{1,5}\d+(?:\.\d+)*\s*[:.)-])/u', "\n", trim($value)) ?? trim($value);
        $values = preg_split('/\s*(?:;|\R|•)\s*/u', $value) ?: [];
        return array_values(array_unique(array_filter(
            array_map(static fn(string $item): string => trim(preg_replace('/^(?:[-*•]|\d+[.)])\s*/u', '', trim($item)), " \t,"),
                $values),
            static fn(string $item): bool => $item !== '' && mb_strlen($item, 'UTF-8') <= 500
        )));
    }

    private function splitFocalAreas(string $value): array
    {
        return array_values(array_unique(array_filter(
            array_map(
                static fn(string $area): string => trim(preg_replace('/^\s*\d+\s+(?=[\p{L}])/u', '', $area) ?? $area),
                $this->splitSourceValues($value)
            ),
            static fn(string $area): bool => $area !== ''
        )));
    }

    private function parseLearningHeading(string $line): ?string
    {
        if (!preg_match('/^(?:learning[\s-]*)?(targets?|indicators?|outcomes?|objectives?|LIs?|LOs?)\s*[:.]?$/iu', trim($line), $matches)) {
            return null;
        }
        $label = mb_strtolower(preg_replace('/[\s-]+/u', '', $matches[1]) ?? $matches[1], 'UTF-8');
        return match (true) {
            str_starts_with($label, 'target') => 'learning_outcome',
            str_starts_with($label, 'li'), $label === 'indicator', $label === 'indicators' => 'learning_indicator',
            str_starts_with($label, 'lo'), str_starts_with($label, 'outcome') => 'learning_outcome',
            default => 'learning_objective',
        };
    }

    private function addExtractedLearningTarget(
        array &$sections,
        array &$lessons,
        int $chunkId,
        ?int $weekChunkId,
        ?int $semester,
        ?int $week,
        string $type,
        string $value,
        array $parents
    ): void {
        $targetType = $type === 'learning_objective' ? 'learning_outcome' : $type;
        foreach ($this->splitSourceValues($value) as $target) {
            $code = '';
            if (preg_match('/^((?:[A-Z]{1,5}\d+|\d+)(?:[.-][A-Z\d]+)*)\s*[:.)-]?\s*(.+)$/u', $target, $matches)) {
                $code = $matches[1];
                $target = trim($matches[2]);
            }
            if ($target === '' || mb_strlen($target, 'UTF-8') > 500) {
                continue;
            }
            $sectionKey = $chunkId . ':' . $targetType . ':' . mb_strtolower($target, 'UTF-8');
            $sections[$sectionKey] = [
                'chunk_id' => $chunkId,
                'type' => $targetType,
                'title' => $target,
                'code' => $code,
                'details' => '',
                'parent_title' => $parents['content_standard'] ?? $parents['focal_area'] ?? $parents['sub_strand'] ?? '',
            ];
            if ($week === null || $weekChunkId === null) {
                continue;
            }
            $lessonKey = $this->lessonKey($weekChunkId, $semester, $week);
            if (!isset($lessons[$lessonKey])) {
                continue;
            }
            $field = $targetType === 'learning_indicator' ? 'learning_indicators' : 'learning_outcomes';
            $lessons[$lessonKey][$field] = array_values(array_unique([
                ...($lessons[$lessonKey][$field] ?? []),
                trim($code !== '' ? $code . ' ' . $target : $target),
            ]));
        }
    }

    private function decodeLearningTargets(mixed $value): array
    {
        if ($value === null || $value === '') {
            return [];
        }
        $targets = json_decode((string)$value, true, 16, JSON_THROW_ON_ERROR);
        if (!is_array($targets) || array_filter($targets, 'is_string') !== $targets) {
            throw new RuntimeException('A stored weekly lesson contains invalid learning-target data.', 500);
        }
        return array_values($targets);
    }

    private function registerWeeklyLearningTargets(PDO $pdo, int $documentId): void
    {
        $lessons = $pdo->prepare(
            'SELECT id, topic, focal_areas, learning_indicators, learning_outcomes
             FROM curriculum_weekly_lessons
             WHERE document_id = :document_id AND ai_generated = 0'
        );
        $lessons->execute(['document_id' => $documentId]);
        $weeklyRows = $lessons->fetchAll();
        if ($weeklyRows === []) {
            return;
        }
        $targetQuery = $pdo->prepare(
            "SELECT section_type, code, title
             FROM curriculum_sections
             WHERE document_id = :document_id AND ai_generated = 0
               AND section_type IN ('learning_indicator', 'learning_outcome', 'learning_objective')
             ORDER BY page_number, id"
        );
        $targetQuery->execute(['document_id' => $documentId]);
        $targets = $targetQuery->fetchAll();
        $update = $pdo->prepare(
            'UPDATE curriculum_weekly_lessons
             SET learning_indicators = :learning_indicators, learning_outcomes = :learning_outcomes
             WHERE id = :id AND ai_generated = 0'
        );
        foreach ($weeklyRows as $weeklyRow) {
            $focalAreas = json_decode((string)$weeklyRow['focal_areas'], true, 16, JSON_THROW_ON_ERROR);
            if (!is_array($focalAreas) || array_filter($focalAreas, 'is_string') !== $focalAreas) {
                throw new RuntimeException('A stored weekly lesson contains invalid focal-area data.', 500);
            }
            $originalIndicators = $this->decodeLearningTargets($weeklyRow['learning_indicators'] ?? null);
            $originalOutcomes = $this->decodeLearningTargets($weeklyRow['learning_outcomes'] ?? null);
            $indicators = [];
            $outcomes = [];
            foreach ($originalIndicators as $value) {
                if ($this->learningTargetMatchesWeek((string)$weeklyRow['topic'], $focalAreas, $value)) {
                    $indicators = $this->mergeLearningTarget($indicators, $value);
                }
            }
            foreach ($originalOutcomes as $value) {
                if ($this->learningTargetMatchesWeek((string)$weeklyRow['topic'], $focalAreas, $value)) {
                    $outcomes = $this->mergeLearningTarget($outcomes, $value);
                }
            }
            foreach ($targets as $target) {
                if (!$this->learningTargetMatchesWeek(
                    (string)$weeklyRow['topic'],
                    $focalAreas,
                    (string)$target['title']
                )) {
                    continue;
                }
                $value = trim(implode(' ', array_filter([
                    trim((string)($target['code'] ?? '')),
                    trim((string)$target['title']),
                ])));
                if ($value === '') {
                    continue;
                }
                if ($target['section_type'] === 'learning_indicator') {
                    $indicators = $this->mergeLearningTarget($indicators, $value);
                } else {
                    $outcomes = $this->mergeLearningTarget($outcomes, $value);
                }
            }
            if ($indicators !== $originalIndicators || $outcomes !== $originalOutcomes) {
                $update->execute([
                    'learning_indicators' => json_encode($indicators, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                    'learning_outcomes' => json_encode($outcomes, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                    'id' => (int)$weeklyRow['id'],
                ]);
            }
        }
    }

    private function learningTargetMatchesWeek(string $topic, array $focalAreas, string $target): bool
    {
        $stopWords = array_fill_keys([
            'about', 'after', 'also', 'and', 'are', 'based', 'between', 'from', 'given',
            'into', 'their', 'these', 'those', 'through', 'using', 'which', 'with',
            'apply', 'describe', 'demonstrate', 'identify', 'understand',
        ], true);
        $tokens = static function (string $text) use ($stopWords): array {
            preg_match_all('/[\p{L}\p{N}]{4,}/u', mb_strtolower($text, 'UTF-8'), $matches);
            return array_values(array_unique(array_filter(
                $matches[0] ?? [],
                static fn(string $word): bool => !isset($stopWords[$word])
            )));
        };
        $contextTokens = $tokens($topic . "\n" . implode("\n", $focalAreas));
        $targetTokens = $tokens($target);
        $overlap = count(array_intersect($contextTokens, $targetTokens));
        $union = count(array_unique([...$contextTokens, ...$targetTokens]));
        return $overlap >= 3 && $overlap / max(1, $union) >= 0.5;
    }

    private function mergeLearningTarget(array $targets, string $candidate): array
    {
        $normalize = static fn(string $value): string =>
            preg_replace('/\s+/u', ' ', mb_strtolower(trim($value), 'UTF-8')) ?? '';
        $candidateKey = $normalize($candidate);
        foreach ($targets as $index => $existing) {
            $existingKey = $normalize((string)$existing);
            if ($existingKey === $candidateKey || str_starts_with($candidateKey, $existingKey)) {
                $targets[$index] = mb_strlen($candidate, 'UTF-8') > mb_strlen((string)$existing, 'UTF-8')
                    ? $candidate
                    : (string)$existing;
                return array_values($targets);
            }
            if (str_starts_with($existingKey, $candidateKey)) {
                return array_values($targets);
            }
        }
        $targets[] = $candidate;
        return array_values($targets);
    }

    private function isLikelyTopic(string $line): bool
    {
        return mb_strlen($line, 'UTF-8') >= 3 && mb_strlen($line, 'UTF-8') <= 500
            && preg_match('/[\p{L}]{3,}/u', $line) === 1
            && !preg_match('/(?:mark(?:ing)?\s+schemes?|sample examination|practice examination|mock examination|question\s*(?:one|\d+)|mcqs?|solutions?|competencies and identify areas requiring remediation|recommended mode of assessment|^(?:page\s+\d+|learning outcomes?|learning indicators?|instructions?|assessment|references?|topics?|strands?|sub[\s_-]*strands?|focal areas?|content standards?|weekly plans?)\b|^introduction\s*$)/i', $line);
    }

    private function assessmentSchedulesFromContent(string $content): array
    {
        $lines = preg_split('/\R/u', $content) ?: [];
        $inAssessmentTable = false;
        $indicatorLines = [];
        $schedules = [];
        foreach ($lines as $line) {
            $line = trim($line);
            if (preg_match('/indicators?.*DOK.*assessment|assessment.*indicators?.*DOK/i', $line)) {
                $inAssessmentTable = true;
                $indicatorLines = [];
                continue;
            }
            if (!$inAssessmentTable) {
                continue;
            }
            if (preg_match('/assessment\s+mode\s*:\s*(.+)$/i', $line, $modeMatch)) {
                $indicator = trim(implode(' ', $indicatorLines));
                $mode = trim($modeMatch[1], " \t.:;");
                if ($this->isLikelyTopic($indicator) && $mode !== '') {
                    $schedules[] = ['indicator' => $indicator, 'assessment_mode' => $mode];
                }
                $indicatorLines = [];
                continue;
            }
            if (preg_match('/^assessment\s+strategy\s*:/i', $line)) {
                continue;
            }
            if (preg_match('/^level\s+\d+\b/i', $line)) {
                continue;
            }
            if (preg_match('/^(?:table\s+\d+|assessment summary|indicators?\s+DOK)/i', $line)) {
                continue;
            }
            if ($line !== '') {
                $indicatorLines[] = $line;
            }
        }
        return $schedules;
    }

    private function assessmentTopicMatchScore(string $topic, string $indicator): float
    {
        $stopWords = array_fill_keys([
            'about', 'after', 'along', 'also', 'and', 'are', 'based', 'between', 'by', 'for',
            'from', 'given', 'how', 'in', 'into', 'involving', 'of', 'on', 'or', 'over', 'the',
            'their', 'then', 'there', 'these', 'this', 'through', 'to', 'under', 'using', 'with',
        ], true);
        $tokens = static function (string $text) use ($stopWords): array {
            $words = preg_split('/[^\p{L}\p{N}]+/u', mb_strtolower($text, 'UTF-8')) ?: [];
            return array_values(array_unique(array_filter(
                $words,
                static fn(string $word): bool => mb_strlen($word, 'UTF-8') > 2 && !isset($stopWords[$word])
            )));
        };
        $topicTokens = $tokens($topic);
        $indicatorTokens = $tokens($indicator);
        if (count($topicTokens) < 3 || count($indicatorTokens) < 3) {
            return 0.0;
        }
        $overlap = count(array_intersect($topicTokens, $indicatorTokens));
        $smallerCount = min(count($topicTokens), count($indicatorTokens));
        return $overlap / max(1, $smallerCount);
    }

    private function isBetterTopic(string $candidate, string $existing): bool
    {
        if (!$this->isLikelyTopic($candidate)) {
            return false;
        }
        if (!$this->isLikelyTopic($existing)) {
            return true;
        }
        $existing = trim($existing);
        $candidateLower = mb_strtolower($candidate, 'UTF-8');
        $existingLower = mb_strtolower($existing, 'UTF-8');
        return mb_strlen($candidate, 'UTF-8') > mb_strlen($existing, 'UTF-8')
            && str_starts_with($candidateLower, $existingLower)
            && preg_match('/[.!?]["\']?$/u', $existing) !== 1
            && preg_match('/^\s/u', mb_substr($candidate, mb_strlen($existing, 'UTF-8'), 1, 'UTF-8')) === 1;
    }

    private function lessonKey(int $chunkId, ?int $semester, int $week): string
    {
        return $chunkId . ':' . ($semester ?? 0) . ':' . $week;
    }
}
