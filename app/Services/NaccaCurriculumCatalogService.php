<?php
declare(strict_types=1);

namespace Akademi\Services;

final class NaccaCurriculumCatalogService
{
    private const CATALOG_PATH = __DIR__ . '/../../assets/data/nacca-shs-curriculum.json';

    /** @return array{status:string, outline:array<int,string>, source_url:string} */
    public function outline(string $subjectName, string $yearGroup): array
    {
        $json = file_get_contents(self::CATALOG_PATH);
        $catalog = is_string($json) ? json_decode($json, true) : null;
        if (!is_array($catalog) || !is_array($catalog['subjects'] ?? null)) {
            return ['status' => 'catalog_unavailable', 'outline' => [], 'source_url' => 'https://nacca.gov.gh/secondary-education-curriculum/'];
        }

        $needle = $this->normalize($subjectName);
        $subject = null;
        foreach ($catalog['subjects'] as $candidate) {
            if (!is_array($candidate)) continue;
            $names = array_merge([(string)($candidate['name'] ?? '')], is_array($candidate['aliases'] ?? null) ? $candidate['aliases'] : []);
            foreach ($names as $name) {
                if ($this->normalize((string)$name) === $needle) {
                    $subject = $candidate;
                    break 2;
                }
            }
        }
        $yearKey = match ($yearGroup) {
            'SHS1' => 'SHS1', 'SHS2' => 'SHS2', 'SHS3' => 'SHS3', default => '',
        };
        $years = is_array($subject['years'] ?? null) ? $subject['years'] : [];
        $yearEntries = $yearKey !== '' && is_array($years[$yearKey] ?? null) ? $years[$yearKey] : [];
        $outline = [];
        foreach ($yearEntries as $strand) {
            if (!is_array($strand) || trim((string)($strand['strand'] ?? '')) === '') continue;
            $outline[] = 'Strand: ' . $this->withCode((string)($strand['strand_code'] ?? ''), (string)$strand['strand']);
            foreach (($strand['sub_strands'] ?? []) as $subStrand) {
                if (!is_array($subStrand) || trim((string)($subStrand['name'] ?? '')) === '') continue;
                $outline[] = 'Sub-strand: ' . $this->withCode((string)($subStrand['code'] ?? ''), (string)$subStrand['name']);
                foreach (($subStrand['focal_areas'] ?? []) as $focalArea) {
                    if (!is_array($focalArea) || trim((string)($focalArea['name'] ?? '')) === '') continue;
                    $outline[] = 'Focal area: ' . (string)$focalArea['name'];
                    foreach (($focalArea['content_standards'] ?? []) as $standard) {
                        if (!is_array($standard) || trim((string)($standard['description'] ?? '')) === '') continue;
                        $outline[] = 'Content standard: ' . $this->withCode((string)($standard['code'] ?? ''), (string)$standard['description']);
                        foreach (($standard['learning_indicators'] ?? []) as $indicator) {
                            if (is_string($indicator) && trim($indicator) !== '') $outline[] = 'Learning indicator: ' . trim($indicator);
                            elseif (is_array($indicator) && trim((string)($indicator['description'] ?? '')) !== '') $outline[] = 'Learning indicator: ' . $this->withCode((string)($indicator['code'] ?? ''), (string)$indicator['description']);
                        }
                    }
                }
                foreach (($subStrand['content_standards'] ?? []) as $standard) {
                    if (!is_array($standard) || trim((string)($standard['description'] ?? '')) === '') continue;
                    $outline[] = 'Content standard: ' . $this->withCode((string)($standard['code'] ?? ''), (string)$standard['description']);
                    foreach (($standard['learning_indicators'] ?? []) as $indicator) {
                        if (is_string($indicator) && trim($indicator) !== '') $outline[] = 'Learning indicator: ' . trim($indicator);
                        elseif (is_array($indicator) && trim((string)($indicator['description'] ?? '')) !== '') $outline[] = 'Learning indicator: ' . $this->withCode((string)($indicator['code'] ?? ''), (string)$indicator['description']);
                    }
                }
            }
        }
        return [
            'status' => $outline === [] ? 'not_imported' : 'available',
            'outline' => array_slice(array_values(array_unique($outline)), 0, 100),
            'source_url' => (string)($subject['source_url'] ?? 'https://nacca.gov.gh/secondary-education-curriculum/'),
        ];
    }

    private function normalize(string $value): string
    {
        return trim(preg_replace('/\s+/u', ' ', mb_strtolower(str_replace(['-', '_', '.'], ' ', $value), 'UTF-8')) ?? '');
    }

    private function withCode(string $code, string $name): string
    {
        return trim($code) === '' ? trim($name) : trim($code) . '. ' . trim($name);
    }
}
