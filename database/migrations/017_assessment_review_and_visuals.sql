ALTER TABLE assessment_attempts
    ADD COLUMN question_reviews_json MEDIUMTEXT NULL AFTER timed_out_questions_json;

ALTER TABLE online_assessments
    ADD COLUMN question_revision_counts_json TEXT NULL AFTER questions_json;
