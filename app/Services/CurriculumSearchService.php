<?php
declare(strict_types=1);

namespace Akademi\Services;

use Akademi\Database\Connection;

final class CurriculumSearchService
{
    public function verifiedStructure(
        ?string $yearGroup = null,
        string $query = '',
        int $limit = 100,
        int $offset = 0,
        string $subject = ''
    ): array
    {
        $this->indexVerifiedResourceChunks($yearGroup, $subject);
        $query = trim(preg_replace('/[^\p{L}\p{N}\s_-]+/u', ' ', $query) ?? '');
        $query = mb_substr($query, 0, 250, 'UTF-8');
        $limit = max(1, min(100, $limit));
        $offset = max(0, min(100000, $offset));
        $sql = "SELECT s.id, s.section_type, s.code, s.title, s.body, s.page_number,
                       p.title AS parent_title,
                       d.id AS document_id, d.title AS document_title, d.year_group, d.subject_name,
                       d.source_reference, d.source_url
                FROM curriculum_sections s
                JOIN curriculum_documents d ON d.id = s.document_id
                LEFT JOIN curriculum_sections p ON p.id = s.parent_id
                WHERE s.review_status = 'verified'
                  AND (s.ai_generated = 0 OR s.review_notes LIKE 'Admin verified section type:%')
                  AND d.review_status = 'verified'
                  AND d.is_enabled = 1
                  AND d.extraction_status = 'extracted'";
        $parameters = [];
        if ($yearGroup !== null && $yearGroup !== '') {
            $sql .= ' AND FIND_IN_SET(:year_group, d.year_group) > 0';
            $parameters['year_group'] = $yearGroup;
        }
        if ($subject !== '') {
            $sql .= ' AND ' . $this->subjectDocumentCondition($subject, 'd', $parameters);
        }
        if ($query !== '') {
            $sql .= ' AND MATCH(s.title, s.body) AGAINST (:terms IN NATURAL LANGUAGE MODE)';
            $parameters['terms'] = $query;
        }
        $sql .= ' ORDER BY d.year_group, d.subject_name, s.page_number, s.id LIMIT ' . $limit . ' OFFSET ' . $offset;
        $statement = Connection::get()->prepare($sql);
        $statement->execute($parameters);
        return array_map(fn(array $row): array => $this->sanitizeUtf8Values($row), $statement->fetchAll());
    }

    public function verifiedWeeklyLessons(
        string $subject,
        string $yearGroup,
        ?int $semester = null,
        int $limit = 250,
        bool $includeCurriculumEntries = false
    ): array
    {
        $subject = trim($subject);
        if ($subject === '' || mb_strlen($subject) > 190 || !in_array($yearGroup, ['SHS1', 'SHS2', 'SHS3'], true)
            || ($semester !== null && !in_array($semester, [1, 2], true))) {
            throw new \RuntimeException('Choose a subject, SHS year and valid semester.', 422);
        }
        $limit = max(1, min(500, $limit));
        $parameters = ['year_group' => $yearGroup];
        $subjectCondition = $this->subjectDocumentCondition($subject, 'd', $parameters);
        $sql = "SELECT lesson.id, lesson.semester_number, lesson.week_number, lesson.topic,
                       lesson.focal_areas, lesson.learning_indicators, lesson.learning_outcomes,
                       lesson.assessment_mode, lesson.source_page,
                       lesson.source_chunk_id,
                       (LOCATE('Focal Area', lesson_chunk.content) > 0
                        OR LOCATE('FOCAL AREA', lesson_chunk.content) > 0
                        OR LOCATE('focal area', lesson_chunk.content) > 0) AS source_has_focal_area_label,
                       lesson.ai_generated, d.id AS document_id, d.title AS source_title,
                       d.resource_role, d.source_reference, d.source_url
                FROM curriculum_weekly_lessons lesson
                JOIN curriculum_documents d ON d.id = lesson.document_id
                LEFT JOIN curriculum_chunks lesson_chunk
                  ON lesson_chunk.id = lesson.source_chunk_id AND lesson_chunk.document_id = lesson.document_id
                WHERE (lesson.review_status = 'verified' OR lesson.ai_generated = 0)
                  AND d.review_status = 'verified'
                  AND d.is_enabled = 1
                  AND d.extraction_status = 'extracted'
                  AND (
                      d.resource_role IN ('teacher_manual', 'learner_material', 'curriculum')
                      OR (d.resource_role = 'other' AND lesson.review_status = 'verified')
                  )
                  AND FIND_IN_SET(:year_group, d.year_group) > 0
                  AND {$subjectCondition}";
        $sql .= " ORDER BY CASE WHEN lesson.review_status = 'verified' THEN 0 ELSE 1 END,
                  CASE d.resource_role WHEN 'teacher_manual' THEN 0 WHEN 'curriculum' THEN 1 ELSE 2 END,
                  lesson.semester_number, lesson.week_number, d.updated_at DESC, lesson.id LIMIT {$limit}";
        $statement = Connection::get()->prepare($sql);
        $statement->execute($parameters);
        $lessons = [];
        $seenWeeks = [];
        foreach ($statement->fetchAll() as $row) {
            $sourceWeek = (int)$row['week_number'];
            $lessonSemester = $row['semester_number'] === null ? null : (int)$row['semester_number'];
            if ($lessonSemester === null) {
                if ($sourceWeek < 1 || $sourceWeek > 24) {
                    continue;
                }
                $lessonSemester = $sourceWeek > 12 ? 2 : 1;
                $row['week_number'] = $sourceWeek > 12 ? $sourceWeek - 12 : $sourceWeek;
            }
            if ($semester !== null && $lessonSemester !== $semester) {
                continue;
            }
            $row['semester_number'] = $lessonSemester;
            if (!$this->isUsableWeeklyTopic((string)$row['topic'])) {
                continue;
            }
            $row['topic'] = preg_replace('/^[a-z][.)]\s*/iu', '', trim((string)$row['topic'])) ?? $row['topic'];
            $weekKey = $lessonSemester . ':' . (int)$row['week_number'];
            if (isset($seenWeeks[$weekKey])) {
                $existingIndex = $seenWeeks[$weekKey];
                if ((int)$lessons[$existingIndex]['document_id'] === (int)$row['document_id']) {
                    $candidateIndicators = $this->decodeWeeklyTargets($row['learning_indicators'] ?? null);
                    $candidateOutcomes = $this->decodeWeeklyTargets($row['learning_outcomes'] ?? null);
                    $candidateFocalAreas = json_decode((string)$row['focal_areas'], true, 16, JSON_THROW_ON_ERROR);
                    if (!is_array($candidateFocalAreas) || array_filter($candidateFocalAreas, 'is_string') !== $candidateFocalAreas) {
                        throw new \RuntimeException('A verified weekly lesson contains invalid focal-area data.', 500);
                    }
                    $candidateFocalAreas = $this->cleanWeeklyFocalAreas($candidateFocalAreas);
                    if (!(bool)($row['source_has_focal_area_label'] ?? false)) {
                        $candidateFocalAreas = $this->filterWeeklyFocalAreas((string)$row['topic'], $candidateFocalAreas);
                    }
                    $candidateScore = $this->weeklyTopicSupportScore(
                        (string)$row['topic'],
                        $candidateFocalAreas,
                        $candidateIndicators,
                        $candidateOutcomes
                    );
                    if ($candidateScore > (float)($lessons[$existingIndex]['_topic_support_score'] ?? 0)) {
                        $lessons[$existingIndex]['topic'] = $row['topic'];
                        $lessons[$existingIndex]['source_page'] = $row['source_page'];
                        $lessons[$existingIndex]['source_chunk_id'] = $row['source_chunk_id'];
                        $lessons[$existingIndex]['_topic_support_score'] = $candidateScore;
                    }
                    foreach (['focal_areas', 'learning_indicators', 'learning_outcomes'] as $field) {
                        $additional = $field === 'focal_areas'
                            ? $candidateFocalAreas
                            : ($field === 'learning_indicators' ? $candidateIndicators : $candidateOutcomes);
                        if (!is_array($additional) || array_filter($additional, 'is_string') !== $additional) {
                            throw new \RuntimeException('A verified weekly lesson contains invalid curriculum data.', 500);
                        }
                        $lessons[$existingIndex][$field] = array_values(array_unique([
                            ...$lessons[$existingIndex][$field],
                            ...$additional,
                        ]));
                    }
                }
                continue;
            }
            $focalAreas = json_decode((string)$row['focal_areas'], true, 16, JSON_THROW_ON_ERROR);
            if (!is_array($focalAreas) || array_filter($focalAreas, 'is_string') !== $focalAreas) {
                throw new \RuntimeException('A verified weekly lesson contains invalid focal-area data.', 500);
            }
            $row['focal_areas'] = $this->cleanWeeklyFocalAreas($focalAreas);
            if (!(bool)($row['source_has_focal_area_label'] ?? false)) {
                $row['focal_areas'] = $this->filterWeeklyFocalAreas((string)$row['topic'], $row['focal_areas']);
            }
            $row['learning_indicators'] = $this->decodeWeeklyTargets($row['learning_indicators'] ?? null);
            $row['learning_outcomes'] = $this->decodeWeeklyTargets($row['learning_outcomes'] ?? null);
            $row['ai_generated'] = (bool)$row['ai_generated'];
            unset($row['source_has_focal_area_label']);
            $row['_topic_support_score'] = $this->weeklyTopicSupportScore(
                (string)$row['topic'],
                $row['focal_areas'],
                $row['learning_indicators'],
                $row['learning_outcomes']
            );
            $seenWeeks[$weekKey] = count($lessons);
            $lessons[] = $this->sanitizeUtf8Values($row);
        }
        foreach ($lessons as &$lesson) {
            unset($lesson['_topic_support_score']);
        }
        unset($lesson);
        usort($lessons, static fn(array $left, array $right): int =>
            ((int)$left['semester_number'] <=> (int)$right['semester_number'])
            ?: ((int)$left['week_number'] <=> (int)$right['week_number'])
        );
        return $includeCurriculumEntries ? $this->attachWeeklyCurriculumEntries($lessons) : $lessons;
    }

