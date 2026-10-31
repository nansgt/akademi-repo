ALTER TABLE presentation_simulations
    ADD COLUMN reveal_mode ENUM('all', 'group', 'item', 'timed') NOT NULL DEFAULT 'all',
    ADD COLUMN reveal_step SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    ADD COLUMN reveal_interval_seconds TINYINT UNSIGNED NOT NULL DEFAULT 5,
    ADD COLUMN annotation_data JSON NULL,
    ADD COLUMN pointer_data JSON NULL,
    ADD COLUMN timer_ends_at DATETIME NULL,
    ADD COLUMN timer_duration_seconds SMALLINT UNSIGNED NULL,
    ADD COLUMN active_poll JSON NULL;

CREATE TABLE IF NOT EXISTS presentation_simulation_interactions (
    simulation_id BIGINT UNSIGNED NOT NULL,
    participant_hash CHAR(64) NOT NULL,
    interaction_type ENUM('poll', 'reaction') NOT NULL,
    interaction_key VARCHAR(64) NOT NULL,
    answer_index TINYINT UNSIGNED NULL,
    reaction VARCHAR(24) NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (simulation_id, participant_hash, interaction_type, interaction_key),
    KEY idx_presentation_interactions_poll (simulation_id, interaction_type, interaction_key, answer_index),
    KEY idx_presentation_interactions_reaction (simulation_id, interaction_type, reaction),
    CONSTRAINT fk_presentation_interactions_simulation FOREIGN KEY (simulation_id)
        REFERENCES presentation_simulations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
