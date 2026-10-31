ALTER TABLE online_assessments
    ADD COLUMN share_token CHAR(64) NULL AFTER owner_user_id;

UPDATE online_assessments
SET share_token = SHA2(CONCAT(id, '-', UUID(), '-', RAND()), 256)
WHERE share_token IS NULL;

ALTER TABLE online_assessments
    MODIFY share_token CHAR(64) NOT NULL,
    ADD UNIQUE KEY uq_online_assessments_share_token (share_token);
