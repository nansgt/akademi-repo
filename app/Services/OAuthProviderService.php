<?php
declare(strict_types=1);

namespace Akademi\Services;

use Akademi\Database\Connection;
use Akademi\Security\SecretCipher;
use PDO;
use RuntimeException;
use Throwable;

final class OAuthProviderService
{
    private const SECRET_CONTEXT = 'akademi-oauth-secret-v1';
    private const PROVIDERS = ['google', 'apple'];

    public function list(): array
    {
        $statement = Connection::get()->query(
            'SELECT provider, client_id, redirect_uri, enabled,
                    client_secret_encrypted IS NOT NULL AND client_secret_encrypted <> \'\' AS secret_configured,
                    updated_at
             FROM oauth_provider_configs ORDER BY provider'
        );
        return array_map(static function (array $config): array {
            $config['enabled'] = (bool)$config['enabled'];
            $config['secret_configured'] = (bool)$config['secret_configured'];
            return $config;
        }, $statement->fetchAll());
    }

    public function enabledProviders(): array
    {
        $statement = Connection::get()->query(
            'SELECT provider FROM oauth_provider_configs
             WHERE enabled = 1 AND client_id <> \'\'
               AND client_secret_encrypted IS NOT NULL AND client_secret_encrypted <> \'\'
               AND redirect_uri IS NOT NULL AND redirect_uri <> \'\''
        );
        return array_column($statement->fetchAll(), 'provider');
    }

    public function save(string $provider, array $input, int $actorUserId): array
    {
        $this->validateProvider($provider);
        $clientId = trim((string)($input['client_id'] ?? ''));
        $clientSecret = trim((string)($input['client_secret'] ?? ''));
        $redirectUri = trim((string)($input['redirect_uri'] ?? ''));
        $enabled = filter_var($input['enabled'] ?? false, FILTER_VALIDATE_BOOLEAN);

        if ($clientId === '' || strlen($clientId) > 255 || preg_match('/[\r\n]/', $clientId)) {
            throw new RuntimeException('Enter a valid OAuth client ID.', 422);
        }
        if ($clientSecret !== '' && (strlen($clientSecret) > 3000 || preg_match('/[\r\n]/', $clientSecret))) {
            throw new RuntimeException('The OAuth client secret is invalid.', 422);
        }
        if ($redirectUri !== '' && !$this->validRedirectUri($redirectUri)) {
            throw new RuntimeException('Enter an HTTPS callback URL, or use HTTP only for localhost development.', 422);
        }
        if ($provider === 'apple' && $redirectUri !== '' && !str_starts_with(strtolower($redirectUri), 'https://')) {
            throw new RuntimeException('Apple sign-in requires an HTTPS callback URL.', 422);
        }
        if ($enabled && $redirectUri === '') {
            throw new RuntimeException('Set the exact callback URL registered with the provider before enabling sign-in.', 422);
        }

        $current = $this->secretConfig($provider, false);
        $secret = $clientSecret !== '' ? $clientSecret : $current['client_secret'];
        if ($enabled && $secret === '') {
            throw new RuntimeException('Enter the provider client secret before enabling sign-in.', 422);
        }
        if ($provider === 'apple' && $enabled && (substr_count($secret, '.') !== 2 || !str_starts_with($secret, 'eyJ'))) {
            throw new RuntimeException('Apple requires a valid, signed client-secret JWT. A private key is not accepted in this field.', 422);
        }

        $encryptedSecret = $secret === '' ? null : SecretCipher::encrypt($secret, self::SECRET_CONTEXT);
        $pdo = Connection::get();
        $statement = $pdo->prepare(
            'INSERT INTO oauth_provider_configs
                (provider, client_id, client_secret_encrypted, redirect_uri, enabled, created_by)
             VALUES (:provider, :client_id, :secret, :redirect_uri, :enabled, :created_by)
             ON DUPLICATE KEY UPDATE client_id = VALUES(client_id),
                client_secret_encrypted = VALUES(client_secret_encrypted),
                redirect_uri = VALUES(redirect_uri), enabled = VALUES(enabled),
                created_by = VALUES(created_by), updated_at = UTC_TIMESTAMP()'
        );
        $statement->execute([
            'provider' => $provider,
            'client_id' => $clientId,
            'secret' => $encryptedSecret,
            'redirect_uri' => $redirectUri !== '' ? $redirectUri : null,
            'enabled' => $enabled ? 1 : 0,
            'created_by' => $actorUserId,
        ]);

        foreach ($this->list() as $config) {
            if ($config['provider'] === $provider) {
                return $config;
            }
        }
        throw new RuntimeException('OAuth settings were saved but could not be reloaded.');
    }

