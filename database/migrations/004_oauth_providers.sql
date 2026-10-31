CREATE TABLE IF NOT EXISTS oauth_provider_configs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    provider ENUM('google','apple') NOT NULL,
    client_id VARCHAR(255) NOT NULL,
    client_secret_encrypted VARCHAR(1024) NULL,
    redirect_uri VARCHAR(512) NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 0,
    created_by BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_oauth_provider_unique (provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
