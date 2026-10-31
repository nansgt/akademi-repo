CREATE TABLE assessment_classes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    owner_user_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(160) NOT NULL,
    subject_name VARCHAR(190) NOT NULL,
    year_group ENUM('SHS1', 'SHS2', 'SHS3') NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_assessment_classes_owner (owner_user_id, created_at),
    CONSTRAINT fk_assessment_classes_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE assessment_roster (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    class_id BIGINT UNSIGNED NOT NULL,
    learner_name VARCHAR(160) NOT NULL,
    access_code_hash BINARY(32) NOT NULL,
    access_used_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_assessment_roster_code (access_code_hash),
    KEY idx_assessment_roster_class (class_id, id),
    CONSTRAINT fk_assessment_roster_class FOREIGN KEY (class_id) REFERENCES assessment_classes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE online_assessments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    owner_user_id BIGINT UNSIGNED NOT NULL,
    class_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(190) NOT NULL,
    assessment_type VARCHAR(40) NOT NULL,
    question_format VARCHAR(40) NOT NULL,
    duration_minutes SMALLINT UNSIGNED NOT NULL,
    total_marks SMALLINT UNSIGNED NOT NULL,
    instructions TEXT NOT NULL,
    questions_json MEDIUMTEXT NOT NULL,
    status ENUM('published', 'closed') NOT NULL DEFAULT 'published',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_online_assessments_owner (owner_user_id, created_at),
    CONSTRAINT fk_online_assessments_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_online_assessments_class FOREIGN KEY (class_id) REFERENCES assessment_classes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE assessment_attempts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    assessment_id BIGINT UNSIGNED NOT NULL,
    roster_id BIGINT UNSIGNED NOT NULL,
    attempt_token_hash BINARY(32) NOT NULL,
    status ENUM('in_progress', 'submitted', 'expired') NOT NULL DEFAULT 'in_progress',
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    submitted_at DATETIME NULL,
    answers_json MEDIUMTEXT NULL,
    auto_score SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    manual_score SMALLINT UNSIGNED NULL,
    needs_manual_review TINYINT(1) NOT NULL DEFAULT 0,
    UNIQUE KEY uq_assessment_attempt_roster (assessment_id, roster_id),
    KEY idx_assessment_attempt_status (assessment_id, status, submitted_at),
    CONSTRAINT fk_assessment_attempt_assessment FOREIGN KEY (assessment_id) REFERENCES online_assessments(id) ON DELETE CASCADE,
    CONSTRAINT fk_assessment_attempt_roster FOREIGN KEY (roster_id) REFERENCES assessment_roster(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE assessment_attempt_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    attempt_id BIGINT UNSIGNED NOT NULL,
    event_type ENUM('tab_hidden', 'window_blur', 'fullscreen_exit', 'copy_attempt', 'paste_attempt', 'context_menu') NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_assessment_events_attempt (attempt_id, created_at),
    CONSTRAINT fk_assessment_events_attempt FOREIGN KEY (attempt_id) REFERENCES assessment_attempts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
