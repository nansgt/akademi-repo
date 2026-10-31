<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'bootstrap.php';

use Akademi\Database\Connection;

$pdo = Connection::get();
$pdo->exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (
       migration VARCHAR(190) NOT NULL PRIMARY KEY,
       applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);
$directory = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'database' . DIRECTORY_SEPARATOR . 'migrations';
$files = glob($directory . DIRECTORY_SEPARATOR . '*.sql') ?: [];
sort($files, SORT_STRING);

foreach ($files as $file) {
    $migration = basename($file);
    $check = $pdo->prepare('SELECT 1 FROM schema_migrations WHERE migration = :migration');
    $check->execute(['migration' => $migration]);
    if ($check->fetchColumn()) {
        echo "Already applied: {$migration}" . PHP_EOL;
        continue;
    }
    $sql = file_get_contents($file);
    if ($sql === false) {
        throw new RuntimeException("Could not read migration {$migration}.");
    }
    $statements = preg_split('/;\s*(?:\r?\n|$)/', $sql) ?: [];
    foreach ($statements as $statement) {
        $statement = trim($statement);
        if ($statement !== '') {
            $pdo->exec($statement);
        }
    }
    $record = $pdo->prepare('INSERT INTO schema_migrations (migration) VALUES (:migration)');
    $record->execute(['migration' => $migration]);
    echo "Applied: {$migration}" . PHP_EOL;
}
