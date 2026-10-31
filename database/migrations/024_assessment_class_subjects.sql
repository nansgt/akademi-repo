ALTER TABLE online_assessments
    ADD COLUMN subject_name VARCHAR(190) NOT NULL DEFAULT '' AFTER title;

UPDATE online_assessments a
JOIN assessment_classes c ON c.id = a.class_id
SET a.subject_name = c.subject_name
WHERE a.subject_name = '';

CREATE TABLE assessment_class_subjects (
    class_id BIGINT UNSIGNED NOT NULL,
    subject_name VARCHAR(190) NOT NULL,
    PRIMARY KEY (class_id, subject_name),
    CONSTRAINT fk_assessment_class_subjects_class FOREIGN KEY (class_id) REFERENCES assessment_classes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO assessment_class_subjects (class_id, subject_name)
SELECT id, subject_name
FROM assessment_classes;
