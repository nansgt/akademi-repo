<?php
declare(strict_types=1);

function app_base_path(): string
{
    $script = str_replace('\\', '/', (string)($_SERVER['SCRIPT_NAME'] ?? '/index.php'));
    $directory = str_replace('\\', '/', dirname($script));
    $directory = rtrim($directory, '/.');
    return $directory === '' ? '' : $directory;
}

function app_url(string $path = ''): string
{
    $configuredUrl = rtrim((string)env('APP_URL', ''), '/');
    $urlParts = $configuredUrl !== '' ? parse_url($configuredUrl) : false;
    if (is_array($urlParts)
        && in_array(strtolower((string)($urlParts['scheme'] ?? '')), ['http', 'https'], true)
        && !empty($urlParts['host'])
        && !isset($urlParts['user'])
        && !isset($urlParts['pass'])
        && !isset($urlParts['query'])
        && !isset($urlParts['fragment'])) {
        return $configuredUrl . '/' . ltrim($path, '/');
    }
    $base = app_base_path();
    return $base . '/' . ltrim($path, '/');
}

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function json_response(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, private');
    echo json_encode(
        $payload,
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR
    );
    exit;
}

function request_json(): array
{
    $contentType = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
    if (!str_contains($contentType, 'application/json')) {
        return $_POST;
    }
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    try {
        $decoded = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new InvalidArgumentException('Request body must contain valid JSON.');
    }
    if (!is_array($decoded)) {
        throw new InvalidArgumentException('Request body must be a JSON object.');
    }
    return $decoded;
}

function require_method(string $method): void
{
    if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== strtoupper($method)) {
        header('Allow: ' . strtoupper($method));
        throw new RuntimeException('Method not allowed.', 405);
    }
}

function write_log(string $level, string $message, array $context = []): void
{
    $safeContext = [];
    foreach ($context as $key => $value) {
        if (preg_match('/email|code|token|key|secret|password|content|prompt/i', (string)$key)) {
            continue;
        }
        $safeContext[$key] = is_scalar($value) ? $value : get_debug_type($value);
    }
    $line = json_encode([
        'time' => gmdate('c'),
        'level' => $level,
        'message' => $message,
        'context' => $safeContext,
    ], JSON_UNESCAPED_SLASHES);
    error_log(($line ?: '{"level":"error","message":"log encoding failed"}') . PHP_EOL, 3, AKADEMI_STORAGE . DIRECTORY_SEPARATOR . 'logs' . DIRECTORY_SEPARATOR . 'application.log');
}
