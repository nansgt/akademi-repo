<?php

declare(strict_types=1);

namespace Akademi\Database;

use PDO;
use RuntimeException;

final class Connection
{
    private static ?PDO $pdo = null;

    public static function get(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }
        if (!extension_loaded('pdo_mysql')) {
            throw new RuntimeException('The PDO MySQL extension is required. Enable pdo_mysql in the PHP installation used by Apache.');
        }
        $host = \env('DB_HOST', 'localhost');
        $port = \env('DB_PORT', '3306');
        $database = \env('DB_DATABASE', 'akademi');
        $charset = \env('DB_CHARSET', 'utf8mb4');
        if (!preg_match('/^[a-zA-Z0-9_]+$/', $database) || !preg_match('/^[a-zA-Z0-9_]+$/', $charset)) {
            throw new RuntimeException('Database name or character set contains invalid characters.');
        }
        $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=%s', $host, $port, $database, $charset);
        self::$pdo = new PDO($dsn, \env('DB_USERNAME', 'root'), \env('DB_PASSWORD', ''), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_STRINGIFY_FETCHES => false,
        ]);
        self::$pdo->exec("SET time_zone = '+00:00'");
        return self::$pdo;
    }
}
