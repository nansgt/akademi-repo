ALTER TABLE curriculum_sections
    MODIFY section_type ENUM(
        'document',
        'subject',
        'strand',
        'sub_strand',
        'focal_area',
        'section',
        'content_standard',
        'learning_indicator',
        'learning_outcome',
        'learning_objective',
        'topic',
        'other'
    ) NOT NULL DEFAULT 'other';
