<?php
declare(strict_types=1);

namespace Akademi\Security;

use RuntimeException;

final class Csrf
{
    public static function token(): string
    {
        if (!isset($_SESSION['_csrf']) || !is_string($_SESSION['_csrf'])) {
            $_SESSION['_csrf'] = bin2hex(random_bytes(32));
        }
        return $_SESSION['_csrf'];
    }

    public static function verifyRequest(): void
    {
        $provided = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['_csrf'] ?? null);
        if (!is_string($provided) || !hash_equals(self::token(), $provided)) {
            throw new RuntimeException('Your session security token expired. Refresh the page and try again.', 419);
        }
    }
}
