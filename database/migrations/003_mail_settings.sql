CREATE TABLE IF NOT EXISTS mail_provider_configs (
    config_key VARCHAR(40) NOT NULL PRIMARY KEY,
    host VARCHAR(255) NOT NULL,
    port SMALLINT UNSIGNED NOT NULL,
    username VARCHAR(255) NOT NULL DEFAULT '',
    encrypted_password TEXT NULL,
    encryption ENUM('tls', 'ssl', 'none') NOT NULL DEFAULT 'tls',
    from_address VARCHAR(254) NOT NULL,
    from_name VARCHAR(120) NOT NULL DEFAULT 'Akademi',
    configured_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_mail_config_user FOREIGN KEY (configured_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
