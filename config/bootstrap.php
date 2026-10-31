<?php
declare(strict_types=1);

define('AKADEMI_ROOT', dirname(__DIR__));

$environmentFile = AKADEMI_ROOT . DIRECTORY_SEPARATOR . '.env';
if (is_file($environmentFile) && is_readable($environmentFile)) {
    foreach (file($environmentFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
            continue;
        }
        [$name, $value] = explode('=', $line, 2);
        $name = trim($name);
        $value = trim($value);
        if ($name === '') {
            continue;
        }
        $existingValue = getenv($name);
        if ($existingValue !== false && $existingValue !== '') {
            continue;
        }
        if (strlen($value) >= 2 && (($value[0] === '"' && str_ends_with($value, '"')) || ($value[0] === "'" && str_ends_with($value, "'")))) {
            $value = substr($value, 1, -1);
        }
        putenv($name . '=' . $value);
        $_ENV[$name] = $value;
    }
}

define('AKADEMI_STORAGE', getenv('AKADEMI_STORAGE') ?: sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'akademi-private-storage');

require AKADEMI_ROOT . DIRECTORY_SEPARATOR . 'app' . DIRECTORY_SEPARATOR . 'Support' . DIRECTORY_SEPARATOR . 'helpers.php';

if (!is_dir(AKADEMI_STORAGE) && !mkdir(AKADEMI_STORAGE, 0700, true) && !is_dir(AKADEMI_STORAGE)) {
    throw new RuntimeException('Application storage directory could not be created.');
}
$sessionDirectory = AKADEMI_STORAGE . DIRECTORY_SEPARATOR . 'sessions';
if (!is_dir($sessionDirectory) && !mkdir($sessionDirectory, 0700, true) && !is_dir($sessionDirectory)) {
    throw new RuntimeException('Application session directory could not be created.');
}

$composerAutoload = AKADEMI_ROOT . DIRECTORY_SEPARATOR . 'vendor' . DIRECTORY_SEPARATOR . 'autoload.php';
if (is_file($composerAutoload)) {
    require $composerAutoload;
}

spl_autoload_register(static function (string $class): void {
    $prefix = 'Akademi\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    $file = AKADEMI_ROOT . DIRECTORY_SEPARATOR . 'app' . DIRECTORY_SEPARATOR
        . str_replace('\\', DIRECTORY_SEPARATOR, $relative) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

$appEnv = env('APP_ENV', 'production');
date_default_timezone_set(env('APP_TIMEZONE', 'Africa/Accra'));

if (PHP_SAPI !== 'cli') {
    ini_set('display_errors', '0');
    ini_set('log_errors', '1');
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.cookie_httponly', '1');
    ini_set('session.cookie_samesite', 'Lax');
    if (ini_set('session.save_path', $sessionDirectory) === false) {
        throw new RuntimeException('PHP session storage could not be configured.');
    }
    $isSecure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower((string)$_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https');
    session_name('AKADEMISESSID');
    session_set_cookie_params([
        'lifetime' => (int)env('SESSION_LIFETIME', '28800'),
        'path' => app_base_path() . '/',
        'secure' => $isSecure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start();
    }
}

$logDirectory = AKADEMI_STORAGE . DIRECTORY_SEPARATOR . 'logs';
if (!is_dir($logDirectory) && !mkdir($logDirectory, 0700, true) && !is_dir($logDirectory)) {
    throw new RuntimeException('Application log directory could not be created.');
}
ini_set('error_log', $logDirectory . DIRECTORY_SEPARATOR . 'application.log');

function env(string $name, ?string $default = null): ?string
{
    $value = getenv($name);
    if ($value !== false && $value !== '') {
        return $value;
    }
    $value = $_ENV[$name] ?? $_SERVER[$name] ?? null;
    return is_string($value) && $value !== '' ? $value : $default;
}
