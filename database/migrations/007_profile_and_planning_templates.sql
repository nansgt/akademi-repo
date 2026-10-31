ALTER TABLE user_profiles
    ADD COLUMN phone_number VARCHAR(30) NULL AFTER school_name,
    ADD COLUMN district VARCHAR(120) NULL AFTER region,
    ADD COLUMN department VARCHAR(120) NULL AFTER school_type,
    ADD COLUMN primary_subject VARCHAR(190) NULL AFTER department,
    ADD COLUMN school_logo_path VARCHAR(1024) NULL AFTER primary_subject;

ALTER TABLE curriculum_documents
    MODIFY resource_role ENUM(
        'teacher_manual',
        'learner_material',
        'lesson_template',
        'scheme_template',
        'other'
    ) NOT NULL DEFAULT 'other';
