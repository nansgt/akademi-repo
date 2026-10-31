ALTER TABLE online_assessments
    MODIFY status ENUM('published', 'paused', 'draft', 'closed', 'expired') NOT NULL DEFAULT 'published';