    public function secretConfig(string $provider, bool $requireEnabled = true): array
    {
        $this->validateProvider($provider);
        $statement = Connection::get()->prepare(
            'SELECT provider, client_id, client_secret_encrypted, redirect_uri, enabled
             FROM oauth_provider_configs WHERE provider = :provider LIMIT 1'
        );
        $statement->execute(['provider' => $provider]);
        $config = $statement->fetch();
        if (!$config) {
            if ($requireEnabled) {
                throw new RuntimeException('This sign-in provider is not enabled.', 503);
            }
            return ['client_id' => '', 'client_secret' => '', 'redirect_uri' => '', 'enabled' => false];
        }
        if ($requireEnabled && !(bool)$config['enabled']) {
            throw new RuntimeException('This sign-in provider is not enabled.', 503);
        }
        $secret = '';
        if (!empty($config['client_secret_encrypted'])) {
            $secret = SecretCipher::decrypt((string)$config['client_secret_encrypted'], self::SECRET_CONTEXT);
        }
        if ($requireEnabled && ($config['client_id'] === '' || $secret === '' || empty($config['redirect_uri']))) {
            throw new RuntimeException('This sign-in provider is not fully configured.', 503);
        }
        return [
            'provider' => $provider,
            'client_id' => (string)$config['client_id'],
            'client_secret' => $secret,
            'redirect_uri' => (string)$config['redirect_uri'],
        ];
    }

