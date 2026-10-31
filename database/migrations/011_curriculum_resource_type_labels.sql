ALTER TABLE curriculum_documents
    MODIFY resource_role ENUM(
        'teacher_manual',
        'learner_material',
        'lesson_template',
        'scheme_template',
        'curriculum',
        'other'
    ) NOT NULL DEFAULT 'other',
    ADD COLUMN resource_type_label VARCHAR(100) NULL AFTER resource_role;
