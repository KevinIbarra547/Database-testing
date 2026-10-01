-- The "lock": the database itself refuses to DELETE any board post, even a
-- DELETE typed by hand in phpMyAdmin. The website never deletes; it sets
-- deleted_at instead.
--
-- This is in its own file because some hosting plans do not allow triggers.
-- If this file fails with an "access denied" or "SUPER privilege" error, the
-- board still works; only this extra database-level lock is missing.
--
-- The lock only blocks deleting rows. DROP TABLE Qa1_board_posts still works
-- (and removes this trigger too), so the whole feature can still be undone.
-- To remove just the lock later, add a NEW migration containing:
--   DROP TRIGGER trg_board_posts_no_delete;
CREATE TRIGGER trg_board_posts_no_delete
BEFORE DELETE ON Qa1_board_posts
FOR EACH ROW
SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'Board posts cannot be deleted. Set deleted_at instead.';