    private function attachWeeklyCurriculumEntries(array $lessons): array
    {
        if ($lessons === []) {
            return [];
        }

        $chunkIds = [];
        $pagePairs = [];
        $documentIds = [];
        foreach ($lessons as $lesson) {
            $documentIds[(int)$lesson['document_id']] = true;
            if (!empty($lesson['source_chunk_id'])) {
                $chunkIds[(int)$lesson['source_chunk_id']] = true;
            }
            if (!empty($lesson['source_page'])) {
                $sourcePage = (int)$lesson['source_page'];
                for ($page = max(1, $sourcePage - 3); $page <= $sourcePage + 3; $page++) {
                    $pagePairs[(int)$lesson['document_id'] . ':' . $page] = [
                        (int)$lesson['document_id'],
                        $page,
                    ];
                }
            }
        }

        $conditions = [];
        $parameters = [];
        if ($chunkIds !== []) {
            $placeholders = [];
            foreach (array_keys($chunkIds) as $index => $chunkId) {
                $key = 'chunk_' . $index;
                $placeholders[] = ':' . $key;
                $parameters[$key] = $chunkId;
            }
            $conditions[] = 's.source_chunk_id IN (' . implode(', ', $placeholders) . ')';
        }
        foreach (array_values($pagePairs) as $index => [$documentId, $pageNumber]) {
            $documentKey = 'page_document_' . $index;
            $pageKey = 'page_number_' . $index;
            $conditions[] = '(s.document_id = :' . $documentKey . ' AND s.page_number = :' . $pageKey . ')';
            $parameters[$documentKey] = $documentId;
            $parameters[$pageKey] = $pageNumber;
        }
        foreach (array_keys($documentIds) as $index => $documentId) {
            $documentKey = 'related_document_' . $index;
            $conditions[] = '(s.document_id = :' . $documentKey . ' AND s.section_type IN (\'focal_area\', \'content_standard\', \'learning_indicator\', \'learning_outcome\', \'learning_objective\'))';
            $parameters[$documentKey] = $documentId;
        }
        if ($conditions === []) {
            foreach ($lessons as &$lesson) {
                $lesson['curriculum_entries'] = [];
            }
            unset($lesson);
            return $lessons;
        }

        $sectionSelect = "SELECT s.id, s.parent_id, s.document_id, s.source_chunk_id,
                                 s.section_type, s.code, s.title, s.body, s.page_number,
                                 c.content AS chunk_content,
                                 d.title AS document_title, d.source_reference, d.source_url
                          FROM curriculum_sections s
                          JOIN curriculum_documents d ON d.id = s.document_id
                          LEFT JOIN curriculum_chunks c
                            ON c.id = s.source_chunk_id AND c.document_id = s.document_id
                          WHERE (s.review_status = 'verified' OR s.ai_generated = 0
                                 OR s.review_notes LIKE 'Admin verified section type:%')
                            AND d.review_status = 'verified'
                            AND d.is_enabled = 1
                            AND d.extraction_status = 'extracted'";
        $pdo = Connection::get();
        $statement = $pdo->prepare($sectionSelect . ' AND (' . implode(' OR ', $conditions) . ') ORDER BY s.page_number, s.id');
        $statement->execute($parameters);
        $sectionsById = [];
        $sectionsByChunk = [];
        $sectionsByPage = [];
        foreach ($statement->fetchAll() as $section) {
            $section = $this->sanitizeUtf8Values($section);
            $sectionId = (int)$section['id'];
            $sectionsById[$sectionId] = $section;
            if (!empty($section['source_chunk_id'])) {
                $sectionsByChunk[(int)$section['source_chunk_id']][] = $sectionId;
            }
            if (!empty($section['page_number'])) {
                $pageKey = (int)$section['document_id'] . ':' . (int)$section['page_number'];
                $sectionsByPage[$pageKey][] = $sectionId;
            }
        }
        $pendingParents = [];
        foreach ($sectionsById as $section) {
            if (!empty($section['parent_id']) && !isset($sectionsById[(int)$section['parent_id']])) {
                $pendingParents[(int)$section['parent_id']] = (int)$section['document_id'];
            }
        }
        for ($depth = 0; $depth < 8 && $pendingParents !== []; $depth++) {
            $parentIds = array_keys($pendingParents);
            $expectedParentDocuments = $pendingParents;
            $parentPlaceholders = [];
            $parentParameters = [];
            foreach ($parentIds as $index => $parentId) {
                $key = 'parent_' . $index;
                $parentPlaceholders[] = ':' . $key;
                $parentParameters[$key] = $parentId;
            }
            $parents = $pdo->prepare(
                $sectionSelect . ' AND s.id IN (' . implode(', ', $parentPlaceholders) . ') ORDER BY s.page_number, s.id'
            );
            $parents->execute($parentParameters);
            $pendingParents = [];
            foreach ($parents->fetchAll() as $parent) {
                $parent = $this->sanitizeUtf8Values($parent);
                $parentId = (int)$parent['id'];
                if (($expectedParentDocuments[$parentId] ?? null) !== (int)$parent['document_id']) {
                    continue;
                }
                $sectionsById[$parentId] = $parent;
                if (!empty($parent['parent_id']) && !isset($sectionsById[(int)$parent['parent_id']])) {
                    $pendingParents[(int)$parent['parent_id']] = (int)$parent['document_id'];
                }
            }
        }

        $relatedFocalAreaIdsByLesson = [];
        $scopeParents = [];
        $isWeekScopeAnchor = static function (array $section): bool {
            $type = strtolower((string)($section['section_type'] ?? ''));
            if (in_array($type, ['topic', 'focal_area', 'content_standard'], true)) {
                return true;
            }
            return preg_match(
                '/^\s*(?:topic|focal[\s_-]*area|content[\s_-]*standard)\s*(?:[:#-]|\d|\b)/iu',
                (string)($section['title'] ?? '') . "\n" . mb_substr((string)($section['body'] ?? ''), 0, 300, 'UTF-8')
            ) === 1;
        };
        $curriculumTokens = static function (string $text): array {
            preg_match_all('/[\p{L}\p{N}]{5,}/u', mb_strtolower($text, 'UTF-8'), $matches);
            $stopWords = [
                'about', 'after', 'among', 'based', 'being', 'between', 'could', 'demonstrate',
                'different', 'during', 'each', 'from', 'given', 'into', 'learners', 'their',
                'there', 'these', 'those', 'through', 'using', 'which', 'where', 'while',
                'with', 'within', 'would', 'solve', 'solving', 'apply', 'applications',
                'reason', 'concept', 'example', 'examples', 'application', 'understanding', 'knowledge',
                'real', 'world', 'life', 'everyday', 'mathematical', 'mathematics', 'information',
                'data', 'make', 'ability', 'appropriate', 'contribute', 'discussions',
                'problem', 'investigation',
            ];
            $tokens = array_map(static function (string $token): string {
                if (mb_strlen($token, 'UTF-8') > 7 && str_ends_with($token, 'ity')) {
                    $token = mb_substr($token, 0, -3, 'UTF-8');
                } elseif (mb_strlen($token, 'UTF-8') > 7 && str_ends_with($token, 'ion')) {
                    $token = mb_substr($token, 0, -3, 'UTF-8');
                } elseif (mb_strlen($token, 'UTF-8') > 6 && str_ends_with($token, 'ing')) {
                    $token = mb_substr($token, 0, -3, 'UTF-8');
                } elseif (mb_strlen($token, 'UTF-8') > 5 && str_ends_with($token, 's')) {
                    $token = mb_substr($token, 0, -1, 'UTF-8');
                }
                if (mb_strlen($token, 'UTF-8') > 6 && str_ends_with($token, 'al')) {
                    $token = mb_substr($token, 0, -2, 'UTF-8');
                }
                return $token;
            }, $matches[0] ?? []);
            return array_values(array_diff($tokens, $stopWords));
        };
        $normalizeCurriculumLabel = static fn(string $text): string =>
            preg_replace('/\s+/u', ' ', mb_strtolower(trim($text), 'UTF-8')) ?? '';
        $curriculumEntryText = static function (array $section): string {
            $title = trim((string)($section['title'] ?? ''));
            $body = trim((string)($section['body'] ?? ''));
            $chunk = trim((string)($section['chunk_content'] ?? ''));
            $title = preg_replace(
                '/\s+(?:introduction and section summary|summary of pedagogical exemplars)\b.*$/iu',
                '',
                $title
            ) ?? $title;
            $titleWords = preg_split('/\s+/u', $title, -1, PREG_SPLIT_NO_EMPTY);
            if ($chunk !== '' && $titleWords !== []) {
                $titlePattern = implode('\\s+', array_map(
                    static fn(string $word): string => preg_quote($word, '/'),
                    $titleWords
                ));
                if (preg_match('/' . $titlePattern . '/iu', $chunk, $match, PREG_OFFSET_CAPTURE) === 1) {
                    $remainder = substr($chunk, $match[0][1] + strlen($match[0][0]));
                    $continuationLines = preg_split('/\R/u', $remainder) ?: [];
                    $continuation = [];
                    foreach ($continuationLines as $line) {
                        $line = trim($line);
                        if ($line === '' && $continuation === []) {
                            continue;
                        }
                        if ($line === '' || preg_match(
                            '/^(?:weeks?\s+\d|content\s+standard\s*:|learning\s+(?:outcome|indicator|objective)\s*:|focal\s+area\b|topic\s*:|strand\s*:|sub[\s-]*strand\s*:|introduction and section summary\b|summary of pedagogical exemplars\b|introduction\b|section\s+\d+\s*:)/iu',
                            $line
                        ) === 1) {
                            break;
                        }
                        $continuation[] = $line;
                        if (mb_strlen(implode(' ', $continuation), 'UTF-8') >= 500) {
                            break;
                        }
                    }
                    $body = trim($body . ' ' . implode(' ', $continuation));
                }
            }
            return trim($title . ' ' . $body);
        };
        $isRelatedCurriculumEntry = static function (array $section, array $lesson) use (
            $curriculumTokens,
            $curriculumEntryText,
            &$sectionsById
        ): int|bool {
            $type = strtolower((string)($section['section_type'] ?? ''));
            $source = trim((string)($section['title'] ?? '') . ' ' . (string)($section['body'] ?? ''));
            if (!in_array($type, ['content_standard', 'learning_indicator', 'learning_outcome', 'learning_objective', 'focal_area'], true)
                && preg_match('/^\s*(?:content[\s_-]*standard|learning[\s_-]*(?:indicator|outcome|objective))\s*(?:[:#-]|\d|\b)/iu', $source) !== 1) {
                return false;
            }
            if ($type === 'content_standard') {
                $parentId = (int)($section['parent_id'] ?? 0);
                $parent = $sectionsById[$parentId] ?? null;
                if ($parent !== null && strtolower((string)$parent['section_type']) === 'learning_outcome') {
                    $source .= "\n" . $curriculumEntryText($parent);
                }
            }
            $context = (string)$lesson['topic'] . "\n" . implode("\n", $lesson['focal_areas']);
            $contextTokens = array_unique($curriculumTokens($context));
            $entryTokens = array_unique($curriculumTokens($source));
            $overlap = count(array_intersect($contextTokens, $entryTokens));
            if ($type === 'focal_area') {
                return $overlap >= 2;
            }
            if (in_array($type, ['learning_indicator', 'learning_outcome', 'learning_objective'], true)) {
                $union = count(array_unique([...$contextTokens, ...$entryTokens]));
                $sameSourcePage = !empty($lesson['source_page'])
                    && (int)($section['page_number'] ?? 0) === (int)$lesson['source_page'];
                return ($overlap >= 2 && $overlap / max(1, $union) >= 0.45)
                    || ($sameSourcePage && $overlap >= 1);
            }
            return $type === 'content_standard' ? $overlap : $overlap >= 2;
        };
        foreach ($lessons as $lesson) {
            $relatedCurriculumParents = [];
            $relatedCurriculumPages = [];
            foreach ($sectionsById as $sectionId => $section) {
                if ((int)$section['document_id'] !== (int)$lesson['document_id']
                    || !in_array(strtolower((string)$section['section_type']), [
                        'content_standard', 'learning_indicator', 'learning_outcome', 'learning_objective',
                    ], true)
                    || !$isRelatedCurriculumEntry($section, $lesson)) {
                    continue;
                }
                $relatedCurriculumParents[(int)$sectionId] = true;
                $parentId = (int)($section['parent_id'] ?? 0);
                if ($parentId > 0) {
                    $relatedCurriculumParents[$parentId] = true;
                }
                $page = (int)($section['page_number'] ?? 0);
                if ($page > 10) {
                    $relatedCurriculumPages[$page] = true;
                }
            }
            $focalAreaMatchScore = static function (array $section) use (
                $lesson,
                $relatedCurriculumParents,
                $relatedCurriculumPages,
                $isRelatedCurriculumEntry,
                $curriculumTokens
            ): float {
                $focusCategory = static function (string $token): ?string {
                    foreach ([
                        'calculation' => ['calculat'],
                        'comparison' => ['compar'],
                        'equilibrium' => ['equilibr'],
                        'factors' => ['factor'],
                        'importance' => ['import'],
                        'introduction' => ['introduc'],
                        'objectives' => ['objectiv'],
                        'representation' => ['mathemat', 'represent'],
                    ] as $category => $prefixes) {
                        foreach ($prefixes as $prefix) {
                            if (str_starts_with($token, $prefix)) {
                                return $category;
                            }
                        }
                    }
                    return null;
                };
                $page = (int)($section['page_number'] ?? 0);
                if ($page <= 10 || !$isRelatedCurriculumEntry($section, $lesson)) {
                    return 0.0;
                }
                $parentId = (int)($section['parent_id'] ?? 0);
                $nearSourcePage = !empty($lesson['source_page'])
                    && abs($page - (int)$lesson['source_page']) <= 3;
                $nearRelatedCurriculumPage = false;
                foreach (array_keys($relatedCurriculumPages) as $relatedPage) {
                    if (abs($page - (int)$relatedPage) <= 3) {
                        $nearRelatedCurriculumPage = true;
                        break;
                    }
                }
                if (!$nearSourcePage && !$nearRelatedCurriculumPage
                    && !isset($relatedCurriculumParents[$parentId])) {
                    return 0.0;
                }
                $topicTokens = array_unique($curriculumTokens((string)$lesson['topic']));
                $areaTokens = array_unique($curriculumTokens((string)$section['title']));
                $topicCategories = array_values(array_filter(array_map($focusCategory, $topicTokens)));
                $areaCategories = array_values(array_filter(array_map($focusCategory, $areaTokens)));
                if ($topicCategories !== [] && $areaCategories !== []
                    && array_intersect($topicCategories, $areaCategories) === []) {
                    return 0.0;
                }
                $overlap = count(array_intersect($topicTokens, $areaTokens));
                if ($overlap < 2) {
                    return 0.0;
                }
                return $overlap / max(1, min(count($topicTokens), count($areaTokens)));
            };
            $relatedFocalAreaIds = [];
            foreach ($sectionsById as $sectionId => $section) {
                if ((int)$section['document_id'] === (int)$lesson['document_id']
                    && strtolower((string)$section['section_type']) === 'focal_area'
                    && $focalAreaMatchScore($section) >= 0.5) {
                    $relatedFocalAreaIds[(int)$sectionId] = true;
                }
            }
            $directIds = !empty($lesson['source_chunk_id'])
                ? ($sectionsByChunk[(int)$lesson['source_chunk_id']] ?? [])
                : [];
            if ($directIds === [] && !empty($lesson['source_page'])) {
                $pageKey = (int)$lesson['document_id'] . ':' . (int)$lesson['source_page'];
                $directIds = $sectionsByPage[$pageKey] ?? [];
            }
            $weeklyFocalAreas = array_map($normalizeCurriculumLabel, $lesson['focal_areas']);
            $directIds = array_values(array_filter($directIds, static function (int $sectionId) use (
                $sectionsById,
                $lesson,
                $weeklyFocalAreas,
                $normalizeCurriculumLabel,
                $isRelatedCurriculumEntry,
                $relatedFocalAreaIds
            ): bool {
                $section = $sectionsById[$sectionId] ?? null;
                if ($section === null) {
                    return false;
                }
                if (strtolower((string)$section['section_type']) === 'focal_area') {
                    return in_array($normalizeCurriculumLabel((string)$section['title']), $weeklyFocalAreas, true)
                        || isset($relatedFocalAreaIds[$sectionId]);
                }
                if (in_array(strtolower((string)$section['section_type']), [
                    'content_standard', 'learning_indicator', 'learning_outcome', 'learning_objective',
                ], true)) {
                    return $isRelatedCurriculumEntry($section, $lesson) > 0;
                }
                return true;
            }));
            if (!empty($lesson['source_page'])) {
                for ($page = max(1, (int)$lesson['source_page'] - 3); $page <= (int)$lesson['source_page'] + 3; $page++) {
                    $pageKey = (int)$lesson['document_id'] . ':' . $page;
                    foreach ($sectionsByPage[$pageKey] ?? [] as $sectionId) {
                        $section = $sectionsById[(int)$sectionId] ?? null;
                        if ($section !== null
                            && !in_array(strtolower((string)$section['section_type']), [
                                'content_standard', 'strand', 'sub_strand', 'focal_area',
                            ], true)
                            && $isRelatedCurriculumEntry($section, $lesson)) {
                            $directIds[] = (int)$sectionId;
                        }
                    }
                }
            }
            $relatedStandards = [];
            $bestStandardOverlap = 0;
            foreach ($sectionsById as $sectionId => $section) {
                if ((int)$section['document_id'] !== (int)$lesson['document_id']) {
                    continue;
                }
                if (strtolower((string)$section['section_type']) === 'content_standard') {
                    $overlap = $isRelatedCurriculumEntry($section, $lesson);
                    if ($overlap > $bestStandardOverlap) {
                        $relatedStandards = [(int)$sectionId];
                        $bestStandardOverlap = $overlap;
                    } elseif ($overlap > 0 && $overlap === $bestStandardOverlap) {
                        $relatedStandards[] = (int)$sectionId;
                    }
                } elseif (strtolower((string)$section['section_type']) === 'focal_area'
                    ? isset($relatedFocalAreaIds[(int)$sectionId])
                    : $isRelatedCurriculumEntry($section, $lesson)) {
                    $directIds[] = (int)$sectionId;
                }
            }
            array_push($directIds, ...$relatedStandards);
            $directIds = array_values(array_unique($directIds));
            $directIdsByLesson[(int)$lesson['id']] = $directIds;
            $relatedFocalAreaIdsByLesson[(int)$lesson['id']] = $relatedFocalAreaIds;
            foreach ($directIds as $sectionId) {
                $section = $sectionsById[(int)$sectionId] ?? null;
                if ($section !== null && $isWeekScopeAnchor($section)) {
                    $scopeParents[(int)$sectionId] = (int)$section['document_id'];
                }
            }
        }

        $childrenByParent = [];
        $pendingChildren = $scopeParents;
        for ($depth = 0; $depth < 8 && $pendingChildren !== []; $depth++) {
            $childConditions = [];
            $childParameters = [];
            foreach ($pendingChildren as $parentId => $documentId) {
                $parentKey = 'child_parent_' . count($childConditions);
                $documentKey = 'child_document_' . count($childConditions);
                $childConditions[] = '(s.parent_id = :' . $parentKey . ' AND s.document_id = :' . $documentKey . ')';
                $childParameters[$parentKey] = $parentId;
                $childParameters[$documentKey] = $documentId;
            }
            $children = $pdo->prepare(
                $sectionSelect . ' AND (' . implode(' OR ', $childConditions) . ') ORDER BY s.page_number, s.id'
            );
            $children->execute($childParameters);
            $nextChildren = [];
            foreach ($children->fetchAll() as $child) {
                $child = $this->sanitizeUtf8Values($child);
                $childId = (int)$child['id'];
                $parentId = (int)$child['parent_id'];
                $childrenByParent[$parentId][] = $childId;
                $sectionsById[$childId] = $child;
                $nextChildren[$childId] = (int)$child['document_id'];
            }
            $pendingChildren = $nextChildren;
        }

        foreach ($lessons as &$lesson) {
            $includedIds = [];
            $directIds = $directIdsByLesson[(int)$lesson['id']] ?? [];
            $queue = $directIds;
            while ($queue !== []) {
                $sectionId = (int)array_pop($queue);
                if (isset($includedIds[$sectionId])) {
                    continue;
                }
                if (!isset($sectionsById[$sectionId])) {
                    continue;
                }
                $includedIds[$sectionId] = true;
                $parentId = (int)($sectionsById[$sectionId]['parent_id'] ?? 0);
                if ($parentId > 0 && isset($sectionsById[$parentId])) {
                    $queue[] = $parentId;
                }
            }
            $descendants = [];
            foreach ($directIds as $sectionId) {
                if (isset($scopeParents[(int)$sectionId])) {
                    $descendants[] = (int)$sectionId;
                }
            }
            while ($descendants !== []) {
                $parentId = array_pop($descendants);
                foreach ($childrenByParent[$parentId] ?? [] as $childId) {
                    if (isset($includedIds[$childId])) {
                        continue;
                    }
                    $includedIds[$childId] = true;
                    $descendants[] = $childId;
                }
            }
            $entries = array_intersect_key($sectionsById, $includedIds);
            $weeklyFocalAreas = array_map($normalizeCurriculumLabel, $lesson['focal_areas']);
            $relatedFocalAreaIds = $relatedFocalAreaIdsByLesson[(int)$lesson['id']] ?? [];
            $entries = array_filter($entries, static function (array $entry) use (
                $lesson,
                $weeklyFocalAreas,
                $normalizeCurriculumLabel,
                $isRelatedCurriculumEntry,
                $relatedFocalAreaIds
            ): bool {
                $type = strtolower((string)$entry['section_type']);
                if (in_array($type, ['strand', 'sub_strand'], true)) {
                    return true;
                }
                if ($type === 'focal_area') {
                    return in_array($normalizeCurriculumLabel((string)$entry['title']), $weeklyFocalAreas, true)
                        || isset($relatedFocalAreaIds[(int)$entry['id']]);
                }
                if (in_array($type, [
                    'content_standard', 'learning_indicator', 'learning_outcome', 'learning_objective',
                ], true)) {
                    return $isRelatedCurriculumEntry($entry, $lesson) > 0;
                }
                return $type === 'topic'
                    && $normalizeCurriculumLabel((string)$entry['title'])
                        === $normalizeCurriculumLabel((string)$lesson['topic']);
            });
            usort($entries, static fn(array $left, array $right): int =>
                [(int)($left['page_number'] ?? 0), (int)$left['id']]
                <=> [(int)($right['page_number'] ?? 0), (int)$right['id']]
            );
            $deduplicatedEntries = [];
            foreach ($entries as $entry) {
                if (in_array(strtolower((string)$entry['section_type']), [
                    'content_standard', 'learning_indicator', 'learning_outcome', 'learning_objective',
                ], true)) {
                    $entry['title'] = $curriculumEntryText($entry);
                    $entry['body'] = null;
                }
                unset($entry['chunk_content']);
                $entryType = strtolower((string)$entry['section_type']);
                $entryTitle = $normalizeCurriculumLabel((string)$entry['title']);
                $isShorterDuplicate = false;
                foreach ($deduplicatedEntries as $index => $existingEntry) {
                    if (strtolower((string)$existingEntry['section_type']) !== $entryType) {
                        continue;
                    }
                    $existingTitle = $normalizeCurriculumLabel((string)$existingEntry['title']);
                    if ($entryTitle === $existingTitle || str_starts_with($entryTitle, $existingTitle)) {
                        $deduplicatedEntries[$index] = $entry;
                        $isShorterDuplicate = true;
                        break;
                    }
                    if (str_starts_with($existingTitle, $entryTitle)) {
                        $isShorterDuplicate = true;
                        break;
                    }
                }
                if (!$isShorterDuplicate) {
                    $deduplicatedEntries[] = $entry;
                }
            }
            $entries = $deduplicatedEntries;
            $entryKeys = [];
            foreach ($entries as $entry) {
                $entryKeys[strtolower((string)$entry['section_type']) . ':' . $normalizeCurriculumLabel((string)$entry['title'])] = true;
            }
            foreach ([
                'learning_indicator' => $lesson['learning_indicators'] ?? [],
                'learning_outcome' => $lesson['learning_outcomes'] ?? [],
            ] as $type => $targets) {
                foreach ($targets as $index => $target) {
                    $target = trim((string)$target);
                    $key = $type . ':' . $normalizeCurriculumLabel($target);
                    if ($target === '' || isset($entryKeys[$key])) {
                        continue;
                    }
                    $entries[] = [
                        'id' => 'weekly-' . $type . '-' . (int)$lesson['id'] . '-' . (int)$index,
                        'parent_id' => null,
                        'document_id' => (int)$lesson['document_id'],
                        'source_chunk_id' => (int)($lesson['source_chunk_id'] ?? 0),
                        'section_type' => $type,
                        'code' => null,
                        'title' => $target,
                        'body' => null,
                        'page_number' => $lesson['source_page'] ?? null,
                        'document_title' => $lesson['source_title'] ?? '',
                        'source_reference' => $lesson['source_reference'] ?? '',
                        'source_url' => $lesson['source_url'] ?? '',
                    ];
                    $entryKeys[$key] = true;
                }
            }
            foreach ([
                'focal_area' => 'focal_areas',
                'learning_indicator' => 'learning_indicators',
                'learning_outcome' => 'learning_outcomes',
            ] as $type => $field) {
                $matchedValues = array_map(
                    static fn(array $entry): string => trim((string)$entry['title']),
                    array_filter(
                        $entries,
                        static fn(array $entry): bool => strtolower((string)$entry['section_type']) === $type
                    )
                );
                $lesson[$field] = array_values(array_unique([
                    ...$lesson[$field],
                    ...array_filter($matchedValues, static fn(string $value): bool => $value !== ''),
                ]));
            }
            $lesson['curriculum_entries'] = array_values($entries);
        }
        unset($lesson);
        return $lessons;
    }

