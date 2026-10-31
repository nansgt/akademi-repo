CREATE TABLE IF NOT EXISTS schema_migrations (
    migration VARCHAR(190) NOT NULL PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roles (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(40) NOT NULL,
    label VARCHAR(80) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_roles_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO roles (slug, label) VALUES
    ('superadmin', 'Super Administrator'),
    ('admin', 'Administrator'),
    ('teacher', 'Teacher');

CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    display_name VARCHAR(120) NOT NULL,
    email VARCHAR(254) NOT NULL,
    status ENUM('pending', 'active', 'suspended', 'deleted') NOT NULL DEFAULT 'pending',
    email_verified_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at DATETIME NULL,
    UNIQUE KEY uq_users_email (email),
    KEY idx_users_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_roles (
    user_id BIGINT UNSIGNED NOT NULL,
    role_id BIGINT UNSIGNED NOT NULL,
    assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, role_id),
    CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_profiles (
    user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    school_name VARCHAR(190) NULL,
    region VARCHAR(100) NULL,
    school_type ENUM('mixed', 'boys', 'girls') NULL,
    teaching_subjects JSON NULL,
    year_groups JSON NULL,
    preferences JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_sessions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash CHAR(64) NOT NULL,
    ip_hash CHAR(64) NOT NULL,
    user_agent_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_sessions_token_hash (token_hash),
    KEY idx_user_sessions_user_expiry (user_id, expires_at, revoked_at),
    CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_verification_codes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NULL,
    email VARCHAR(254) NOT NULL,
    purpose ENUM('register', 'login') NOT NULL,
    challenge_hash CHAR(64) NOT NULL,
    code_hash VARCHAR(255) NOT NULL,
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    request_ip_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    consumed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_email_codes_challenge (challenge_hash),
    KEY idx_email_codes_email_created (email, created_at),
    KEY idx_email_codes_expiry (expires_at, consumed_at),
    CONSTRAINT fk_email_codes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_rate_limits (
    bucket_hash CHAR(64) NOT NULL PRIMARY KEY,
    action_name VARCHAR(40) NOT NULL,
    attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    window_started_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_auth_limits_window (window_started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_provider_configs (
    config_key VARCHAR(40) NOT NULL PRIMARY KEY,
    provider VARCHAR(30) NOT NULL,
    model VARCHAR(120) NOT NULL,
    encrypted_api_key TEXT NOT NULL,
    configured_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_ai_config_user FOREIGN KEY (configured_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS curriculum_sources (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(190) NOT NULL,
    publisher VARCHAR(190) NULL,
    source_url VARCHAR(2048) NULL,
    source_kind ENUM('ministry_portal', 'nacca_reference', 'official_local', 'teacher_supplied', 'other') NOT NULL DEFAULT 'teacher_supplied',
    attribution TEXT NULL,
    created_by BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_curriculum_sources_kind (source_kind),
    CONSTRAINT fk_curriculum_source_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS curriculum_documents (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    source_id BIGINT UNSIGNED NULL,
    uploaded_by BIGINT UNSIGNED NULL,
    title VARCHAR(255) NOT NULL,
    academic_year VARCHAR(40) NULL,
    year_group VARCHAR(30) NULL,
    subject_name VARCHAR(190) NULL,
    resource_role ENUM('teacher_manual', 'learner_material', 'other') NOT NULL DEFAULT 'other',
    version_label VARCHAR(120) NULL,
    source_reference VARCHAR(255) NULL,
    source_url VARCHAR(2048) NULL,
    source_path VARCHAR(1024) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(120) NOT NULL,
    sha256 CHAR(64) NOT NULL,
    extraction_status ENUM('queued', 'processing', 'extracted', 'needs_ocr', 'unsupported', 'failed') NOT NULL DEFAULT 'queued',
    review_status ENUM('unreviewed', 'in_review', 'verified', 'rejected') NOT NULL DEFAULT 'unreviewed',
    review_notes TEXT NULL,
    verified_by BIGINT UNSIGNED NULL,
    verified_at DATETIME NULL,
    extraction_error VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_curriculum_document_sha256 (sha256),
    KEY idx_curriculum_documents_year_subject (year_group, subject_name),
    KEY idx_curriculum_documents_review (review_status, extraction_status),
    CONSTRAINT fk_curriculum_document_source FOREIGN KEY (source_id) REFERENCES curriculum_sources(id) ON DELETE SET NULL,
    CONSTRAINT fk_curriculum_document_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_curriculum_document_verifier FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS curriculum_sections (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    document_id BIGINT UNSIGNED NOT NULL,
    parent_id BIGINT UNSIGNED NULL,
    section_type ENUM('document', 'subject', 'strand', 'sub_strand', 'focal_area', 'section', 'content_standard', 'learning_indicator', 'topic', 'other') NOT NULL DEFAULT 'other',
    source_chunk_id BIGINT UNSIGNED NULL,
    ai_generated TINYINT(1) NOT NULL DEFAULT 0,
    model_used VARCHAR(120) NULL,
    code VARCHAR(120) NULL,
    title VARCHAR(500) NOT NULL,
    body MEDIUMTEXT NULL,
    page_number INT UNSIGNED NULL,
    review_status ENUM('unreviewed', 'in_review', 'verified', 'rejected') NOT NULL DEFAULT 'unreviewed',
    verified_by BIGINT UNSIGNED NULL,
    verified_at DATETIME NULL,
    review_notes TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_curriculum_sections_document_type (document_id, section_type),
    KEY idx_curriculum_sections_parent (parent_id),
    KEY idx_curriculum_sections_source_chunk (source_chunk_id),
    FULLTEXT KEY ft_curriculum_sections_text (title, body),
    CONSTRAINT fk_curriculum_sections_document FOREIGN KEY (document_id) REFERENCES curriculum_documents(id) ON DELETE CASCADE,
    CONSTRAINT fk_curriculum_sections_parent FOREIGN KEY (parent_id) REFERENCES curriculum_sections(id) ON DELETE SET NULL,
    CONSTRAINT fk_curriculum_sections_verifier FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS curriculum_chunks (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    document_id BIGINT UNSIGNED NOT NULL,
    section_id BIGINT UNSIGNED NULL,
    chunk_index INT UNSIGNED NOT NULL,
    page_start INT UNSIGNED NULL,
    page_end INT UNSIGNED NULL,
    content MEDIUMTEXT NOT NULL,
    content_sha256 CHAR(64) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_curriculum_chunk_doc_index (document_id, chunk_index),
    FULLTEXT KEY ft_curriculum_chunks_content (content),
    CONSTRAINT fk_curriculum_chunks_document FOREIGN KEY (document_id) REFERENCES curriculum_documents(id) ON DELETE CASCADE,
    CONSTRAINT fk_curriculum_chunks_section FOREIGN KEY (section_id) REFERENCES curriculum_sections(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE curriculum_sections
    ADD CONSTRAINT fk_curriculum_sections_source_chunk
    FOREIGN KEY (source_chunk_id) REFERENCES curriculum_chunks(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS curriculum_ingestion_jobs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    document_id BIGINT UNSIGNED NOT NULL,
    requested_by BIGINT UNSIGNED NULL,
    status ENUM('queued', 'processing', 'completed', 'needs_ocr', 'failed') NOT NULL DEFAULT 'queued',
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    error_message VARCHAR(500) NULL,
    started_at DATETIME NULL,
    completed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_ingestion_jobs_status_created (status, created_at),
    CONSTRAINT fk_ingestion_job_document FOREIGN KEY (document_id) REFERENCES curriculum_documents(id) ON DELETE CASCADE,
    CONSTRAINT fk_ingestion_job_user FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS saved_documents (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    document_type VARCHAR(40) NOT NULL,
    title VARCHAR(255) NOT NULL,
    subject_name VARCHAR(190) NULL,
    year_group VARCHAR(30) NULL,
    class_name VARCHAR(120) NULL,
    status ENUM('draft', 'ready', 'archived', 'failed') NOT NULL DEFAULT 'draft',
    source_input JSON NOT NULL,
    generated_content JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_saved_documents_owner_type (user_id, document_type, updated_at),
    CONSTRAINT fk_saved_documents_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    actor_user_id BIGINT UNSIGNED NULL,
    action_name VARCHAR(120) NOT NULL,
    target_type VARCHAR(80) NULL,
    target_id VARCHAR(100) NULL,
    metadata JSON NULL,
    request_id CHAR(32) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_audit_actor_time (actor_user_id, created_at),
    KEY idx_audit_action_time (action_name, created_at),
    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
