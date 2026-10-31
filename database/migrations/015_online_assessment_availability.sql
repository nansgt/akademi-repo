ALTER TABLE online_assessments
    MODIFY status ENUM('published', 'paused', 'closed', 'expired') NOT NULL DEFAULT 'published',
    ADD COLUMN duration_days TINYINT UNSIGNED NOT NULL DEFAULT 7 AFTER published_at,
    ADD COLUMN expires_at DATETIME NULL AFTER duration_days,
    ADD COLUMN paused_at DATETIME NULL AFTER expires_at,
    ADD COLUMN paused_seconds INT UNSIGNED NOT NULL DEFAULT 0 AFTER paused_at,
    ADD COLUMN result_published_at DATETIME NULL AFTER paused_seconds,
    ADD COLUMN result_email_sent_at DATETIME NULL AFTER result_published_at;

UPDATE online_assessments
SET expires_at = DATE_ADD(published_at, INTERVAL 7 DAY)
WHERE expires_at IS NULL;

ALTER TABLE online_assessments
    MODIFY expires_at DATETIME NOT NULL,
    ADD KEY idx_online_assessments_expiry (status, expires_at, result_email_sent_at);
