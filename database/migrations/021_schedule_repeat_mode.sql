SET @schedule_repeat_mode_exists = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'teacher_schedule_entries'
      AND COLUMN_NAME = 'repeat_mode'
);
SET @schedule_repeat_mode_migration = IF(
    @schedule_repeat_mode_exists = 0,
    'ALTER TABLE teacher_schedule_entries ADD COLUMN repeat_mode ENUM(''weekly'', ''daily'', ''custom'') NOT NULL DEFAULT ''weekly'' AFTER color',
    'SET @schedule_repeat_mode_noop = 1'
);
PREPARE schedule_repeat_mode_statement FROM @schedule_repeat_mode_migration;
EXECUTE schedule_repeat_mode_statement;
DEALLOCATE PREPARE schedule_repeat_mode_statement;

UPDATE teacher_schedule_entries
SET repeat_mode = 'custom'
WHERE starts_on IS NOT NULL OR repeat_until IS NOT NULL OR repeat_interval_weeks > 1;
