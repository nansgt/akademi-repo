ALTER TABLE assessment_classes
    ADD COLUMN archived_at DATETIME NULL AFTER created_at,
    ADD KEY idx_assessment_classes_owner_archived (owner_user_id, archived_at, name);
