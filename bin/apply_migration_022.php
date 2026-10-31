<?php
declare(strict_types=1);

require __DIR__ . '/../config/bootstrap.php';

use Akademi\Database\Connection;

$pdo = Connection::get();
$columns = $pdo->query("SHOW COLUMNS FROM curriculum_weekly_lessons")->fetchAll(PDO::FETCH_COLUMN);
$additions = [];
$hasIndicators = in_array('learning_indicators', $columns, true);
$hasOutcomes = in_array('learning_outcomes', $columns, true);
if (!$hasIndicators) {
    $additions[] = 'ADD COLUMN learning_indicators JSON NULL AFTER focal_areas';
}
if (!$hasOutcomes) {
    $additions[] = 'ADD COLUMN learning_outcomes JSON NULL AFTER learning_indicators';
}
if ($additions !== []) {
    $pdo->exec('ALTER TABLE curriculum_weekly_lessons ' . implode(', ', $additions));
}
echo "Migration 022 applied; weekly learning-target columns are available.\n";
