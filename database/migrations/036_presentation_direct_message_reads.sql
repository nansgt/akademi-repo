ALTER TABLE presentation_simulation_direct_messages
    ADD COLUMN read_at DATETIME NULL DEFAULT NULL AFTER created_at,
    ADD KEY idx_presentation_direct_messages_unread (simulation_id, recipient_hash, read_at, id);