    public function begin(string $provider): array
    {
        $config = $this->secretConfig($provider);
        $state = bin2hex(random_bytes(32));
        $nonce = bin2hex(random_bytes(32));
        $statement = Connection::get()->prepare(
            'INSERT INTO oauth_login_states (state_hash, provider, nonce_hash, expires_at)
             VALUES (:state_hash, :provider, :nonce_hash, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE))'
        );
        $statement->execute([
            'state_hash' => hash('sha256', $state),
            'provider' => $provider,
            'nonce_hash' => hash('sha256', $nonce),
        ]);
        return ['state' => $state, 'nonce' => $nonce, 'config' => $config];
    }

    public function consumeState(string $provider, string $state): string
    {
        $this->validateProvider($provider);
        if ($state === '' || strlen($state) > 128) {
            throw new RuntimeException('Invalid or expired OAuth state. Start sign-in again.', 419);
        }
        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $statement = $pdo->prepare(
                'SELECT nonce_hash FROM oauth_login_states
                 WHERE state_hash = :state_hash AND provider = :provider
                   AND consumed_at IS NULL AND expires_at > UTC_TIMESTAMP()
                 FOR UPDATE'
            );
            $statement->execute(['state_hash' => hash('sha256', $state), 'provider' => $provider]);
            $nonceHash = $statement->fetchColumn();
            if ($nonceHash === false) {
                throw new RuntimeException('Invalid or expired OAuth state. Start sign-in again.', 419);
            }
            $pdo->prepare(
                'UPDATE oauth_login_states SET consumed_at = UTC_TIMESTAMP()
                 WHERE state_hash = :state_hash AND consumed_at IS NULL'
            )->execute(['state_hash' => hash('sha256', $state)]);
            $pdo->commit();
            return (string)$nonceHash;
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
    }

    public function authenticate(string $provider, string $code, string $nonceHash): void
    {
        $config = $this->secretConfig($provider);
        $tokens = $this->exchangeCode($provider, $code, $config);
        $claims = $provider === 'google'
            ? $this->verifyGoogleToken((string)($tokens['id_token'] ?? ''), $config, $nonceHash)
            : $this->verifyAppleToken((string)($tokens['id_token'] ?? ''), $config, $nonceHash);
        $this->startUserSession($provider, $claims);
    }

    private function exchangeCode(string $provider, string $code, array $config): array
    {
        if ($code === '' || strlen($code) > 4096) {
            throw new RuntimeException('The identity provider returned an invalid authorization code.', 422);
        }
        $endpoint = $provider === 'google'
            ? 'https://oauth2.googleapis.com/token'
            : 'https://appleid.apple.com/auth/token';
        $result = $this->requestJson($endpoint, 'POST', [
            'grant_type' => 'authorization_code',
            'code' => $code,
            'client_id' => $config['client_id'],
            'client_secret' => $config['client_secret'],
            'redirect_uri' => $config['redirect_uri'],
        ]);
        if (!isset($result['id_token']) || !is_string($result['id_token'])) {
            throw new RuntimeException('The identity provider did not return an ID token.', 502);
        }
        return $result;
    }

    private function verifyGoogleToken(string $idToken, array $config, string $nonceHash): array
    {
        if ($idToken === '') {
            throw new RuntimeException('Google returned an empty ID token.', 502);
        }
        $claims = $this->verifySignedJwt($idToken, 'https://www.googleapis.com/oauth2/v3/certs');
        $issuer = (string)($claims['iss'] ?? '');
        if (!in_array($issuer, ['accounts.google.com', 'https://accounts.google.com'], true)
            || !hash_equals((string)$config['client_id'], (string)($claims['aud'] ?? ''))
            || !$this->validTokenTime($claims)
            || !hash_equals($nonceHash, hash('sha256', (string)($claims['nonce'] ?? '')))
            || !$this->isVerifiedEmail($claims['email_verified'] ?? false)) {
            throw new RuntimeException('Google identity verification failed. Start sign-in again.', 401);
        }
        return $this->normalizedClaims($claims);
    }

    private function verifyAppleToken(string $idToken, array $config, string $nonceHash): array
    {
        $claims = $this->verifySignedJwt($idToken, 'https://appleid.apple.com/auth/keys');
        $audience = $claims['aud'] ?? null;
        $validAudience = is_string($audience)
            ? hash_equals((string)$config['client_id'], $audience)
            : (is_array($audience) && in_array($config['client_id'], $audience, true));
        if (($claims['iss'] ?? '') !== 'https://appleid.apple.com'
            || !$validAudience
            || !$this->validTokenTime($claims)
            || !hash_equals($nonceHash, hash('sha256', (string)($claims['nonce'] ?? '')))
            || !$this->isVerifiedEmail($claims['email_verified'] ?? false)) {
            throw new RuntimeException('Apple identity verification failed. Start sign-in again.', 401);
        }
        return $this->normalizedClaims($claims);
    }

    private function verifySignedJwt(string $jwt, string $keysUrl): array
    {
        $parts = explode('.', $jwt);
        if (count($parts) !== 3) {
            throw new RuntimeException('The identity provider returned an invalid ID token.', 502);
        }
        $header = json_decode($this->base64UrlDecode($parts[0]), true);
        $claims = json_decode($this->base64UrlDecode($parts[1]), true);
        $signature = $this->base64UrlDecode($parts[2]);
        if (!is_array($header) || !is_array($claims) || ($header['alg'] ?? '') !== 'RS256' || empty($header['kid'])) {
            throw new RuntimeException('The identity provider returned an unsupported ID token.', 502);
        }
        $keys = $this->requestJson($keysUrl, 'GET');
        $jwk = null;
        foreach (($keys['keys'] ?? []) as $key) {
            if (is_array($key)
                && ($key['kid'] ?? '') === $header['kid']
                && ($key['kty'] ?? '') === 'RSA'
                && (!isset($key['use']) || $key['use'] === 'sig')
                && (!isset($key['alg']) || $key['alg'] === 'RS256')) {
                $jwk = $key;
                break;
            }
        }
        if (!is_array($jwk) || !isset($jwk['n'], $jwk['e'])) {
            throw new RuntimeException('Could not find the identity provider signing key.', 502);
        }
        $publicKey = openssl_pkey_get_public($this->rsaJwkToPem((string)$jwk['n'], (string)$jwk['e']));
        if ($publicKey === false || openssl_verify($parts[0] . '.' . $parts[1], $signature, $publicKey, OPENSSL_ALGO_SHA256) !== 1) {
            throw new RuntimeException('Identity provider ID token signature verification failed.', 401);
        }
        return $claims;
    }

    private function normalizedClaims(array $claims): array
    {
        $email = strtolower(trim((string)($claims['email'] ?? '')));
        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false || empty($claims['sub'])) {
            throw new RuntimeException('The identity provider did not return a verified email and subject.', 401);
        }
        $name = trim((string)($claims['name'] ?? ''));
        return [
            'subject' => (string)$claims['sub'],
            'email' => $email,
            'name' => $name !== '' ? mb_substr($name, 0, 120) : mb_substr(strstr($email, '@', true) ?: 'Teacher', 0, 120),
        ];
    }

    private function startUserSession(string $provider, array $claims): void
    {
        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $identity = $pdo->prepare(
                'SELECT u.id, u.status FROM oauth_identities i
                 JOIN users u ON u.id = i.user_id
                 WHERE i.provider = :provider AND i.subject = :subject
                 LIMIT 1 FOR UPDATE'
            );
            $identity->execute(['provider' => $provider, 'subject' => $claims['subject']]);
            $user = $identity->fetch();

            if ($user) {
                if ($user['status'] !== 'active') {
                    throw new RuntimeException('This account is not active. Contact your platform administrator.', 403);
                }
                $userId = (int)$user['id'];
            } else {
                $byEmail = $pdo->prepare(
                    'SELECT id, status, email_verified_at FROM users WHERE email = :email LIMIT 1 FOR UPDATE'
                );
                $byEmail->execute(['email' => $claims['email']]);
                $user = $byEmail->fetch();
                if ($user) {
                    if ($user['status'] !== 'active' || $user['email_verified_at'] === null) {
                        throw new RuntimeException('An account already uses this email. Sign in with its existing method first.', 409);
                    }
                    $userId = (int)$user['id'];
                } else {
                    $createUser = $pdo->prepare(
                        "INSERT INTO users (display_name, email, status, email_verified_at)
                         VALUES (:name, :email, 'active', UTC_TIMESTAMP())"
                    );
                    $createUser->execute(['name' => $claims['name'], 'email' => $claims['email']]);
                    $userId = (int)$pdo->lastInsertId();
                    $role = $pdo->prepare("SELECT id FROM roles WHERE slug = 'teacher' LIMIT 1");
                    $role->execute();
                    $roleId = $role->fetchColumn();
                    if ($roleId === false) {
                        throw new RuntimeException('The teacher role is not configured.');
                    }
                    $pdo->prepare('INSERT INTO user_roles (user_id, role_id) VALUES (:user_id, :role_id)')
                        ->execute(['user_id' => $userId, 'role_id' => (int)$roleId]);
                }
                $pdo->prepare(
                    'INSERT INTO oauth_identities (provider, subject, user_id)
                     VALUES (:provider, :subject, :user_id)'
                )->execute(['provider' => $provider, 'subject' => $claims['subject'], 'user_id' => $userId]);
            }

            $token = bin2hex(random_bytes(32));
            $session = $pdo->prepare(
                'INSERT INTO user_sessions (user_id, token_hash, ip_hash, user_agent_hash, expires_at)
                 VALUES (:user_id, :token_hash, :ip_hash, :user_agent_hash, DATE_ADD(UTC_TIMESTAMP(), INTERVAL :ttl SECOND))'
            );
            $session->bindValue(':user_id', $userId, PDO::PARAM_INT);
            $session->bindValue(':token_hash', hash('sha256', $token));
            $session->bindValue(':ip_hash', hash_hmac('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'), $this->applicationKey()));
            $session->bindValue(':user_agent_hash', hash('sha256', (string)($_SERVER['HTTP_USER_AGENT'] ?? '')));
            $session->bindValue(':ttl', (int)\env('SESSION_LIFETIME', '28800'), PDO::PARAM_INT);
            $session->execute();
            $pdo->commit();

            session_regenerate_id(true);
            $_SESSION['auth_user_id'] = $userId;
            $_SESSION['auth_session_token'] = $token;
            $_SESSION['_csrf'] = bin2hex(random_bytes(32));
            unset($_SESSION['_oauth_state'], $_SESSION['_oauth_provider'], $_SESSION['pending_auth']);
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
    }

    private function requestJson(string $url, string $method, array $form = []): array
    {
        $headers = ['Accept: application/json'];
        $options = [
            'method' => $method,
            'timeout' => 15,
            'ignore_errors' => true,
            'header' => implode("\r\n", $headers) . "\r\n",
        ];
        if ($method === 'POST') {
            $options['header'] .= "Content-Type: application/x-www-form-urlencoded\r\n";
            $options['content'] = http_build_query($form);
        }
        $context = stream_context_create([
            'http' => $options,
            'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
        ]);
        $body = @file_get_contents($url, false, $context);
        $status = 0;
        foreach ($http_response_header ?? [] as $header) {
            if (preg_match('#^HTTP/\S+\s+([0-9]{3})#', $header, $matches)) {
                $status = (int)$matches[1];
                break;
            }
        }
        if ($body === false || $status < 200 || $status >= 300) {
            throw new RuntimeException('The identity provider request failed. Try again or check provider configuration.', 502);
        }
        try {
            $result = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new RuntimeException('The identity provider returned an invalid response.', 502);
        }
        if (!is_array($result)) {
            throw new RuntimeException('The identity provider returned an invalid response.', 502);
        }
        return $result;
    }

    private function rsaJwkToPem(string $modulus, string $exponent): string
    {
        $modulusBytes = $this->base64UrlDecode($modulus);
        $exponentBytes = $this->base64UrlDecode($exponent);
        $rsaKey = $this->derSequence($this->derInteger($modulusBytes) . $this->derInteger($exponentBytes));
        $algorithm = hex2bin('300d06092a864886f70d0101010500');
        if ($algorithm === false) {
            throw new RuntimeException('Could not construct the Apple public key.');
        }
        $subjectPublicKey = $this->der(0x03, "\0" . $rsaKey);
        $spki = $this->derSequence($algorithm . $subjectPublicKey);
        return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($spki), 64, "\n") . "-----END PUBLIC KEY-----\n";
    }

    private function derInteger(string $value): string
    {
        $value = ltrim($value, "\0");
        if ($value === '' || (ord($value[0]) & 0x80) !== 0) {
            $value = "\0" . $value;
        }
        return $this->der(0x02, $value);
    }

    private function derSequence(string $value): string
    {
        return $this->der(0x30, $value);
    }

    private function der(int $tag, string $value): string
    {
        $length = strlen($value);
        if ($length < 128) {
            $encodedLength = chr($length);
        } else {
            $bytes = '';
            for ($remaining = $length; $remaining > 0; $remaining >>= 8) {
                $bytes = chr($remaining & 0xff) . $bytes;
            }
            $encodedLength = chr(0x80 | strlen($bytes)) . $bytes;
        }
        return chr($tag) . $encodedLength . $value;
    }

    private function base64UrlDecode(string $value): string
    {
        $decoded = base64_decode(strtr($value, '-_', '+/') . str_repeat('=', (4 - strlen($value) % 4) % 4), true);
        if ($decoded === false) {
            throw new RuntimeException('The identity provider returned invalid token encoding.', 502);
        }
        return $decoded;
    }

    private function isVerifiedEmail(mixed $value): bool
    {
        return $value === true || $value === 1 || $value === 'true';
    }

    private function validTokenTime(array $claims): bool
    {
        $issuedAt = (int)($claims['iat'] ?? 0);
        $expiresAt = (int)($claims['exp'] ?? 0);
        return $issuedAt > 0 && $issuedAt <= time() + 60 && $expiresAt > time() && $expiresAt > $issuedAt;
    }

    private function validRedirectUri(string $uri): bool
    {
        if (filter_var($uri, FILTER_VALIDATE_URL) === false) {
            return false;
        }
        $parts = parse_url($uri);
        if (!is_array($parts) || !isset($parts['scheme'], $parts['host']) || isset($parts['user']) || isset($parts['pass'])) {
            return false;
        }
        if (isset($parts['query']) || isset($parts['fragment'])) {
            return false;
        }
        return strtolower($parts['scheme']) === 'https'
            || (strtolower($parts['scheme']) === 'http' && in_array(strtolower($parts['host']), ['localhost', '127.0.0.1'], true));
    }

    private function validateProvider(string $provider): void
    {
        if (!in_array($provider, self::PROVIDERS, true)) {
            throw new RuntimeException('Unsupported OAuth provider.', 404);
        }
    }

    private function applicationKey(): string
    {
        $configured = \env('APP_KEY', '');
        if (!str_starts_with($configured, 'base64:')) {
            throw new RuntimeException('APP_KEY is not configured for authentication.');
        }
        $key = base64_decode(substr($configured, 7), true);
        if ($key === false || strlen($key) !== 32) {
            throw new RuntimeException('APP_KEY must decode to exactly 32 bytes.');
        }
        return $key;
    }
}
