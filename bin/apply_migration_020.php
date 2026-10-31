<?php
declare(strict_types=1);

require __DIR__ . '/../config/bootstrap.php';

use Akademi\Database\Connection;

$migrationFile = __DIR__ . '/../database/migrations/020_curriculum_weekly_lessons.sql';
if (!is_file($migrationFile) || !is_readable($migrationFile)) {
    echo "Migration file not found: $migrationFile\n";
    exit(2);
}

$sql = file_get_contents($migrationFile);
if ($sql === false || trim($sql) === '') {
    echo "Migration file is empty or could not be read.\n";
    exit(3);
}

try {
    $pdo = Connection::get();
    // Check if table already exists
    $check = $pdo->query("SHOW TABLES LIKE 'curriculum_weekly_lessons'");
    $exists = (bool)$check->fetchColumn();
    if ($exists) {
        echo "Table curriculum_weekly_lessons already exists. No action taken.\n";
        exit(0);
    }
    // Execute the SQL (may contain multiple statements)
    $pdo->exec($sql);
    echo "Migration applied: curriculum_weekly_lessons created.\n";
    exit(0);
} catch (Throwable $e) {
    echo "Migration failed: " . $e->getMessage() . "\n";
    exit(1);
}
