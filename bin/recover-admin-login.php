<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'bootstrap.php';

use Akademi\Database\Connection;

if (getenv('APP_ENV') !== 'local') {
    fwrite(STDERR, "Local Super Admin recovery is disabled outside APP_ENV=local.\n");
    exit(1);
}

$email = strtolower(trim((string)($argv[1] ?? '')));
if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    fwrite(STDERR, "Usage: php bin/recover-admin-login.php superadmin@example.com\n");
    exit(2);
}

$pdo = Connection::get();
$pdo->beginTransaction();
try {
    $userStatement = $pdo->prepare(
        "SELECT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE u.email = :email AND u.status = 'active'
           AND u.email_verified_at IS NOT NULL AND r.slug = 'superadmin'
         LIMIT 1"
    );
    $userStatement->execute(['email' => $email]);
    $userId = $userStatement->fetchColumn();
    if ($userId === false) {
        throw new RuntimeException('An active, verified Super Admin account for that address was not found.');
    }

    $challengeStatement = $pdo->prepare(
        "SELECT id FROM email_verification_codes
         WHERE user_id = :user_id AND purpose = 'login' AND consumed_at IS NULL
           AND expires_at > UTC_TIMESTAMP()
         ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE"
    );
    $challengeStatement->execute(['user_id' => (int)$userId]);
    $challengeId = $challengeStatement->fetchColumn();
    if ($challengeId === false) {
        throw new RuntimeException('No pending login challenge exists. Request a sign-in code in the browser first, then rerun this command.');
    }

    $code = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    $update = $pdo->prepare(
        'UPDATE email_verification_codes
         SET code_hash = :code_hash, attempts = 0,
             expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)
         WHERE id = :id AND consumed_at IS NULL'
    );
    $update->execute(['code_hash' => password_hash($code, PASSWORD_DEFAULT), 'id' => (int)$challengeId]);
    if ($update->rowCount() !== 1) {
        throw new RuntimeException('The login challenge changed. Request a new code and try again.');
    }
    $pdo->commit();
    echo 'One-time local sign-in code (expires in 10 minutes): ' . $code . PHP_EOL;
    if (!unlink(__FILE__)) {
        fwrite(STDERR, 'Remove bin/recover-admin-login.php manually after signing in.' . PHP_EOL);
    }
} catch (Throwable $exception) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fwrite(STDERR, $exception->getMessage() . PHP_EOL);
    exit(1);
}
