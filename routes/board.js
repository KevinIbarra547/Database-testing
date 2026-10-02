const express = require("express");
const { execute, withTransaction } = require("../db");
const { asyncHandler, clean, renderDatabaseError, requireLogin } = require("../lib/helpers");
const {
  MAX_EDITS,
  STATUSES,
  parseId,
  shapeListItem,
  shapePost,
  shapeReply,
  validateEdit,
  validateNewPost,
} = require("../lib/board");

// The class board. Everything is stored in Qa1_board_posts:
// posts have parent_id NULL, replies point to their post with parent_id.
// Nothing is ever deleted here: "delete" only sets deleted_at.
const router = express.Router();

const POST_COLUMNS = `p.post_id, p.uid_user, p.parent_id, p.question_id, p.linked_question_title,
  p.post_type, p.status, p.title, p.body, p.original_title, p.original_body, p.edit_count,
  p.link_url, p.event_at, p.created_at, p.updated_at, p.deleted_at`;

function notAllowed(res, message) {
  return res.status(403).render("error", { title: "Not allowed", error: message });
}

function notFound(res) {
  return res.status(404).render("404", { title: "Post not found" });
}

// Where to send the user back to after changing a post or reply.
function postUrl(row) {
  return row.parent_id ? `/board/${row.parent_id}#post-${row.post_id}` : `/board/${row.post_id}`;
}

// Loads one post or reply (any state) with its author's name.
async function findPost(id) {
  const [rows] = await execute(
    `SELECT ${POST_COLUMNS}, u.Uname AS username
     FROM Qa1_board_posts p
     JOIN Qa1_users u ON u.uid_user = p.uid_user
     WHERE p.post_id = ?`,
    [id],
  );
  return rows[0] || null;
}

function renderForm(res, status, data) {
  return res.status(status).render("board/form", { error: null, linked_question: null, ...data });
}

router.get(
  "/board",
  asyncHandler(async (req, res) => {
    try {
      // Top-level posts only. The subquery counts each post's replies live,
      // so the number can never get out of date.
      const [rows] = await execute(
        `SELECT p.post_id, p.post_type, p.status, p.title, p.event_at, p.created_at,
                p.deleted_at, u.Uname AS username,
                (SELECT COUNT(*) FROM Qa1_board_posts r WHERE r.parent_id = p.post_id) AS reply_count
         FROM Qa1_board_posts p
         JOIN Qa1_users u ON u.uid_user = p.uid_user
         WHERE p.parent_id IS NULL
         ORDER BY p.is_pinned DESC, p.created_at DESC, p.post_id DESC`,
      );
      res.render("board/index", { title: "Class board", posts: rows.map(shapeListItem) });
    } catch (error) {
      renderDatabaseError(res, error, "error", { title: "Class board" });
    }
  }),
);

router.get(
  "/board/new",
  requireLogin,
  asyncHandler(async (req, res) => {
    const form = { title: "", body: "", post_type: "discussion", link_url: "", event_at: "", question_id: "" };
    const formPage = {
      title: "New board post",
      mode: "new",
      is_reply: false,
      action: "/board/new",
      cancel_url: "/board",
      form,
    };

    // "Discuss this on the board" links here with ?question_id=12.
    const questionId = parseId(req.query.question_id);
    if (!questionId) return renderForm(res, 200, formPage);
    try {
      const [questions] = await execute(
        "SELECT question_id, title FROM Qa1_questions WHERE question_id = ?",
        [questionId],
      );
      const question = questions[0];
      if (!question) return renderForm(res, 200, formPage);
      form.question_id = String(question.question_id);
      form.title = `Discussing: ${question.title}`.slice(0, 150);
      formPage.cancel_url = `/questions/${question.question_id}`;
      renderForm(res, 200, { ...formPage, linked_question: question });
    } catch (error) {
      renderDatabaseError(res, error, "board/form", formPage);
    }
  }),
);

