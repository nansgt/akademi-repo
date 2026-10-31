<?php
declare(strict_types=1);

namespace Akademi\Services;

use Akademi\Database\Connection;
use Akademi\Security\SecretCipher;
use RuntimeException;
use Throwable;

final class MailSettingsService
{
    public function publicConfig(): array
    {
        $statement = Connection::get()->query(
            'SELECT host, port, username, encryption, from_address, from_name, updated_at, encrypted_password
             FROM mail_provider_configs WHERE config_key = \'primary\' LIMIT 1'
        );
        $config = $statement->fetch();
        if (!$config) {
            $values = $this->environmentConfig();
            return [
                'configured' => $values['host'] !== '' && filter_var($values['from_address'], FILTER_VALIDATE_EMAIL) !== false,
                'source' => 'environment',
                'host' => $values['host'],
                'port' => $values['port'],
                'username' => $values['username'],
                'password_configured' => $values['password'] !== '',
                'encryption' => $values['encryption'],
                'from_address' => $values['from_address'],
                'from_name' => $values['from_name'],
            ];
        }
        return [
            'configured' => true,
            'source' => 'database',
            'host' => $config['host'],
            'port' => (int)$config['port'],
            'username' => $config['username'],
            'password_configured' => $config['encrypted_password'] !== null && $config['encrypted_password'] !== '',
            'encryption' => $config['encryption'],
            'from_address' => $config['from_address'],
            'from_name' => $config['from_name'],
            'updated_at' => $config['updated_at'],
        ];
    }

    public function save(array $input, int $actorUserId): array
    {
        $host = trim((string)($input['host'] ?? ''));
        $port = filter_var($input['port'] ?? null, FILTER_VALIDATE_INT);
        $username = trim((string)($input['username'] ?? ''));
        $password = (string)($input['password'] ?? '');
        $encryption = strtolower(trim((string)($input['encryption'] ?? '')));
        $fromAddress = strtolower(trim((string)($input['from_address'] ?? '')));
        $fromName = trim((string)($input['from_name'] ?? ''));

        if (!$this->validHost($host)) {
            throw new RuntimeException('Enter a valid SMTP host name or IP address, without a protocol or path.', 422);
        }
        if ($port === false || $port < 1 || $port > 65535) {
            throw new RuntimeException('Enter an SMTP port between 1 and 65535.', 422);
        }
        if (strlen($username) > 255 || preg_match('/[\r\n]/', $username)) {
            throw new RuntimeException('The SMTP username is invalid.', 422);
        }
        if (strlen($password) > 512 || preg_match('/[\r\n]/', $password)) {
            throw new RuntimeException('The SMTP password is invalid.', 422);
        }
        if (!in_array($encryption, ['tls', 'ssl', 'none'], true)) {
            throw new RuntimeException('Choose TLS, SSL or no transport encryption.', 422);
        }
        if (filter_var($fromAddress, FILTER_VALIDATE_EMAIL) === false) {
            throw new RuntimeException('Enter a valid sender email address.', 422);
        }
        if ($fromName === '' || mb_strlen($fromName) > 120 || preg_match('/[\r\n]/', $fromName)) {
            throw new RuntimeException('Enter a sender name of up to 120 characters.', 422);
        }

        $current = $this->secretConfig();
        $effectivePassword = $password !== '' ? $password : $current['password'];
        if ($username !== '' && $effectivePassword === '') {
            throw new RuntimeException('Enter the SMTP password or configure a server that does not require authentication.', 422);
        }
        $encryptedPassword = $effectivePassword === ''
            ? null
            : SecretCipher::encrypt($effectivePassword, 'akademi-mail-secret-v1');

        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $statement = $pdo->prepare(
                'INSERT INTO mail_provider_configs
                    (config_key, host, port, username, encrypted_password, encryption, from_address, from_name, configured_by)
                 VALUES (\'primary\', :host, :port, :username, :encrypted_password, :encryption, :from_address, :from_name, :configured_by)
                 ON DUPLICATE KEY UPDATE host = VALUES(host), port = VALUES(port), username = VALUES(username),
                    encrypted_password = VALUES(encrypted_password), encryption = VALUES(encryption),
                    from_address = VALUES(from_address), from_name = VALUES(from_name),
                    configured_by = VALUES(configured_by), updated_at = UTC_TIMESTAMP()'
            );
            $statement->execute([
                'host' => $host,
                'port' => $port,
                'username' => $username,
                'encrypted_password' => $encryptedPassword,
                'encryption' => $encryption,
                'from_address' => $fromAddress,
                'from_name' => $fromName,
                'configured_by' => $actorUserId,
            ]);
            $this->audit($actorUserId, 'mail_settings.updated', [
                'host' => $host,
                'port' => (int)$port,
                'encryption' => $encryption,
                'from_address' => $fromAddress,
            ]);
            $pdo->commit();
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }

        return $this->publicConfig();
    }

    public function secretConfig(): array
    {
        $statement = Connection::get()->query(
            'SELECT host, port, username, encrypted_password, encryption, from_address, from_name
             FROM mail_provider_configs WHERE config_key = \'primary\' LIMIT 1'
        );
        $config = $statement->fetch();
        if (!$config) {
            return $this->environmentConfig();
        }
        return [
            'host' => (string)$config['host'],
            'port' => (int)$config['port'],
            'username' => (string)$config['username'],
            'password' => $config['encrypted_password'] === null || $config['encrypted_password'] === ''
                ? ''
                : SecretCipher::decrypt((string)$config['encrypted_password'], 'akademi-mail-secret-v1'),
            'encryption' => (string)$config['encryption'],
            'from_address' => (string)$config['from_address'],
            'from_name' => (string)$config['from_name'],
        ];
    }

    private function environmentConfig(): array
    {
        return [
            'host' => trim(\env('MAIL_HOST', '')),
            'port' => (int)\env('MAIL_PORT', '587'),
            'username' => \env('MAIL_USERNAME', ''),
            'password' => \env('MAIL_PASSWORD', ''),
            'encryption' => strtolower(\env('MAIL_ENCRYPTION', 'tls')),
            'from_address' => \env('MAIL_FROM_ADDRESS', ''),
            'from_name' => \env('MAIL_FROM_NAME', 'Akademi'),
        ];
    }

    private function validHost(string $host): bool
    {
        if ($host === '' || strlen($host) > 255 || preg_match('/[\s\/\\\\@]/', $host)) {
            return false;
        }
        $ip = trim($host, '[]');
        if (filter_var($ip, FILTER_VALIDATE_IP) !== false) {
            return true;
        }
        if (filter_var($host, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME) === false) {
            return false;
        }
        return str_contains($host, '.');
    }

    private function audit(int $actorUserId, string $action, array $metadata): void
    {
        $statement = Connection::get()->prepare(
            'INSERT INTO audit_logs (actor_user_id, action_name, target_type, target_id, metadata, request_id)
             VALUES (:actor, :action, :target, :target_id, :metadata, :request_id)'
        );
        $statement->execute([
            'actor' => $actorUserId,
            'action' => $action,
            'target' => 'mail_provider',
            'target_id' => 'primary',
            'metadata' => json_encode($metadata, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            'request_id' => bin2hex(random_bytes(16)),
        ]);
    }
}
