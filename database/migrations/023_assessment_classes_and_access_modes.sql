ALTER TABLE online_assessments
    ADD COLUMN access_mode ENUM('none', 'teacher_code', 'individual_code') NOT NULL DEFAULT 'individual_code' AFTER security_level,
    ADD COLUMN teacher_access_code_hash BINARY(32) NULL AFTER access_mode;

CREATE TABLE online_assessment_classes (
    assessment_id BIGINT UNSIGNED NOT NULL,
    class_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (assessment_id, class_id),
    KEY idx_online_assessment_classes_class (class_id, assessment_id),
    CONSTRAINT fk_online_assessment_classes_assessment FOREIGN KEY (assessment_id) REFERENCES online_assessments(id) ON DELETE CASCADE,
    CONSTRAINT fk_online_assessment_classes_class FOREIGN KEY (class_id) REFERENCES assessment_classes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE online_assessment_roster (
    assessment_id BIGINT UNSIGNED NOT NULL,
    roster_id BIGINT UNSIGNED NOT NULL,
    access_code_hash BINARY(32) NULL,
    access_code_encrypted TEXT NULL,
    access_used_at DATETIME NULL,
    PRIMARY KEY (assessment_id, roster_id),
    KEY idx_online_assessment_roster_code (access_code_hash),
    CONSTRAINT fk_online_assessment_roster_assessment FOREIGN KEY (assessment_id) REFERENCES online_assessments(id) ON DELETE CASCADE,
    CONSTRAINT fk_online_assessment_roster_roster FOREIGN KEY (roster_id) REFERENCES assessment_roster(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO online_assessment_classes (assessment_id, class_id)
SELECT id, class_id FROM online_assessments;

INSERT INTO online_assessment_roster (assessment_id, roster_id, access_code_hash, access_code_encrypted, access_used_at)
SELECT a.id, r.id, r.access_code_hash, r.access_code_encrypted, r.access_used_at
FROM online_assessments a
JOIN assessment_roster r ON r.class_id = a.class_id;
