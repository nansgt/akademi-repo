<?php
declare(strict_types=1);

namespace Akademi\Services;

use RuntimeException;

final class CurriculumTopicDiscoveryService
{
    public function discover(string $subject, string $yearGroup, ?int $semester): array
    {
        if ($semester !== null && !in_array($semester, [1, 2], true)) {
            throw new RuntimeException('Choose first semester or second semester.', 422);
        }

        $lessons = (new CurriculumSearchService())->verifiedWeeklyLessons(
            $subject,
            $yearGroup,
            $semester,
            500
        );
        $sources = [];
        foreach ($lessons as &$lesson) {
            $sources[(int)$lesson['document_id']] = true;
            $lesson['ai_extracted'] = (bool)$lesson['ai_generated'];
        }
        unset($lesson);

        return [
            'lessons' => $lessons,
            'source_count' => count($sources),
            'note' => $lessons === []
                ? 'No structured week-by-week topic allocations are available from verified resources for this subject and SHS year. Ask an administrator to scan and verify a matching resource.'
                : null,
        ];
    }
}
