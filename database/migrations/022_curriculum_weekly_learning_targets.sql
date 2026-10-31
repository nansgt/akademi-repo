ALTER TABLE curriculum_weekly_lessons
    ADD COLUMN learning_indicators JSON NULL AFTER focal_areas,
    ADD COLUMN learning_outcomes JSON NULL AFTER learning_indicators;
