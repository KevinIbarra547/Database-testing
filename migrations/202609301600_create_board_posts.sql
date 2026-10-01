-- The class board: posts and their replies, all in ONE new table.
-- This only ADDS a table. Qa1_users, Qa1_questions and Qa1_answers are not changed.
--
--   parent_id    NULL = a post; a number = a reply to that post (one level only,
--                checked by the server).
--   question_id  optional link to a Q&A question. If that question is deleted,
--                MySQL sets this to NULL and the saved linked_question_title lets
--                the page say which question was deleted.
--   original_*   the text from before the one allowed edit (edit_count 0 or 1).
--   deleted_at   "soft delete": rows are never removed, only marked as deleted.
--
-- Effect on existing tables: a user who has board posts cannot be deleted
-- (fk_board_posts_user has no ON DELETE rule, so MySQL blocks it).
--
-- The id columns must match the columns they point to exactly (plain INT).
-- If this fails with "errno: 150", run DESCRIBE Qa1_users; and
-- DESCRIBE Qa1_questions; in phpMyAdmin and compare the types.
CREATE TABLE IF NOT EXISTS Qa1_board_posts (
  post_id INT NOT NULL AUTO_INCREMENT,
  uid_user INT NOT NULL,
  parent_id INT NULL,
  question_id INT NULL,
  linked_question_title VARCHAR(150) NULL,
  post_type ENUM('discussion', 'study_group', 'resource') NOT NULL DEFAULT 'discussion',
  status ENUM('open', 'resolved', 'closed') NOT NULL DEFAULT 'open',
  title VARCHAR(150) NULL,
  body TEXT NOT NULL,
  original_title VARCHAR(150) NULL,
  original_body TEXT NULL,
  edit_count TINYINT NOT NULL DEFAULT 0,
  link_url VARCHAR(500) NULL,
  event_at DATETIME NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (post_id),
  CONSTRAINT fk_board_posts_user FOREIGN KEY (uid_user)
    REFERENCES Qa1_users (uid_user),
  CONSTRAINT fk_board_posts_parent FOREIGN KEY (parent_id)
    REFERENCES Qa1_board_posts (post_id),
  CONSTRAINT fk_board_posts_question FOREIGN KEY (question_id)
    REFERENCES Qa1_questions (question_id) ON DELETE SET NULL,
  CONSTRAINT chk_board_posts_edit_count CHECK (edit_count IN (0, 1))
) ENGINE=InnoDB;
