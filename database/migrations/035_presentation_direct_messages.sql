CREATE TABLE IF NOT EXISTS presentation_simulation_direct_messages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    simulation_id BIGINT UNSIGNED NOT NULL,
    sender_hash CHAR(64) NULL,
    recipient_hash CHAR(64) NULL,
    sender_name VARCHAR(80) NOT NULL,
    message VARCHAR(1000) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_presentation_direct_messages_sender (simulation_id, sender_hash, id),
    KEY idx_presentation_direct_messages_recipient (simulation_id, recipient_hash, id),
    CONSTRAINT chk_presentation_direct_message_party CHECK (sender_hash IS NOT NULL OR recipient_hash IS NOT NULL),
    CONSTRAINT chk_presentation_direct_message_distinct CHECK (sender_hash IS NULL OR recipient_hash IS NULL OR sender_hash <> recipient_hash),
    CONSTRAINT fk_presentation_direct_messages_simulation FOREIGN KEY (simulation_id)
        REFERENCES presentation_simulations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
