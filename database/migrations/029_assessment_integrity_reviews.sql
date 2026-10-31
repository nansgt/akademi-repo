CREATE TABLE assessment_integrity_reviews (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    attempt_id BIGINT UNSIGNED NOT NULL,
    reviewed_by_user_id BIGINT UNSIGNED NOT NULL,
    decision ENUM('maintain', 'deduct') NOT NULL,
    marks_deducted SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    reason VARCHAR(1000) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_assessment_integrity_reviews_attempt (attempt_id, id),
    CONSTRAINT fk_integrity_review_attempt FOREIGN KEY (attempt_id) REFERENCES assessment_attempts(id) ON DELETE CASCADE,
    CONSTRAINT fk_integrity_review_user FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
