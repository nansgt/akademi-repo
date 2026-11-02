ALTER TABLE presentation_simulations
    ADD COLUMN state_version BIGINT UNSIGNED NOT NULL DEFAULT 1;