router.post(
  "/board/new",
  requireLogin,
  asyncHandler(async (req, res) => {
    const form = {
      title: clean(req.body.title),
      body: clean(req.body.body),
      post_type: clean(req.body.post_type),
      link_url: clean(req.body.link_url),
      event_at: clean(req.body.event_at),
      question_id: clean(req.body.question_id),
    };
    const formPage = {
      title: "New board post",
      mode: "new",
      is_reply: false,
      action: "/board/new",
      cancel_url: "/board",
      form,
    };
    const { error, values } = validateNewPost(form);
    if (error) return renderForm(res, 400, { ...formPage, error });

    try {
      // A transaction so the linked question can't be deleted between
      // looking up its title and saving the post.
      const result = await withTransaction(async (connection) => {
        let linkedTitle = null;
        if (values.question_id) {
          const [questions] = await connection.execute(
            "SELECT title FROM Qa1_questions WHERE question_id = ? LOCK IN SHARE MODE",
            [values.question_id],
          );
          if (!questions[0]) return { error: `There is no question #${values.question_id}.` };
          // Keep a copy of the title so the post can still name it if it is deleted later.
          linkedTitle = questions[0].title;
        }
        const [insert] = await connection.execute(
          `INSERT INTO Qa1_board_posts
             (uid_user, question_id, linked_question_title, post_type, title, body, link_url, event_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            req.session.user.id,
            values.question_id,
            linkedTitle,
            values.post_type,
            values.title,
            values.body,
            values.link_url,
            values.event_at,
          ],
        );
        return { postId: insert.insertId };
      });

      if (result.error) return renderForm(res, 400, { ...formPage, error: result.error });
      res.redirect(`/board/${result.postId}`);
    } catch (error) {
      renderDatabaseError(res, error, "board/form", formPage);
    }
  }),
);

async function renderPostPage(req, res, postId, replyError = null, replyForm = { body: "" }) {
  const user = req.session.user || null;
  // LEFT JOIN: the linked question may not exist (no link, or it was deleted).
  const [posts] = await execute(
    `SELECT ${POST_COLUMNS}, u.Uname AS username, q.title AS live_question_title
     FROM Qa1_board_posts p
     JOIN Qa1_users u ON u.uid_user = p.uid_user
     LEFT JOIN Qa1_questions q ON q.question_id = p.question_id
     WHERE p.post_id = ?`,
    [postId],
  );
  const row = posts[0];
  if (!row) return notFound(res);
  // A reply's own URL shows the post it belongs to.
  if (row.parent_id) return res.redirect(postUrl(row));

  const [replyRows] = await execute(
    `SELECT ${POST_COLUMNS}, u.Uname AS username
     FROM Qa1_board_posts p
     JOIN Qa1_users u ON u.uid_user = p.uid_user
     WHERE p.parent_id = ?
     ORDER BY p.created_at ASC, p.post_id ASC`,
    [postId],
  );
  const post = shapePost(row, user);
  res.status(replyError ? 400 : 200).render("board/show", {
    title: post.is_deleted ? "Deleted post" : post.title,
    post,
    replies: replyRows.map((reply) => shapeReply(reply, user)),
    can_reply: Boolean(user) && !post.is_deleted && post.status !== "closed",
    reply_error: replyError,
    reply_form: replyForm,
  });
}

router.get(
  "/board/:id",
  asyncHandler(async (req, res) => {
    const postId = parseId(req.params.id);
    if (!postId) return notFound(res);
    try {
      await renderPostPage(req, res, postId);
    } catch (error) {
      renderDatabaseError(res, error, "error", { title: "Class board" });
    }
  }),
);

router.post(
  "/board/:id/replies",
  requireLogin,
  asyncHandler(async (req, res) => {
    const postId = parseId(req.params.id);
    if (!postId) return notFound(res);
    const body = clean(req.body.body);

    try {
      if (!body) return await renderPostPage(req, res, postId, "Reply text is required.", { body });

      // FOR UPDATE locks the post while we check it, so it can't be closed
      // or deleted halfway through saving the reply.
      const result = await withTransaction(async (connection) => {
        const [parents] = await connection.execute(
          `SELECT post_id, parent_id, post_type, status, deleted_at
           FROM Qa1_board_posts WHERE post_id = ? FOR UPDATE`,
          [postId],
        );
        const parent = parents[0];
        if (!parent) return { notFound: true };
        // Replies are one level only: you can't reply to a reply.
        if (parent.parent_id !== null) {
          return { error: "You can only reply to a post, not to a reply.", pageId: parent.parent_id };
        }
        if (parent.deleted_at !== null) return { error: "This post was deleted, so it can't get new replies." };
        if (parent.status === "closed") return { error: "This post is closed to new replies." };

        // Replies copy their post's type and status.
        const [insert] = await connection.execute(
          `INSERT INTO Qa1_board_posts (uid_user, parent_id, post_type, status, body)
           VALUES (?, ?, ?, ?, ?)`,
          [req.session.user.id, postId, parent.post_type, parent.status, body],
        );
        return { replyId: insert.insertId };
      });

      if (result.notFound) return notFound(res);
      if (result.error) return await renderPostPage(req, res, result.pageId || postId, result.error, { body });
      res.redirect(`/board/${postId}#post-${result.replyId}`);
    } catch (error) {
      renderDatabaseError(res, error, "error", { title: "Class board" });
    }
  }),
);

// Checks that the logged-in user may edit this post or reply right now.
// Returns an error message, or null when editing is allowed.
function editBlocker(row, user) {
  if (row.uid_user !== user.id) return "You can only edit your own posts.";
  if (row.deleted_at !== null) return "Deleted posts can't be edited.";
  if (row.edit_count >= MAX_EDITS) return "You've already used your one edit on this post.";
  return null;
}

function editFormPage(row, form) {
  const isReply = row.parent_id !== null;
  return {
    title: isReply ? "Edit reply" : "Edit post",
    mode: "edit",
    is_reply: isReply,
    action: `/board/${row.post_id}/edit`,
    cancel_url: postUrl(row),
    form,
  };
}

router.get(
  "/board/:id/edit",
  requireLogin,
  asyncHandler(async (req, res) => {
    const postId = parseId(req.params.id);
    if (!postId) return notFound(res);
    try {
      const row = await findPost(postId);
      if (!row) return notFound(res);
      const blocker = editBlocker(row, req.session.user);
      if (blocker) return notAllowed(res, blocker);
      renderForm(res, 200, editFormPage(row, { title: row.title || "", body: row.body }));
    } catch (error) {
      renderDatabaseError(res, error, "error", { title: "Class board" });
    }
  }),
);

router.post(
  "/board/:id/edit",
  requireLogin,
  asyncHandler(async (req, res) => {
    const postId = parseId(req.params.id);
    if (!postId) return notFound(res);
    const form = { title: clean(req.body.title), body: clean(req.body.body) };

    try {
      const row = await findPost(postId);
      if (!row) return notFound(res);
      const isReply = row.parent_id !== null;
      const blocker = editBlocker(row, req.session.user);
      if (blocker) return notAllowed(res, blocker);

      const validationError = validateEdit(form, isReply);
      if (validationError) return renderForm(res, 400, { ...editFormPage(row, form), error: validationError });

      // One statement does the whole edit: MySQL runs the SET parts left to right,
      // so original_title/original_body get the OLD text before it is replaced.
      // "edit_count < MAX_EDITS" in the WHERE makes a second edit (or a double-click) change nothing.
      const [result] = await execute(
        `UPDATE Qa1_board_posts
         SET original_title = title, original_body = body,
             title = ?, body = ?, edit_count = edit_count + 1
         WHERE post_id = ? AND uid_user = ? AND edit_count < ? AND deleted_at IS NULL`,
        [isReply ? null : form.title, form.body, postId, req.session.user.id, MAX_EDITS],
      );
      if (result.affectedRows === 0) return notAllowed(res, "You've already used your one edit on this post.");
      res.redirect(postUrl(row));
    } catch (error) {
      renderDatabaseError(res, error, "error", { title: "Class board" });
    }
  }),
);

router.post(
  "/board/:id/delete",
  requireLogin,
  asyncHandler(async (req, res) => {
    const postId = parseId(req.params.id);
    if (!postId) return notFound(res);
    try {
      const row = await findPost(postId);
      if (!row) return notFound(res);
      if (row.uid_user !== req.session.user.id) return notAllowed(res, "You can only delete your own posts.");

      // Soft delete: the row stays, it is only marked as deleted.
      // The uid_user check in the WHERE is the real ownership guard.
      await execute(
        `UPDATE Qa1_board_posts SET deleted_at = NOW()
         WHERE post_id = ? AND uid_user = ? AND deleted_at IS NULL`,
        [postId, req.session.user.id],
      );
      res.redirect(postUrl(row));
    } catch (error) {
      renderDatabaseError(res, error, "error", { title: "Class board" });
    }
  }),
);

router.post(
  "/board/:id/status",
  requireLogin,
  asyncHandler(async (req, res) => {
    const postId = parseId(req.params.id);
    if (!postId) return notFound(res);
    const status = clean(req.body.status);
    if (!STATUSES.includes(status)) {
      return res.status(400).render("error", { title: "Invalid status", error: "Please choose a valid status." });
    }

    try {
      // Only the author, only top-level posts, only while not deleted.
      const [result] = await execute(
        `UPDATE Qa1_board_posts SET status = ?
         WHERE post_id = ? AND uid_user = ? AND parent_id IS NULL AND deleted_at IS NULL`,
        [status, postId, req.session.user.id],
      );
      if (result.affectedRows === 0) {
        const row = await findPost(postId);
        if (!row) return notFound(res);
        return notAllowed(res, "You can only change the status of your own posts.");
      }
      res.redirect(`/board/${postId}`);
    } catch (error) {
      renderDatabaseError(res, error, "error", { title: "Class board" });
    }
  }),
);

module.exports = router;
