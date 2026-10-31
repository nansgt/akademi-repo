CREATE TABLE IF NOT EXISTS presentation_simulation_question_replies (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    question_id BIGINT UNSIGNED NOT NULL,
    feedback VARCHAR(1000) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_presentation_question_replies_question (question_id, created_at),
    CONSTRAINT fk_presentation_question_replies_question FOREIGN KEY (question_id)
        REFERENCES presentation_simulation_questions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO presentation_simulation_question_replies (question_id, feedback, created_at)
SELECT q.id, q.teacher_feedback, COALESCE(q.answered_at, q.created_at)
FROM presentation_simulation_questions q
WHERE q.teacher_feedback IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM presentation_simulation_question_replies r
      WHERE r.question_id = q.id
  );
