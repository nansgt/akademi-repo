ALTER TABLE assessment_attempts
    ADD COLUMN question_order_json MEDIUMTEXT NULL AFTER attempt_token_hash;
