ALTER TABLE teacher_schedule_entries
    ADD COLUMN starts_on DATE NULL AFTER color,
    ADD COLUMN repeat_interval_weeks TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER starts_on,
    ADD COLUMN repeat_until DATE NULL AFTER repeat_interval_weeks;
