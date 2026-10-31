ALTER TABLE assessment_roster
    ADD COLUMN access_code_encrypted TEXT NULL AFTER access_code_hash;

ALTER TABLE assessment_attempts
    ADD COLUMN timed_out_questions_json TEXT NULL AFTER answers_json;
