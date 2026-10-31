ALTER TABLE online_assessments
    ADD COLUMN security_level ENUM('medium', 'advanced') NOT NULL DEFAULT 'medium' AFTER instructions;

CREATE TABLE assessment_access_rate_limits (
    ip_hash BINARY(32) NOT NULL PRIMARY KEY,
    attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    window_started_at DATETIME NOT NULL,
    KEY idx_assessment_access_rate_window (window_started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
