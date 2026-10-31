<?php
declare(strict_types=1);

namespace Akademi\Security;

use RuntimeException;

final class SecretCipher
{
    public static function encrypt(string $plaintext, string $context = 'akademi-ai-secret-v1'): string
    {
        $key = self::key();
        $iv = random_bytes(12);
        $tag = '';
        $ciphertext = openssl_encrypt($plaintext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, $context, 16);
        if ($ciphertext === false) {
            throw new RuntimeException('The AI credential could not be encrypted.');
        }
        return base64_encode($iv . $tag . $ciphertext);
    }

    public static function decrypt(string $encoded, string $context = 'akademi-ai-secret-v1'): string
    {
        $payload = base64_decode($encoded, true);
        if ($payload === false || strlen($payload) < 29) {
            throw new RuntimeException('The stored AI credential is invalid.');
        }
        $iv = substr($payload, 0, 12);
        $tag = substr($payload, 12, 16);
        $ciphertext = substr($payload, 28);
        $plaintext = openssl_decrypt($ciphertext, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $iv, $tag, $context);
        if ($plaintext === false) {
            throw new RuntimeException(
                'The stored credential cannot be decrypted with the current APP_KEY. Replace this credential in its settings; if APP_KEY changed, other encrypted credentials may also need to be re-entered.'
            );
        }
        return $plaintext;
    }

    public static function canDecrypt(string $encoded, string $context = 'akademi-ai-secret-v1'): bool
    {
        try {
            self::decrypt($encoded, $context);
            return true;
        } catch (RuntimeException) {
            return false;
        }
    }

    private static function key(): string
    {
        $configured = \env('APP_KEY', '');
        if (!str_starts_with($configured, 'base64:')) {
            throw new RuntimeException('APP_KEY must be a base64-encoded 32-byte key. Generate one with bin/generate-app-key.php.');
        }
        $key = base64_decode(substr($configured, 7), true);
        if ($key === false || strlen($key) !== 32) {
            throw new RuntimeException('APP_KEY must decode to exactly 32 bytes.');
        }
        return $key;
    }
}
