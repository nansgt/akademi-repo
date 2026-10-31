<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'bootstrap.php';

use Akademi\Services\OnlineAssessmentService;

$sent = (new OnlineAssessmentService())->processExpiredResults();
echo "Expired assessments processed; {$sent} result email(s) sent." . PHP_EOL;
