<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'bootstrap.php';

use Akademi\Database\Connection;

$name = trim((string)($argv[1] ?? ''));
$email = strtolower(trim((string)($argv[2] ?? '')));
if ($name === '' || $email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    fwrite(STDERR, 'Usage: php bin/create-superadmin.php "Full Name" admin@example.com' . PHP_EOL);
    exit(2);
}

$pdo = Connection::get();
$pdo->beginTransaction();
try {
    $roles = $pdo->query("SELECT slug, id FROM roles WHERE slug IN ('superadmin', 'teacher')")->fetchAll(PDO::FETCH_KEY_PAIR);
    if (!isset($roles['superadmin'], $roles['teacher'])) {
        throw new RuntimeException('Super Admin role not found. Run bin/migrate.php first.');
    }
    $existing = $pdo->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
    $existing->execute(['email' => $email]);
    $userId = $existing->fetchColumn();
    if ($userId === false) {
        $insert = $pdo->prepare(
            "INSERT INTO users (display_name, email, status, email_verified_at)
             VALUES (:name, :email, 'active', UTC_TIMESTAMP())"
        );
        $insert->execute(['name' => $name, 'email' => $email]);
        $userId = (int)$pdo->lastInsertId();
    } else {
        $userId = (int)$userId;
        $pdo->prepare(
            "UPDATE users SET display_name = :name, status = 'active',
             email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()), updated_at = UTC_TIMESTAMP()
             WHERE id = :id"
        )->execute(['name' => $name, 'id' => $userId]);
    }
    $assign = $pdo->prepare('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (:user_id, :role_id)');
    foreach ($roles as $roleId) {
        $assign->execute(['user_id' => $userId, 'role_id' => (int)$roleId]);
    }
    $pdo->commit();
} catch (Throwable $exception) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $exception;
}

echo "Super Admin account ready for {$email}. Sign in with a password or a one-time email code." . PHP_EOL;
