ALTER TABLE curriculum_documents
    ADD COLUMN is_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER review_status,
    ADD KEY idx_curriculum_documents_enabled_review (is_enabled, review_status, extraction_status);
