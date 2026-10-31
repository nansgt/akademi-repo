CREATE TABLE IF NOT EXISTS presentation_simulations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    share_token_hash BINARY(32) NOT NULL,
    title VARCHAR(255) NOT NULL,
    presentation_data JSON NOT NULL,
    active_slide SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    status ENUM('active', 'ended') NOT NULL DEFAULT 'active',
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_presentation_simulations_token (share_token_hash),
    KEY idx_presentation_simulations_owner (user_id, status, expires_at),
    CONSTRAINT fk_presentation_simulations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
