<?php
declare(strict_types=1);

namespace Akademi\Services;

use Akademi\Database\Connection;
use RuntimeException;

final class BrandSettingsService
{
    private const DEFAULTS = [
        'primary_color' => '#143c32',
        'secondary_color' => '#c69b3c',
    ];

    public function get(): array
    {
        $statement = Connection::get()->prepare(
            'SELECT setting_key, setting_value FROM platform_settings
             WHERE setting_key IN (\'primary_color\', \'secondary_color\')'
        );
        $statement->execute();
        $colors = self::DEFAULTS;
        $savedColors = [];
        foreach ($statement->fetchAll() as $row) {
            $key = (string)$row['setting_key'];
            $value = (string)$row['setting_value'];
            if (isset($colors[$key]) && preg_match('/^#[0-9a-fA-F]{6}$/D', $value)) {
                $colors[$key] = strtolower($value);
                $savedColors[$key] = true;
            }
        }
        return $colors + ['configured' => count($savedColors) === count(self::DEFAULTS)];
    }

    public function save(array $input, int $adminUserId): array
    {
        $colors = [];
        foreach (array_keys(self::DEFAULTS) as $key) {
            $rawValue = $input[$key] ?? null;
            if (!is_string($rawValue)) {
                throw new RuntimeException('Choose valid primary and secondary colors.', 422);
            }
            $value = trim($rawValue);
            if (!preg_match('/^#[0-9a-fA-F]{6}$/D', $value)) {
                throw new RuntimeException('Choose valid primary and secondary colors.', 422);
            }
            $colors[$key] = strtolower($value);
        }

        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $statement = $pdo->prepare(
                'INSERT INTO platform_settings (setting_key, setting_value, updated_by)
                 VALUES (:setting_key, :setting_value, :updated_by)
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value),
                   updated_by = VALUES(updated_by), updated_at = UTC_TIMESTAMP()'
            );
            foreach ($colors as $key => $value) {
                $statement->execute([
                    'setting_key' => $key,
                    'setting_value' => $value,
                    'updated_by' => $adminUserId,
                ]);
            }
            $pdo->commit();
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
        return $colors;
    }
}
