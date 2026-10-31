CREATE TABLE IF NOT EXISTS presentation_simulation_participants (
    simulation_id BIGINT UNSIGNED NOT NULL,
    participant_hash CHAR(64) NOT NULL,
    participant_name VARCHAR(80) NOT NULL,
    joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (simulation_id, participant_hash),
    KEY idx_presentation_participants_seen (simulation_id, last_seen_at),
    CONSTRAINT fk_presentation_participants_simulation FOREIGN KEY (simulation_id)
        REFERENCES presentation_simulations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO presentation_simulation_participants
    (simulation_id, participant_hash, participant_name, joined_at, last_seen_at)
SELECT activity.simulation_id, activity.participant_hash, MAX(activity.participant_name),
       MIN(activity.activity_at), MAX(activity.activity_at)
FROM (
    SELECT simulation_id, participant_hash, participant_name, updated_at AS activity_at
    FROM presentation_simulation_interactions
    UNION ALL
    SELECT simulation_id, participant_hash, participant_name, created_at AS activity_at
    FROM presentation_simulation_questions
) AS activity
GROUP BY activity.simulation_id, activity.participant_hash;