    private function isUsableWeeklyTopic(string $topic): bool
    {
        $topic = trim(preg_replace('/\s+/u', ' ', $topic) ?? '');
        if (mb_strlen($topic, 'UTF-8') < 3 || mb_strlen($topic, 'UTF-8') > 500
            || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F<>]/u', $topic)
            || preg_match('/(?:mark(?:ing)?\s+schemes?|mark\s+scheme|sample examination|practice examination|mock examination|question\s*(?:one|\d+)|mcqs?|solutions?|competencies and identify areas requiring remediation|learning indicators?|recommended mode of assessment|assessment mode)\b/i', $topic)
            || preg_match('/^(?:topics?|strands?|sub[\s_-]*strands?|focal areas?|content standards?|weekly plans?|learning outcomes?|learning indicators?|assessment|instructions?|references?)\s*$/iu', $topic)
            || !preg_match('/[\p{L}]{3,}/u', $topic)
            || preg_match('/^(?:[\d\s.,-]+)$/u', $topic)) {
            return false;
        }
        return true;
    }

    private function decodeWeeklyTargets(mixed $targets): array
    {
        if ($targets === null || $targets === '') {
            return [];
        }
        $decoded = json_decode((string)$targets, true, 16, JSON_THROW_ON_ERROR);
        if (!is_array($decoded) || array_filter($decoded, 'is_string') !== $decoded) {
            throw new \RuntimeException('A verified weekly lesson contains invalid learning-target data.', 500);
        }
        $cleaned = array_map(static function (string $target): string {
            $target = trim(preg_replace(
                '/\s*INTRODUCTION\s+AND\s+SECTION\s+SUMMARY\s*$/iu',
                '',
                $target
            ) ?? $target);
            return preg_replace('/\s+/u', ' ', $target) ?? $target;
        }, $decoded);
        return array_values(array_unique(array_filter($cleaned, static fn(string $target): bool => $target !== '')));
    }

    private function weeklyTopicSupportScore(string $topic, array $focalAreas, array $indicators, array $outcomes): float
    {
        $stopWords = array_fill_keys([
            'about', 'after', 'also', 'and', 'are', 'based', 'between', 'from', 'given',
            'into', 'their', 'these', 'those', 'through', 'using', 'which', 'with',
        ], true);
        $tokens = static function (string $text) use ($stopWords): array {
            preg_match_all('/[\p{L}\p{N}]{4,}/u', mb_strtolower($text, 'UTF-8'), $matches);
            return array_values(array_unique(array_filter(
                $matches[0] ?? [],
                static fn(string $word): bool => !isset($stopWords[$word])
            )));
        };
        $topicTokens = $tokens($topic);
        if (count($topicTokens) < 2) {
            return 0.0;
        }
        $score = 0.0;
        foreach ([...$focalAreas, ...$indicators, ...$outcomes] as $target) {
            $targetTokens = $tokens((string)$target);
            $overlap = count(array_intersect($topicTokens, $targetTokens));
            if ($overlap < 2) {
                continue;
            }
            $score = max($score, $overlap / max(1, min(count($topicTokens), count($targetTokens))));
        }
        return $score;
    }

    private function filterWeeklyFocalAreas(string $topic, array $focalAreas): array
    {
        return array_values(array_unique(array_filter(
            $this->cleanWeeklyFocalAreas($focalAreas),
            fn(string $focalArea): bool => $this->weeklyTopicSupportScore($topic, [$focalArea], [], []) >= 0.5
        )));
    }

    private function cleanWeeklyFocalAreas(array $focalAreas): array
    {
        return array_values(array_unique(array_filter(
            array_map(
                static fn(string $focalArea): string => trim(preg_replace(
                    '/^\s*\d+\s+(?=[\p{L}])/u',
                    '',
                    $focalArea
                ) ?? $focalArea),
                $focalAreas
            ),
            static fn(string $focalArea): bool => $focalArea !== ''
        )));
    }

    public function verifiedWeeklyLessonSourceChunk(int $documentId, int $chunkId): ?array
    {
        if ($documentId < 1 || $chunkId < 1) {
            throw new \RuntimeException('A valid weekly curriculum source is required.', 422);
        }
        $statement = Connection::get()->prepare(
            "SELECT c.id AS chunk_id, c.page_start, c.content,
                    d.id AS document_id, d.title, d.title AS source_title, d.source_reference,
                    d.source_url, d.year_group, d.subject_name, s.publisher
             FROM curriculum_chunks c
             JOIN curriculum_documents d ON d.id = c.document_id
             LEFT JOIN curriculum_sources s ON s.id = d.source_id
             WHERE c.id = :chunk_id
               AND d.id = :document_id
               AND d.review_status = 'verified'
               AND d.is_enabled = 1
               AND d.extraction_status = 'extracted'
               AND (
                   d.resource_role IN ('teacher_manual', 'learner_material', 'curriculum')
                   OR (d.resource_role = 'other' AND EXISTS (
                       SELECT 1 FROM curriculum_weekly_lessons lesson
                       WHERE lesson.document_id = d.id
                         AND lesson.source_chunk_id = c.id
                         AND lesson.review_status = 'verified'
                   ))
               )
             LIMIT 1"
        );
        $statement->execute(['document_id' => $documentId, 'chunk_id' => $chunkId]);
        $reference = $statement->fetch();
        return $reference ? $this->sanitizeUtf8Values($reference) : null;
    }

    public function verifiedWeeklySourceChunks(string $subject, string $yearGroup, int $limit = 10): array
    {
        $subject = trim($subject);
        if ($subject === '' || mb_strlen($subject) > 190 || !in_array($yearGroup, ['SHS1', 'SHS2', 'SHS3'], true)) {
            throw new \RuntimeException('Choose a subject and valid SHS year.', 422);
        }
        $limit = max(1, min(12, $limit));
        $parameters = ['year_group' => $yearGroup];
        $subjectCondition = $this->subjectDocumentCondition($subject, 'd', $parameters);
        $statement = Connection::get()->prepare(
            "SELECT c.id AS chunk_id, c.page_start, c.content,
                    d.id AS document_id, d.title AS source_title, d.source_reference, d.source_url,
                    d.resource_role, d.year_group, d.subject_name
             FROM curriculum_chunks c
             JOIN curriculum_documents d ON d.id = c.document_id
             WHERE d.review_status = 'verified'
               AND d.is_enabled = 1
               AND d.extraction_status = 'extracted'
               AND (
                   d.resource_role IN ('teacher_manual', 'learner_material', 'curriculum')
                   OR (d.resource_role = 'other' AND EXISTS (
                       SELECT 1 FROM curriculum_weekly_lessons lesson
                       WHERE lesson.document_id = d.id
                         AND lesson.source_chunk_id = c.id
                         AND lesson.review_status = 'verified'
                   ))
               )
               AND FIND_IN_SET(:year_group, d.year_group) > 0
               AND {$subjectCondition}
               AND (
                    LOWER(c.content) LIKE '%week%'
                    OR LOWER(c.content) LIKE '%focal area%'
                    OR LOWER(c.content) LIKE '%assessment schedule%'
                    OR LOWER(c.content) LIKE '%topic%'
               )
             ORDER BY
               CASE
                 WHEN LOWER(c.content) LIKE '%week%' AND LOWER(c.content) LIKE '%focal area%' THEN 0
                 WHEN LOWER(c.content) LIKE '%week%' THEN 1
                 WHEN LOWER(c.content) LIKE '%focal area%' THEN 2
                 ELSE 3
               END,
               CASE d.resource_role WHEN 'teacher_manual' THEN 0 WHEN 'curriculum' THEN 1 ELSE 2 END,
               d.updated_at DESC, c.chunk_index
             LIMIT {$limit}"
        );
        $statement->execute($parameters);
        return array_map(fn(array $row): array => $this->sanitizeUtf8Values($row), $statement->fetchAll());
    }

    public function verifiedAssessmentTopics(array $sectionIds, string $subject): array
    {
        $ids = array_values(array_unique(array_filter(
            array_map(static fn(mixed $id): int => filter_var($id, FILTER_VALIDATE_INT) ?: 0, $sectionIds),
            static fn(int $id): bool => $id > 0
        )));
        if ($ids === [] || count($ids) > 30) {
            throw new \RuntimeException('Choose between 1 and 30 reviewed curriculum topics.', 422);
        }
        $placeholders = [];
        $parameters = [];
        foreach ($ids as $index => $id) {
            $key = 'section_' . $index;
            $placeholders[] = ':' . $key;
            $parameters[$key] = $id;
        }
        $subjectCondition = $this->subjectDocumentCondition($subject, 'd', $parameters);
        $statement = Connection::get()->prepare(
            "SELECT DISTINCT c.id AS chunk_id, c.content, c.page_start,
                    d.id AS document_id, d.title, d.year_group, d.subject_name,
                    d.resource_role, d.version_label, d.source_reference, d.source_url,
                    s.publisher, s.source_kind,
                    section.id AS selected_section_id, section.section_type, section.title AS selected_title,
                    section.body AS selected_details, parent.title AS parent_title
             FROM curriculum_sections section
             JOIN curriculum_documents d ON d.id = section.document_id
             JOIN curriculum_chunks c ON c.id = section.source_chunk_id
             LEFT JOIN curriculum_sections parent ON parent.id = section.parent_id
             LEFT JOIN curriculum_sources s ON s.id = d.source_id
             WHERE section.id IN (" . implode(', ', $placeholders) . ")
               AND section.review_status = 'verified'
               AND (section.ai_generated = 0 OR section.review_notes LIKE 'Admin verified section type:%')
               AND d.review_status = 'verified'
               AND d.is_enabled = 1
               AND d.extraction_status = 'extracted'
               AND {$subjectCondition}
             ORDER BY d.year_group, section.page_number, section.id"
        );
        $statement->execute($parameters);
        $rows = array_map(fn(array $row): array => $this->sanitizeUtf8Values($row), $statement->fetchAll());
        $matchedIds = array_unique(array_map(static fn(array $row): int => (int)$row['selected_section_id'], $rows));
        if (count($matchedIds) !== count($ids)) {
            throw new \RuntimeException('One or more selected curriculum topics are no longer verified for this subject.', 422);
        }
        return $rows;
    }

    public function indexVerifiedDocumentChunks(int $documentId): void
    {
        $this->indexVerifiedResourceChunks(null, '', $documentId);
    }

    private function subjectDocumentCondition(string $subject, string $documentAlias, array &$parameters): string
    {
        $normalized = $this->normalizeSubject($subject);
        $variants = match ($normalized) {
            'additional mathematics', 'additional maths' => ['additional mathematics', 'additional maths'],
            'mathematics', 'maths' => ['mathematics', 'maths'],
            default => [$normalized],
        };
        $checks = [];
        foreach ($variants as $index => $variant) {
            $subjectKey = 'subject_name_' . $index;
            $titleKey = 'subject_title_' . $index;
            $parameters[$subjectKey] = $variant;
            $parameters[$titleKey] = ' ' . $variant . ' ';
            $subjectName = $this->normalizedSubjectSql("COALESCE({$documentAlias}.subject_name, '')");
            $title = $this->normalizedSubjectSql("{$documentAlias}.title");
            $paddedTitle = "CONCAT(' ', TRIM({$title}), ' ')";
            $checks[] = "TRIM({$subjectName}) = :{$subjectKey}";
            $checks[] = '(LOCATE(:' . $titleKey . ', ' . $paddedTitle . ') > 0)';
        }
        $condition = '(' . implode(' OR ', $checks) . ')';
        if (in_array($normalized, ['mathematics', 'maths'], true)) {
            $title = $this->normalizedSubjectSql("{$documentAlias}.title");
            $paddedTitle = "CONCAT(' ', TRIM({$title}), ' ')";
            $condition = '(' . $condition
                . " AND LOCATE(' additional mathematics ', {$paddedTitle}) = 0"
                . " AND LOCATE(' additional maths ', {$paddedTitle}) = 0)";
        }
        return $condition;
    }

    private function normalizeSubject(string $subject): string
    {
        $subject = preg_replace('/\s*\([A-Z][A-Z0-9]{1,7}\)\s*/u', ' ', $subject) ?? $subject;
        return trim(preg_replace('/\s+/u', ' ', preg_replace('/[^\p{L}\p{N}]+/u', ' ', mb_strtolower(trim($subject), 'UTF-8')) ?? '') ?? '');
    }

    private function normalizedSubjectSql(string $expression): string
    {
        $normalized = "LOWER({$expression})";
        foreach (['-', '_', '.', '/', '\\\\', '(', ')', '[', ']', '{', '}', ',', '&', '+', ':', ';', "'", '"'] as $separator) {
            $escapedSeparator = str_replace("'", "''", $separator);
            $normalized = "REPLACE({$normalized}, '{$escapedSeparator}', ' ')";
        }
        for ($index = 0; $index < 4; $index++) {
            $normalized = "REPLACE({$normalized}, '  ', ' ')";
        }
        return $normalized;
    }

    private function indexVerifiedResourceChunks(?string $yearGroup, string $subject, ?int $documentId = null): void
    {
        if ($documentId === null && trim($subject) === '') {
            return;
        }
        $parameters = [];
        $filters = ["d.review_status = 'verified'", 'd.is_enabled = 1', "d.extraction_status = 'extracted'"];
        if ($documentId !== null) {
            $filters[] = 'd.id = :index_document_id';
            $parameters['index_document_id'] = $documentId;
        }
        if ($yearGroup !== null && $yearGroup !== '') {
            $filters[] = 'FIND_IN_SET(:index_year_group, d.year_group) > 0';
            $parameters['index_year_group'] = $yearGroup;
        }
        if ($subject !== '') {
            $filters[] = $this->subjectDocumentCondition($subject, 'd', $parameters);
        }
        $pdo = Connection::get();
        $where = implode(' AND ', $filters);
        $ownsTransaction = !$pdo->inTransaction();
        if ($ownsTransaction) {
            $pdo->beginTransaction();
        }
        try {
            $documentLocks = $pdo->prepare("SELECT d.id FROM curriculum_documents d WHERE {$where} ORDER BY d.id FOR UPDATE");
            $documentLocks->execute($parameters);
            $documentLocks->fetchAll();
            $update = $pdo->prepare(
                "UPDATE curriculum_sections section
                 JOIN curriculum_documents d ON d.id = section.document_id
                 SET section.review_status = 'verified',
                     section.verified_by = d.verified_by,
                     section.verified_at = d.verified_at,
                     section.review_notes = COALESCE(section.review_notes, 'Available because the administrator verified the complete source resource.')
                 WHERE {$where}
                   AND section.ai_generated = 0
                   AND section.review_status IN ('unreviewed', 'in_review')"
            );
            $update->execute($parameters);
            $shortTitles = $pdo->prepare(
                "SELECT section.id, chunk.content, chunk.page_start
                 FROM curriculum_sections section
                 JOIN curriculum_chunks chunk ON chunk.id = section.source_chunk_id
                 JOIN curriculum_documents d ON d.id = section.document_id
                 WHERE {$where}
                   AND section.section_type = 'section'
                   AND section.review_notes = 'Indexed directly from the administrator-verified source resource.'
                   AND CHAR_LENGTH(section.title) < 15"
            );
            $shortTitles->execute($parameters);
            $refreshTitle = $pdo->prepare('UPDATE curriculum_sections SET title = :title WHERE id = :id');
            foreach ($shortTitles->fetchAll() as $shortTitle) {
                $refreshTitle->execute([
                    'title' => $this->resourceChunkTitle((string)$shortTitle['content'], $shortTitle['page_start'] === null ? null : (int)$shortTitle['page_start']),
                    'id' => (int)$shortTitle['id'],
                ]);
            }
            $chunks = $pdo->prepare(
                'SELECT c.id, c.document_id, c.page_start, c.content
                 FROM curriculum_chunks c
                 JOIN curriculum_documents d ON d.id = c.document_id
                 WHERE ' . $where . '
                   AND NOT EXISTS (
                       SELECT 1 FROM curriculum_sections existing
                       WHERE existing.source_chunk_id = c.id AND existing.document_id = d.id
                   )
                 ORDER BY d.id, c.chunk_index'
            );
            $chunks->execute($parameters);
            $rows = $chunks->fetchAll();
            $insert = $pdo->prepare(
                "INSERT INTO curriculum_sections
                 (document_id, section_type, source_chunk_id, ai_generated, title, body, page_number,
                  review_status, verified_by, verified_at, review_notes)
                 SELECT :document_id, 'section', :chunk_id, 0, :title, :body, :page_number,
                        'verified', d.verified_by, d.verified_at, 'Indexed directly from the administrator-verified source resource.'
                 FROM curriculum_documents d
                 WHERE d.id = :source_document AND d.review_status = 'verified'
                    AND d.is_enabled = 1
                    AND d.extraction_status = 'extracted'
                   AND NOT EXISTS (
                       SELECT 1 FROM curriculum_sections existing
                       WHERE existing.source_chunk_id = :existing_chunk AND existing.document_id = d.id
                   )"
            );
            foreach ($rows as $row) {
                $content = trim(mb_convert_encoding((string)$row['content'], 'UTF-8', 'UTF-8'));
                $insert->execute([
                    'document_id' => (int)$row['document_id'],
                    'chunk_id' => (int)$row['id'],
                    'title' => $this->resourceChunkTitle($content, $row['page_start'] === null ? null : (int)$row['page_start']),
                    'body' => mb_substr($content, 0, 12000, 'UTF-8'),
                    'page_number' => $row['page_start'] === null ? null : (int)$row['page_start'],
                    'source_document' => (int)$row['document_id'],
                    'existing_chunk' => (int)$row['id'],
                ]);
            }
            if ($ownsTransaction) {
                $pdo->commit();
            }
        } catch (\Throwable $exception) {
            if ($ownsTransaction && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
    }

    private function resourceChunkTitle(string $content, ?int $pageNumber): string
    {
        $lines = preg_split('/\R/u', $content) ?: [];
        $boilerplate = ['minist', 'republic of ghana', 'senior high', 'writers', 'reviewer', 'mathematics association', 'teacher manual'];
        foreach ([true, false] as $uppercasePass) {
            foreach ($lines as $index => $line) {
                $candidate = trim(preg_replace('/^\s*(?:#{1,6}\s*|[-*•]\s*|\d+[.)]\s*)/u', '', $line) ?? '');
                $candidate = trim(preg_replace('/\s+/u', ' ', $candidate) ?? '');
                if (mb_strlen($candidate, 'UTF-8') < 8 || preg_match('/^[|:\-\s]+$/u', $candidate)) {
                    continue;
                }
                $lower = mb_strtolower($candidate, 'UTF-8');
                if (array_filter($boilerplate, static fn(string $phrase): bool => str_contains($lower, $phrase)) !== []) {
                    continue;
                }
                $uppercase = mb_strtoupper($candidate, 'UTF-8') === $candidate;
                if ($uppercase !== $uppercasePass) {
                    continue;
                }
                if ($uppercase) {
                    $words = preg_split('/\s+/u', $candidate) ?: [];
                    $shortWords = count(array_filter($words, static fn(string $word): bool => mb_strlen($word, 'UTF-8') <= 2));
                    if (mb_strlen($candidate, 'UTF-8') < 20
                        || $shortWords >= max(2, (int)ceil(count($words) / 2))) {
                        continue;
                    }
                }
                if (count(preg_split('/\s+/u', $candidate) ?: []) === 1 && isset($lines[$index + 1])) {
                    $next = trim(preg_replace('/\s+/u', ' ', $lines[$index + 1]) ?? '');
                    if (mb_strlen($next, 'UTF-8') >= 4 && mb_strlen($next, 'UTF-8') <= 40
                        && preg_match('/[\p{L}\p{N}]/u', $next)
                        && !array_filter($boilerplate, static fn(string $phrase): bool => str_contains(mb_strtolower($next, 'UTF-8'), $phrase))) {
                        $candidate .= ' ' . $next;
                    }
                }
                return mb_substr($candidate, 0, 440, 'UTF-8');
            }
        }
        return $pageNumber === null
            ? 'Verified resource content'
            : 'Verified resource content · page ' . $pageNumber;
    }

    public function search(
        string $query,
        ?string $yearGroup = null,
        int $limit = 6,
        ?string $resourceRole = null,
        string $subject = ''
    ): array
    {
        $query = trim(preg_replace('/[^\p{L}\p{N}\s_-]+/u', ' ', $query) ?? '');
        $query = mb_substr($query, 0, 250, 'UTF-8');
        if ($query === '') {
            return [];
        }
        $limit = max(1, min(10, $limit));
        $sql = "SELECT c.id AS chunk_id, c.content, c.page_start,
                       d.id AS document_id, d.title, d.year_group, d.subject_name,
                       d.resource_role, d.version_label, d.source_reference, d.source_url,
                       s.name AS source_name, s.publisher, s.source_kind
                FROM curriculum_chunks c
                JOIN curriculum_documents d ON d.id = c.document_id
                LEFT JOIN curriculum_sources s ON s.id = d.source_id
                WHERE d.review_status = 'verified'
                  AND d.is_enabled = 1
                  AND d.extraction_status = 'extracted'";
        $parameters = ['terms' => $query];
        if ($resourceRole !== null) {
            if (!in_array($resourceRole, ['teacher_manual', 'learner_material', 'lesson_template', 'scheme_template', 'curriculum', 'other'], true)) {
                return [];
            }
            $sql .= ' AND d.resource_role = :resource_role';
            $parameters['resource_role'] = $resourceRole;
        } else {
            $sql .= " AND d.resource_role NOT IN ('lesson_template', 'scheme_template')";
        }
        if ($yearGroup !== null && $yearGroup !== '') {
            $sql .= ' AND FIND_IN_SET(:year_group, d.year_group) > 0';
            $parameters['year_group'] = $yearGroup;
        }
        if (trim($subject) !== '') {
            $sql .= ' AND ' . $this->subjectDocumentCondition($subject, 'd', $parameters);
        }
        $sql .= ' AND MATCH(c.content) AGAINST (:terms IN NATURAL LANGUAGE MODE)
                 ORDER BY MATCH(c.content) AGAINST (:terms2 IN NATURAL LANGUAGE MODE) DESC
                 LIMIT ' . min(100, $limit * 10);
        $parameters['terms2'] = $query;
        $statement = Connection::get()->prepare($sql);
        $statement->execute($parameters);
        $references = [];
        foreach ($statement->fetchAll() as $reference) {
            $reference = $this->sanitizeUtf8Values($reference);
            $text = (string)$reference['content'];
            $characters = max(1, mb_strlen($text, 'UTF-8'));
            preg_match_all('/\x{FFFD}/u', $text, $replacementMatches);
            preg_match_all('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $text, $controlMatches);
            if (count($replacementMatches[0]) / $characters > 0.01
                || count($controlMatches[0]) / $characters > 0.01) {
                continue;
            }
            $references[] = $reference;
            if (count($references) >= $limit) {
                break;
            }
        }
        return $references;
    }

    public function searchPlanningTemplates(string $type, string $yearGroup): array
    {
        $resourceRole = match ($type) {
            'lesson' => 'lesson_template',
            'scheme' => 'scheme_template',
            default => null,
        };
        if ($resourceRole === null) {
            return [];
        }
        $statement = Connection::get()->prepare(
            "SELECT c.id AS chunk_id, c.content, c.page_start,
                    d.id AS document_id, d.title, d.year_group, d.subject_name,
                    d.resource_role, d.version_label, d.source_reference, d.source_url,
                    s.name AS source_name, s.publisher, s.source_kind
             FROM curriculum_chunks c
             JOIN curriculum_documents d ON d.id = c.document_id
             LEFT JOIN curriculum_sources s ON s.id = d.source_id
             WHERE d.review_status = 'verified'
               AND d.is_enabled = 1
               AND d.extraction_status = 'extracted'
               AND d.resource_role = :resource_role
               AND (d.year_group IS NULL OR FIND_IN_SET(:year_group, d.year_group) > 0)
             ORDER BY d.updated_at DESC, c.chunk_index
             LIMIT 6"
        );
        $statement->execute(['resource_role' => $resourceRole, 'year_group' => $yearGroup]);
        $references = [];
        foreach ($statement->fetchAll() as $reference) {
            $reference = $this->sanitizeUtf8Values($reference);
            $text = (string)$reference['content'];
            $characters = max(1, mb_strlen($text, 'UTF-8'));
            preg_match_all('/\x{FFFD}/u', $text, $replacementMatches);
            preg_match_all('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $text, $controlMatches);
            if (count($replacementMatches[0]) / $characters > 0.01
                || count($controlMatches[0]) / $characters > 0.01) {
                continue;
            }
            $reference['content'] = mb_strcut($text, 0, 4500, 'UTF-8');
            $references[] = $reference;
        }
        return $references;
    }

    private function sanitizeUtf8Values(array $row): array
    {
        foreach ($row as $key => $value) {
            if (is_string($value) && preg_match('//u', $value) !== 1) {
                $row[$key] = mb_convert_encoding($value, 'UTF-8', 'UTF-8');
            }
        }
        return $row;
    }
}
