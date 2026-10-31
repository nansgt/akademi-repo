ALTER TABLE presentation_simulation_interactions
    ADD COLUMN participant_name VARCHAR(80) NOT NULL DEFAULT 'Student';

ALTER TABLE presentation_simulations
    ADD COLUMN ended_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS presentation_simulation_polls (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    simulation_id BIGINT UNSIGNED NOT NULL,
    poll_id VARCHAR(64) NOT NULL,
    question VARCHAR(240) NOT NULL,
    options JSON NOT NULL,
    opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_presentation_simulation_poll (simulation_id, poll_id),
    KEY idx_presentation_simulation_polls_session (simulation_id, opened_at),
    CONSTRAINT fk_presentation_simulation_polls_simulation FOREIGN KEY (simulation_id)
        REFERENCES presentation_simulations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS presentation_simulation_questions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    simulation_id BIGINT UNSIGNED NOT NULL,
    participant_hash CHAR(64) NOT NULL,
    participant_name VARCHAR(80) NOT NULL,
    question VARCHAR(1000) NOT NULL,
    teacher_feedback VARCHAR(1000) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    answered_at DATETIME NULL,
    PRIMARY KEY (id),
    KEY idx_presentation_simulation_questions_session (simulation_id, created_at),
    KEY idx_presentation_simulation_questions_participant (simulation_id, participant_hash, created_at),
    CONSTRAINT fk_presentation_simulation_questions_simulation FOREIGN KEY (simulation_id)
        REFERENCES presentation_simulations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
