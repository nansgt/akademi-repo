<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'bootstrap.php';

use Akademi\Database\Connection;

if (getenv('APP_ENV') !== 'local') {
    fwrite(STDERR, "Local Super Admin password recovery is disabled outside APP_ENV=local.\n");
    exit(1);
}

$email = strtolower(trim((string)($argv[1] ?? '')));
if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    fwrite(STDERR, "Usage: php bin/reset-superadmin-password.php superadmin@example.com\n");
    exit(2);
}

$pdo = Connection::get();
$pdo->beginTransaction();
try {
    $statement = $pdo->prepare(
        "SELECT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE u.email = :email AND u.status = 'active'
           AND u.email_verified_at IS NOT NULL AND r.slug = 'superadmin'
         LIMIT 1 FOR UPDATE"
    );
    $statement->execute(['email' => $email]);
    $userId = $statement->fetchColumn();
    if ($userId === false) {
        throw new RuntimeException('An active, verified Super Admin account for that address was not found.');
    }

    $password = rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
    $passwordHash = password_hash($password, PASSWORD_DEFAULT);
    if (!is_string($passwordHash)) {
        throw new RuntimeException('The password could not be secured.');
    }
    $pdo->prepare('UPDATE users SET password_hash = :password_hash, updated_at = UTC_TIMESTAMP() WHERE id = :id')
        ->execute(['password_hash' => $passwordHash, 'id' => (int)$userId]);
    $pdo->prepare('UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP() WHERE user_id = :id AND revoked_at IS NULL')
        ->execute(['id' => (int)$userId]);
    $pdo->commit();

    echo 'Super Admin: ' . $email . PHP_EOL;
    echo 'Temporary password (shown once): ' . $password . PHP_EOL;
    echo 'Sign in at ' . rtrim((string)env('APP_URL', app_url('')), '/') . '/login and change it from Workspace profile > Manage password.' . PHP_EOL;
} catch (Throwable $exception) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fwrite(STDERR, $exception->getMessage() . PHP_EOL);
    exit(1);
}
