ALTER TABLE teacher_schedule_entries
    ADD COLUMN end_time TIME NULL AFTER start_time,
    ADD COLUMN color CHAR(7) NULL AFTER topic;
