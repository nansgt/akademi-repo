<?php
declare(strict_types=1);

namespace Akademi\Services;

use Akademi\Database\Connection;
use Akademi\Security\Csrf;
use PDO;
use PDOException;
use RuntimeException;
use Throwable;

final class AuthService
{
    private const CODE_TTL_MINUTES = 10;
    private const MAX_CODE_ATTEMPTS = 5;
    private const MAX_REQUESTS_PER_WINDOW = 5;
    private const RATE_WINDOW_MINUTES = 15;

    public function register(string $name, string $email): void
    {
        $name = trim($name);
        $email = strtolower(trim($email));
        if ($name === '' || mb_strlen($name) > 120) {
            throw new RuntimeException('Enter your name (up to 120 characters).', 422);
        }
        $this->validateEmail($email);
        $this->consumeRateLimit('register', $email);
        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $insert = $pdo->prepare('INSERT INTO users (display_name, email, status) VALUES (:name, :email, :status)');
            $insert->execute(['name' => $name, 'email' => $email, 'status' => 'pending']);
            $userId = (int)$pdo->lastInsertId();
            $role = $pdo->query("SELECT id FROM roles WHERE slug = 'teacher'")->fetchColumn();
            if ($role === false) {
                throw new RuntimeException('The teacher role is missing. Apply database migrations.');
            }
            $assign = $pdo->prepare('INSERT INTO user_roles (user_id, role_id) VALUES (:user_id, :role_id)');
            $assign->execute(['user_id' => $userId, 'role_id' => (int)$role]);
            $pdo->commit();
            $this->issueCode($userId, $email, 'register');
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            $databaseError = $exception instanceof PDOException ? ($exception->errorInfo ?? []) : [];
            if ($exception instanceof PDOException
                && (string)$exception->getCode() === '23000'
                && (int)($databaseError[1] ?? 0) === 1062) {
                $this->requestLoginCode($email);
                return;
            }
            throw $exception;
        }
    }

    public function requestLoginCode(string $email): void
    {
        $email = strtolower(trim($email));
        $this->validateEmail($email);
        $this->consumeRateLimit('login', $email);
        $statement = Connection::get()->prepare(
            "SELECT id, email, status FROM users WHERE email = :email AND status IN ('active', 'pending') LIMIT 1"
        );
        $statement->execute(['email' => $email]);
        $user = $statement->fetch();
        if ($user) {
            $purpose = $user['status'] === 'pending' ? 'register' : 'login';
            $this->issueCode((int)$user['id'], (string)$user['email'], $purpose);
        } else {
            $this->setPendingChallenge(null, $email, 'login');
        }
    }

    public function loginWithPassword(string $email, string $password): void
    {
        $email = strtolower(trim($email));
        $this->validateEmail($email);
        $this->consumeRateLimit('password_login', $email);
        $statement = Connection::get()->prepare(
            "SELECT id, password_hash FROM users
             WHERE email = :email AND status = 'active' AND email_verified_at IS NOT NULL
             LIMIT 1"
        );
        $statement->execute(['email' => $email]);
        $user = $statement->fetch();
        if (!$user || !is_string($user['password_hash']) || !password_verify($password, $user['password_hash'])) {
            throw new RuntimeException('Email or password is incorrect. If you do not have a password yet, use email-code sign-in.', 401);
        }
        if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
            Connection::get()->prepare('UPDATE users SET password_hash = :hash WHERE id = :id')
                ->execute(['hash' => password_hash($password, PASSWORD_DEFAULT), 'id' => (int)$user['id']]);
        }
        $this->startAuthenticatedSession((int)$user['id']);
        unset($_SESSION['pending_auth'], $_SESSION['recently_verified_at']);
    }

    public function setPassword(int $userId, string $currentPassword, string $newPassword): void
    {
        $this->validatePassword($newPassword);
        $pdo = Connection::get();
        $statement = $pdo->prepare(
            "SELECT password_hash FROM users
             WHERE id = :id AND status = 'active' AND email_verified_at IS NOT NULL
             LIMIT 1"
        );
        $statement->execute(['id' => $userId]);
        $storedHash = $statement->fetchColumn();
        if ($storedHash === false) {
            throw new RuntimeException('This account is not available for password changes.', 403);
        }
        $recentCodeVerification = isset($_SESSION['recently_verified_at'])
            && (int)$_SESSION['recently_verified_at'] >= time() - 600;
        if (is_string($storedHash) && $storedHash !== '' && !$recentCodeVerification) {
            if ($currentPassword === '' || !password_verify($currentPassword, $storedHash)) {
                throw new RuntimeException('Enter your current password, or sign in with an email code before changing it.', 422);
            }
        }
        $passwordHash = password_hash($newPassword, PASSWORD_DEFAULT);
        if (!is_string($passwordHash)) {
            throw new RuntimeException('The password could not be secured. Try again.', 500);
        }
        $pdo->beginTransaction();
        try {
            $pdo->prepare('UPDATE users SET password_hash = :hash, updated_at = UTC_TIMESTAMP() WHERE id = :id')
                ->execute(['hash' => $passwordHash, 'id' => $userId]);
            $currentToken = $_SESSION['auth_session_token'] ?? '';
            if (is_string($currentToken) && $currentToken !== '') {
                $pdo->prepare(
                    'UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP()
                     WHERE user_id = :user_id AND token_hash <> :token_hash AND revoked_at IS NULL'
                )->execute([
                    'user_id' => $userId,
                    'token_hash' => hash('sha256', $currentToken),
                ]);
            }
            $pdo->commit();
            unset($_SESSION['recently_verified_at']);
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
    }

    public function verifyCode(string $code): array
    {
        if (!preg_match('/^\d{6}$/', $code)) {
            throw new RuntimeException('Enter the six-digit code from your email.', 422);
        }
        $pending = $_SESSION['pending_auth'] ?? null;
        if (!is_array($pending) || !isset($pending['challenge'])) {
            throw new RuntimeException('Request a new verification code and try again.', 422);
        }
        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $statement = $pdo->prepare('SELECT * FROM email_verification_codes WHERE challenge_hash = :challenge AND consumed_at IS NULL FOR UPDATE');
            $statement->execute(['challenge' => hash('sha256', (string)$pending['challenge'])]);
            $challenge = $statement->fetch();
            if (!$challenge || strtotime((string)$challenge['expires_at'] . ' UTC') < time()) {
                throw new RuntimeException('That code expired. Request a new one.', 422);
            }
            if ((int)$challenge['attempts'] >= self::MAX_CODE_ATTEMPTS) {
                throw new RuntimeException('Too many incorrect attempts. Request a new code.', 429);
            }
            $pdo->prepare('UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = :id')
                ->execute(['id' => $challenge['id']]);
            if (!password_verify($code, (string)$challenge['code_hash'])) {
                $pdo->commit();
                throw new RuntimeException('That code is incorrect. Check the message and try again.', 422);
            }
            if ($challenge['user_id'] === null) {
                $pdo->prepare('UPDATE email_verification_codes SET consumed_at = UTC_TIMESTAMP() WHERE id = :id')
                    ->execute(['id' => $challenge['id']]);
                $pdo->commit();
                unset($_SESSION['pending_auth']);
                throw new RuntimeException('If an active account uses that address, a sign-in code has been sent.', 422);
            }
            $userId = (int)$challenge['user_id'];
            $pdo->prepare('UPDATE email_verification_codes SET consumed_at = UTC_TIMESTAMP() WHERE id = :id')
                ->execute(['id' => $challenge['id']]);
            $pdo->prepare("UPDATE users SET status = 'active', email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()), updated_at = UTC_TIMESTAMP() WHERE id = :id AND status IN ('pending', 'active')")
                ->execute(['id' => $userId]);
            $user = $this->fetchUser($pdo, $userId);
            if (!$user || $user['status'] !== 'active') {
                throw new RuntimeException('This account is not available. Contact your platform administrator.', 403);
            }
            $pdo->commit();
            $this->startAuthenticatedSession($userId);
            $_SESSION['recently_verified_at'] = time();
            unset($_SESSION['pending_auth']);
            return $user;
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
    }

    public function resendCode(): void
    {
        $pending = $_SESSION['pending_auth'] ?? null;
        if (!is_array($pending) || !isset($pending['email'], $pending['purpose'])) {
            throw new RuntimeException('Start registration or sign-in again to request a new code.', 422);
        }
        $email = (string)$pending['email'];
        $this->consumeRateLimit('resend', $email);
        $statement = Connection::get()->prepare('SELECT id, email FROM users WHERE email = :email LIMIT 1');
        $statement->execute(['email' => $email]);
        $user = $statement->fetch();
        if ($user && ($pending['purpose'] === 'register' || $user['status'] === 'active')) {
            $this->issueCode((int)$user['id'], (string)$user['email'], (string)$pending['purpose']);
        } elseif ($pending['purpose'] === 'login') {
            $this->setPendingChallenge(null, $email, 'login');
        }
    }

    public function currentUser(): ?array
    {
        $userId = filter_var($_SESSION['auth_user_id'] ?? null, FILTER_VALIDATE_INT);
        $token = $_SESSION['auth_session_token'] ?? null;
        if (!$userId || !is_string($token)) {
            return null;
        }
        $statement = Connection::get()->prepare(
            "SELECT u.id, u.display_name, u.email, u.status, u.email_verified_at,
                    GROUP_CONCAT(DISTINCT r.slug ORDER BY r.slug SEPARATOR ',') AS role_slugs
             FROM users u
             JOIN user_roles ur ON ur.user_id = u.id
             JOIN roles r ON r.id = ur.role_id
             JOIN user_sessions s ON s.user_id = u.id
             WHERE u.id = :user_id AND s.token_hash = :token_hash
               AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP()
               AND u.status = 'active'
             GROUP BY u.id
             LIMIT 1"
        );
        $statement->execute(['user_id' => $userId, 'token_hash' => hash('sha256', $token)]);
        $user = $statement->fetch();
        if (!$user) {
            $this->clearSession();
            return null;
        }
        $roles = $user['role_slugs'] === null ? [] : explode(',', (string)$user['role_slugs']);
        $user['roles'] = $roles;
        unset($user['role_slugs']);
        return $user;
    }

    public function logout(): void
    {
        $token = $_SESSION['auth_session_token'] ?? null;
        if (is_string($token)) {
            Connection::get()->prepare('UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP() WHERE token_hash = :token_hash AND revoked_at IS NULL')
                ->execute(['token_hash' => hash('sha256', $token)]);
        }
        $this->clearSession();
    }

    public function requireRole(array $user, string $role): void
    {
        if (!in_array($role, $user['roles'] ?? [], true)) {
            throw new RuntimeException('You do not have permission to access this resource.', 403);
        }
    }

    public function requireAnyRole(array $user, array $roles): void
    {
        if (array_intersect($roles, $user['roles'] ?? []) === []) {
            throw new RuntimeException('You do not have permission to access this resource.', 403);
        }
    }

    private function issueCode(int $userId, string $email, string $purpose): void
    {
        $code = (string)random_int(100000, 999999);
        $challenge = bin2hex(random_bytes(32));
        $pdo = Connection::get();
        $pdo->prepare('UPDATE email_verification_codes SET consumed_at = UTC_TIMESTAMP() WHERE email = :email AND consumed_at IS NULL')
            ->execute(['email' => $email]);
        $insert = $pdo->prepare(
            'INSERT INTO email_verification_codes
             (user_id, email, purpose, challenge_hash, code_hash, expires_at, request_ip_hash)
             VALUES (:user_id, :email, :purpose, :challenge_hash, :code_hash, DATE_ADD(UTC_TIMESTAMP(), INTERVAL :ttl MINUTE), :ip_hash)'
        );
        $insert->bindValue(':user_id', $userId, PDO::PARAM_INT);
        $insert->bindValue(':email', $email);
        $insert->bindValue(':purpose', $purpose);
        $insert->bindValue(':challenge_hash', hash('sha256', $challenge));
        $insert->bindValue(':code_hash', password_hash($code, PASSWORD_DEFAULT));
        $insert->bindValue(':ttl', self::CODE_TTL_MINUTES, PDO::PARAM_INT);
        $insert->bindValue(':ip_hash', $this->ipHash());
        $insert->execute();
        $this->setPendingChallenge($challenge, $email, $purpose);
        try {
            Mailer::sendVerificationCode($email, $code, self::CODE_TTL_MINUTES, $purpose);
        } catch (Throwable $exception) {
            if (\env('APP_ENV', 'production') !== 'local') {
                $pdo->prepare('UPDATE email_verification_codes SET consumed_at = UTC_TIMESTAMP() WHERE challenge_hash = :challenge')
                    ->execute(['challenge' => hash('sha256', $challenge)]);
                $this->setPendingChallenge(null, $email, $purpose);
            }
            throw $exception;
        }
    }

    private function setPendingChallenge(?string $challenge, string $email, string $purpose): void
    {
        $_SESSION['pending_auth'] = [
            'challenge' => $challenge ?? bin2hex(random_bytes(32)),
            'email' => $email,
            'purpose' => $purpose,
            'created_at' => time(),
        ];
    }

    private function startAuthenticatedSession(int $userId): void
    {
        session_regenerate_id(true);
        $token = bin2hex(random_bytes(32));
        $pdo = Connection::get();
        $statement = $pdo->prepare(
            'INSERT INTO user_sessions (user_id, token_hash, ip_hash, user_agent_hash, expires_at)
             VALUES (:user_id, :token_hash, :ip_hash, :user_agent_hash, DATE_ADD(UTC_TIMESTAMP(), INTERVAL :ttl SECOND))'
        );
        $statement->bindValue(':user_id', $userId, PDO::PARAM_INT);
        $statement->bindValue(':token_hash', hash('sha256', $token));
        $statement->bindValue(':ip_hash', $this->ipHash());
        $statement->bindValue(':user_agent_hash', hash('sha256', (string)($_SERVER['HTTP_USER_AGENT'] ?? '')));
        $statement->bindValue(':ttl', (int)\env('SESSION_LIFETIME', '28800'), PDO::PARAM_INT);
        $statement->execute();
        $_SESSION['auth_user_id'] = $userId;
        $_SESSION['auth_session_token'] = $token;
        $_SESSION['_csrf'] = bin2hex(random_bytes(32));
    }

    private function clearSession(): void
    {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', [
                'expires' => time() - 42000,
                'path' => $params['path'],
                'domain' => $params['domain'],
                'secure' => (bool)$params['secure'],
                'httponly' => (bool)$params['httponly'],
                'samesite' => $params['samesite'] ?? 'Lax',
            ]);
        }
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_destroy();
        }
    }

    private function fetchUser(PDO $pdo, int $userId): ?array
    {
        $statement = $pdo->prepare(
            'SELECT u.id, u.display_name, u.email, u.status, u.email_verified_at,
                    GROUP_CONCAT(DISTINCT r.slug ORDER BY r.slug SEPARATOR \',\') AS role_slugs
             FROM users u
             JOIN user_roles ur ON ur.user_id = u.id
             JOIN roles r ON r.id = ur.role_id
             WHERE u.id = :user_id GROUP BY u.id LIMIT 1'
        );
        $statement->execute(['user_id' => $userId]);
        $user = $statement->fetch();
        if (!$user) {
            return null;
        }
        $user['roles'] = explode(',', (string)$user['role_slugs']);
        unset($user['role_slugs']);
        return $user;
    }

    private function consumeRateLimit(string $action, string $email): void
    {
        $pdo = Connection::get();
        $bucket = hash_hmac('sha256', $action . '|' . $email . '|' . $this->ipHash(), $this->applicationKey());
        $pdo->prepare(
            'INSERT INTO auth_rate_limits (bucket_hash, action_name, attempts, window_started_at)
             VALUES (:bucket, :action_name, 1, UTC_TIMESTAMP())
             ON DUPLICATE KEY UPDATE
               attempts = IF(window_started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE), 1, attempts + 1),
               window_started_at = IF(window_started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE), UTC_TIMESTAMP(), window_started_at)'
        )->execute(['bucket' => $bucket, 'action_name' => $action]);
        $statement = $pdo->prepare('SELECT attempts FROM auth_rate_limits WHERE bucket_hash = :bucket LIMIT 1');
        $statement->execute(['bucket' => $bucket]);
        if ((int)$statement->fetchColumn() > self::MAX_REQUESTS_PER_WINDOW) {
            throw new RuntimeException('Too many requests. Wait a few minutes and try again.', 429);
        }
    }

    private function validateEmail(string $email): void
    {
        if (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw new RuntimeException('Enter a valid email address.', 422);
        }
    }

    private function validatePassword(string $password): void
    {
        if (strlen($password) < 12 || strlen($password) > 72) {
            throw new RuntimeException('Use a password between 12 and 72 bytes long.', 422);
        }
    }

    private function ipHash(): string
    {
        return hash_hmac('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'), $this->applicationKey());
    }

    private function applicationKey(): string
    {
        $configured = \env('APP_KEY', '');
        if (!str_starts_with($configured, 'base64:')) {
            throw new RuntimeException('APP_KEY is not configured. Generate one before using authentication.');
        }
        $key = base64_decode(substr($configured, 7), true);
        if ($key === false || strlen($key) !== 32) {
            throw new RuntimeException('APP_KEY must decode to exactly 32 bytes.');
        }
        return $key;
    }
}
