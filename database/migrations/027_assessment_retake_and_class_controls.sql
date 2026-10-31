ALTER TABLE online_assessment_classes
    ADD COLUMN status ENUM('active', 'paused', 'closed') NOT NULL DEFAULT 'active' AFTER class_id;

ALTER TABLE assessment_attempts
    DROP INDEX uq_assessment_attempt_roster,
    MODIFY status ENUM('in_progress', 'submitted', 'expired', 'superseded') NOT NULL DEFAULT 'in_progress',
    ADD COLUMN attempt_number SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER roster_id,
    ADD COLUMN superseded_from_status ENUM('in_progress', 'submitted', 'expired') NULL AFTER status,
    ADD UNIQUE KEY uq_assessment_attempt_number (assessment_id, roster_id, attempt_number);

ALTER TABLE assessment_attempt_events
    MODIFY event_type ENUM(
        'tab_hidden',
        'window_blur',
        'fullscreen_exit',
        'copy_attempt',
        'paste_attempt',
        'context_menu',
        'cut_attempt',
        'screenshot_attempt'
    ) NOT NULL;
