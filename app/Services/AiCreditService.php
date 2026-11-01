<?php
declare(strict_types=1);

namespace Akademi\Services;

use Akademi\Database\Connection;
use PDO;
use RuntimeException;

final class AiCreditService
{
    public const ACTION_COSTS = [
        'lesson' => 1,
        'assessment' => 2,
        'scheme' => 2,
        'slides' => 1,
        'assistant' => 1,
        'presentation_visual' => 1,
        'curriculum_preview' => 1,
        'curriculum_topic_discovery' => 1,
    ];

    public function monthlyAllowance(): int
    {
        $value = Connection::get()->query(
            "SELECT setting_value FROM platform_settings WHERE setting_key = 'monthly_teacher_ai_credits' LIMIT 1"
        )->fetchColumn();
        return max(0, min(100000, (int)($value === false ? 100 : $value)));
    }

    public function monthlyAllowanceConfigured(): bool
    {
        return Connection::get()->query(
            "SELECT 1 FROM platform_settings WHERE setting_key = 'monthly_teacher_ai_credits' LIMIT 1"
        )->fetchColumn() !== false;
    }

    public function balance(int $userId): array
    {
        $month = gmdate('Y-m');
        $pdo = Connection::get();
        $allowance = $this->monthlyAllowance();
        $this->ensureMonth($pdo, $userId, $month, $allowance);
        $pdo->beginTransaction();
        try {
            $lock = $pdo->prepare(
                'SELECT id FROM user_ai_credit_months
                 WHERE user_id = :user_id AND billing_month = :month FOR UPDATE'
            );
            $lock->execute(['user_id' => $userId, 'month' => $month]);
            $monthId = (int)$lock->fetchColumn();
            if ($monthId < 1) {
                throw new RuntimeException('AI credit balance could not be loaded.', 500);
            }
            $pdo->prepare('UPDATE user_ai_credit_months SET allowance = :allowance WHERE id = :id')
                ->execute(['allowance' => $allowance, 'id' => $monthId]);
            $expiredCredits = $this->expireReservations($pdo, $monthId);
            if ($expiredCredits > 0) {
                $pdo->prepare(
                    'UPDATE user_ai_credit_months SET used_credits = GREATEST(0, used_credits - :credits)
                     WHERE id = :id'
                )->execute(['credits' => $expiredCredits, 'id' => $monthId]);
            }
            $pdo->commit();
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
        $statement = $pdo->prepare(
            'SELECT billing_month, allowance, used_credits FROM user_ai_credit_months
             WHERE user_id = :user_id AND billing_month = :billing_month LIMIT 1'
        );
        $statement->execute(['user_id' => $userId, 'billing_month' => $month]);
        $row = $statement->fetch();
        if (!$row) {
            throw new RuntimeException('AI credit balance could not be loaded.', 500);
        }
        $effectiveAllowance = (int)$row['allowance'];
        $used = (int)$row['used_credits'];
        return [
            'month' => $month,
            'allowance' => $effectiveAllowance,
            'used' => $used,
            'remaining' => max(0, $effectiveAllowance - $used),
            'next_reset_utc' => gmdate('Y-m-01\TH:i:s\Z', strtotime($month . '-01 UTC +1 month')),
            'costs' => self::ACTION_COSTS,
        ];
    }

    public function reserve(int $userId, string $action, bool $quotaExempt = false): int
    {
        $credits = self::ACTION_COSTS[$action] ?? null;
        if ($credits === null) {
            throw new RuntimeException('The AI request has no configured credit cost.', 500);
        }
        $pdo = Connection::get();
        $month = gmdate('Y-m');
        $allowance = $this->monthlyAllowance();
        $this->ensureMonth($pdo, $userId, $month, $allowance);
        $pdo->beginTransaction();
        try {
            $query = $pdo->prepare(
                'SELECT id, allowance, used_credits FROM user_ai_credit_months
                 WHERE user_id = :user_id AND billing_month = :billing_month FOR UPDATE'
            );
            $query->execute(['user_id' => $userId, 'billing_month' => $month]);
            $balance = $query->fetch();
            if (!$balance) {
                throw new RuntimeException('AI credit balance could not be reserved.', 500);
            }
            $pdo->prepare(
                'UPDATE user_ai_credit_months SET allowance = :allowance
                 WHERE id = :id'
            )->execute(['allowance' => $allowance, 'id' => $balance['id']]);
            $balance['allowance'] = $allowance;

            $expiredCredits = $this->expireReservations($pdo, (int)$balance['id']);
            if ($expiredCredits > 0) {
                $pdo->prepare(
                    "UPDATE ai_credit_ledger SET status = 'refunded'
                     WHERE credit_month_id = :month_id AND status = 'reserved'
                       AND reserved_until < UTC_TIMESTAMP()"
                )->execute(['month_id' => $balance['id']]);
                $pdo->prepare(
                    'UPDATE user_ai_credit_months SET used_credits = GREATEST(0, used_credits - :credits)
                     WHERE id = :id'
                )->execute(['credits' => $expiredCredits, 'id' => $balance['id']]);
                $balance['used_credits'] = max(0, (int)$balance['used_credits'] - $expiredCredits);
            }
            if (!$quotaExempt && (int)$balance['used_credits'] + $credits > $allowance) {
                $pdo->commit();
                throw new RuntimeException('You have used this month’s AI credits. Your allowance resets on the first of next month.', 429);
            }
            if (!$quotaExempt) {
                $pdo->prepare('UPDATE user_ai_credit_months SET used_credits = used_credits + :credits WHERE id = :id')
                    ->execute(['credits' => $credits, 'id' => $balance['id']]);
            }
            $insert = $pdo->prepare(
                "INSERT INTO ai_credit_ledger
                 (user_id, credit_month_id, action_name, credits, quota_exempt, status, reserved_until)
                 VALUES (:user_id, :month_id, :action_name, :credits, :quota_exempt, 'reserved', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE))"
            );
            $insert->execute([
                'user_id' => $userId,
                'month_id' => $quotaExempt ? null : $balance['id'],
                'action_name' => $action,
                'credits' => $credits,
                'quota_exempt' => $quotaExempt ? 1 : 0,
            ]);
            $reservationId = (int)$pdo->lastInsertId();
            $pdo->commit();
            return $reservationId;
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
    }

    public function complete(int $reservationId): void
    {
        $statement = Connection::get()->prepare(
            "UPDATE ai_credit_ledger SET status = 'completed', completed_at = UTC_TIMESTAMP(), reserved_until = NULL
             WHERE id = :id AND status = 'reserved'"
        );
        $statement->execute(['id' => $reservationId]);
        if ($statement->rowCount() !== 1) {
            throw new RuntimeException('AI credit reservation could not be finalized.', 500);
        }
    }

    public function refund(int $reservationId): void
    {
        $pdo = Connection::get();
        $pdo->beginTransaction();
        try {
            $lookup = $pdo->prepare(
                'SELECT credit_month_id, quota_exempt FROM ai_credit_ledger WHERE id = :id LIMIT 1'
            );
            $lookup->execute(['id' => $reservationId]);
            $reference = $lookup->fetch();
            if (!$reference) {
                $pdo->commit();
                return;
            }
            if (!(bool)$reference['quota_exempt'] && $reference['credit_month_id'] !== null) {
                $monthLock = $pdo->prepare('SELECT id FROM user_ai_credit_months WHERE id = :id FOR UPDATE');
                $monthLock->execute(['id' => $reference['credit_month_id']]);
                $monthLock->fetchColumn();
            }
            $statement = $pdo->prepare(
                "SELECT credit_month_id, credits, quota_exempt FROM ai_credit_ledger
                 WHERE id = :id AND status = 'reserved' FOR UPDATE"
            );
            $statement->execute(['id' => $reservationId]);
            $reservation = $statement->fetch();
            if (!$reservation) {
                $pdo->commit();
                return;
            }
            $pdo->prepare(
                "UPDATE ai_credit_ledger SET status = 'refunded', completed_at = UTC_TIMESTAMP(), reserved_until = NULL
                 WHERE id = :id"
            )->execute(['id' => $reservationId]);
            if (!(bool)$reservation['quota_exempt'] && $reservation['credit_month_id'] !== null) {
                $pdo->prepare(
                    'UPDATE user_ai_credit_months SET used_credits = GREATEST(0, used_credits - :credits)
                     WHERE id = :id'
                )->execute(['credits' => $reservation['credits'], 'id' => $reservation['credit_month_id']]);
            }
            $pdo->commit();
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
    }

    public function updateMonthlyAllowance(int $allowance, int $adminUserId): int
    {
        if ($allowance < 0 || $allowance > 100000) {
            throw new RuntimeException('Set the monthly teacher allowance between 0 and 100,000 credits.', 422);
        }
        $statement = Connection::get()->prepare(
            "INSERT INTO platform_settings (setting_key, setting_value, updated_by)
             VALUES ('monthly_teacher_ai_credits', :setting_value, :updated_by)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value),
               updated_by = VALUES(updated_by), updated_at = UTC_TIMESTAMP()"
        );
        $statement->execute(['setting_value' => (string)$allowance, 'updated_by' => $adminUserId]);
        return $allowance;
    }

    private function ensureMonth(PDO $pdo, int $userId, string $month, int $allowance): void
    {
        $statement = $pdo->prepare(
            'INSERT IGNORE INTO user_ai_credit_months (user_id, billing_month, allowance)
             VALUES (:user_id, :billing_month, :allowance)'
        );
        $statement->execute(['user_id' => $userId, 'billing_month' => $month, 'allowance' => $allowance]);
    }

    private function expireReservations(PDO $pdo, int $monthId): int
    {
        $expired = $pdo->prepare(
            "SELECT credits FROM ai_credit_ledger
             WHERE credit_month_id = :month_id AND status = 'reserved'
               AND reserved_until < UTC_TIMESTAMP()
             FOR UPDATE"
        );
        $expired->execute(['month_id' => $monthId]);
        $expiredCredits = array_sum(array_map(
            static fn(array $reservation): int => (int)$reservation['credits'],
            $expired->fetchAll()
        ));
        if ($expiredCredits > 0) {
            $pdo->prepare(
                "UPDATE ai_credit_ledger SET status = 'refunded', completed_at = UTC_TIMESTAMP(), reserved_until = NULL
                 WHERE credit_month_id = :month_id AND status = 'reserved'
                   AND reserved_until < UTC_TIMESTAMP()"
            )->execute(['month_id' => $monthId]);
        }
        return $expiredCredits;
    }
}
