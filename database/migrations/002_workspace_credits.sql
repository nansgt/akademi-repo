CREATE TABLE IF NOT EXISTS platform_settings (
    setting_key VARCHAR(80) NOT NULL PRIMARY KEY,
    setting_value VARCHAR(255) NOT NULL,
    updated_by BIGINT UNSIGNED NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_platform_settings_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO platform_settings (setting_key, setting_value)
VALUES ('monthly_teacher_ai_credits', '100');

CREATE TABLE IF NOT EXISTS user_ai_credit_months (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    billing_month CHAR(7) NOT NULL,
    allowance INT UNSIGNED NOT NULL,
    used_credits INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_credit_month_user (user_id, billing_month),
    CONSTRAINT fk_credit_month_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_credit_ledger (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    credit_month_id BIGINT UNSIGNED NULL,
    action_name VARCHAR(80) NOT NULL,
    credits INT UNSIGNED NOT NULL,
    quota_exempt TINYINT(1) NOT NULL DEFAULT 0,
    status ENUM('reserved', 'completed', 'refunded') NOT NULL DEFAULT 'reserved',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,
    reserved_until DATETIME NULL,
    KEY idx_credit_ledger_user_time (user_id, created_at),
    KEY idx_credit_ledger_reservation (status, reserved_until),
    CONSTRAINT fk_credit_ledger_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_credit_ledger_month FOREIGN KEY (credit_month_id) REFERENCES user_ai_credit_months(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teacher_schedule_entries (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    weekday VARCHAR(12) NOT NULL,
    start_time TIME NOT NULL,
    subject_name VARCHAR(190) NOT NULL,
    class_name VARCHAR(120) NULL,
    topic VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_schedule_user_day_time (user_id, weekday, start_time),
    CONSTRAINT fk_schedule_entry_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
