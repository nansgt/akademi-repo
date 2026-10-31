<?php
declare(strict_types=1);

if (PHP_SAPI === 'cli-server') {
    $requestPath = parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
    $staticPath = is_string($requestPath) && preg_match('#^/assets/[A-Za-z0-9._-]+\.(?:css|js|svg)$#D', $requestPath)
        ? $requestPath
        : (is_string($requestPath) && in_array($requestPath, ['/manifest.webmanifest', '/service-worker.js'], true)
            ? $requestPath
            : null);
    if ($staticPath !== null) {
        $relativePath = ltrim($staticPath, '/');
        $file = realpath(__DIR__ . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativePath));
        if ($file !== false && is_file($file)) {
            return false;
        }
    }
}

try {
    require __DIR__ . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'bootstrap.php';
    require __DIR__ . DIRECTORY_SEPARATOR . 'app' . DIRECTORY_SEPARATOR . 'Http' . DIRECTORY_SEPARATOR . 'router.php';
} catch (Throwable $exception) {
    write_log('critical', 'Application bootstrap failed', ['exception' => $exception::class]);
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo 'Akademi could not start. Check the private application log and server configuration.';
}
