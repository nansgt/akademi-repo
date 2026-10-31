ALTER TABLE oauth_provider_configs
    MODIFY client_secret_encrypted VARCHAR(4096) NULL;

CREATE TABLE IF NOT EXISTS oauth_login_states (
    state_hash CHAR(64) NOT NULL PRIMARY KEY,
    provider ENUM('google', 'apple') NOT NULL,
    nonce_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    consumed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_oauth_login_states_expiry (expires_at, consumed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS oauth_identities (
    provider ENUM('google', 'apple') NOT NULL,
    subject VARCHAR(255) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (provider, subject),
    KEY idx_oauth_identities_user (user_id),
    CONSTRAINT fk_oauth_identity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
