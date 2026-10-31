<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'bootstrap.php';

use Akademi\Services\CurriculumIngestionService;

$path = (string)($argv[1] ?? '');
$scanOnly = in_array('--scan-only', $argv, true);
$retryIncomplete = in_array('--retry-incomplete', $argv, true);
if ($path === '') {
    fwrite(STDERR, 'Usage: php bin/scan-curriculum.php "C:\\Users\\king\\Downloads\\curricullum_resources" [--scan-only] [--retry-incomplete]' . PHP_EOL);
    exit(2);
}
$result = (new CurriculumIngestionService())->scan($path, $scanOnly, $retryIncomplete);
if ($scanOnly) {
    foreach ($result as $file) {
        printf("%-19s %-17s %8.1f MB  %s\n", $file['year_group'] ?? 'year unknown', $file['resource_role'], $file['bytes'] / 1048576, $file['name']);
    }
    printf("Found %d supported files. No files were copied or changed.\n", count($result));
    exit(0);
}
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
