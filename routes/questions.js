const express = require("express");
const { execute, isConfigured } = require("../db");
const { asyncHandler, clean, renderDatabaseError, requireLogin } = require("../lib/helpers");
const { validateQuestion } = require("../lib/validation");

const router = express.Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    if (!isConfigured) return res.render("setup", { title: "Database setup" });

    try {
      // Join users and answers so the home page can show authors and counts.
      const [questions] = await execute(
        `SELECT q.question_id, q.title, q.body, q.created_at,
                u.Uname AS username, COUNT(a.answer_id) AS answer_count
         FROM Qa1_questions q
         JOIN Qa1_users u ON u.uid_user = q.uid_user
         LEFT JOIN Qa1_answers a ON a.question_id = q.question_id
         GROUP BY q.question_id, q.title, q.body, q.created_at, u.Uname
         ORDER BY q.created_at DESC, q.question_id DESC`,
      );
      res.render("index", { title: "All questions", questions });
    } catch (error) {
      renderDatabaseError(res, error, "setup");
    }
  }),
);

router.get("/questions/new", requireLogin, (req, res) => {
  res.render("new-question", { title: "Ask a question", error: null, form: {} });
});

router.post(
  "/questions/new",
  requireLogin,
  asyncHandler(async (req, res) => {
    const form = {
      title: clean(req.body.title),
      body: clean(req.body.body),
    };
    const validationError = validateQuestion(form);
    if (validationError) {
      return res.status(400).render("new-question", {
        title: "Ask a question",
        error: validationError,
        form,
      });
    }

    try {
      // The logged-in user's id comes from the session, not from the form.
      const [result] = await execute(
        "INSERT INTO Qa1_questions (uid_user, title, body) VALUES (?, ?, ?)",
        [req.session.user.id, form.title, form.body],
      );
      res.redirect(`/questions/${result.insertId}`);
    } catch (error) {
      renderDatabaseError(res, error, "new-question", { form });
    }
  }),
);

router.get(
  "/questions/:id",
  asyncHandler(async (req, res) => {
    try {
      // Load one question and its answers separately to keep each query readable.
      const [questions] = await execute(
        `SELECT q.question_id, q.uid_user, q.title, q.body, q.created_at,
                u.Uname AS username
         FROM Qa1_questions q
         JOIN Qa1_users u ON u.uid_user = q.uid_user
         WHERE q.question_id = ?`,
        [req.params.id],
      );
      const question = questions[0];
      if (!question) return res.status(404).render("404", { title: "Question not found" });

      const [answers] = await execute(
        `SELECT a.answer_id, a.uid_user, a.body, a.created_at,
                u.Uname AS username
         FROM Qa1_answers a
         JOIN Qa1_users u ON u.uid_user = a.uid_user
         WHERE a.question_id = ?
         ORDER BY a.created_at ASC, a.answer_id ASC`,
        [req.params.id],
      );
      res.render("question", {
        title: question.title,
        question,
        answers,
        error: req.query.error === "answer" ? "Answer text is required." : null,
      });
    } catch (error) {
      renderDatabaseError(res, error, "setup");
    }
  }),
);

router.get(
  "/questions/:id/edit",
  requireLogin,
  asyncHandler(async (req, res) => {
    try {
      const [questions] = await execute(
        "SELECT question_id, uid_user, title, body FROM Qa1_questions WHERE question_id = ?",
        [req.params.id],
      );
      const question = questions[0];
      if (!question) return res.status(404).render("404", { title: "Question not found" });
      if (question.uid_user !== req.session.user.id) {
        return res.status(403).render("error", {
          title: "Not allowed",
          error: "You can only edit your own questions.",
        });
      }
      res.render("edit-question", { title: "Edit question", question, error: null });
    } catch (error) {
      renderDatabaseError(res, error, "setup");
    }
  }),
);

router.post(
  "/questions/:id/edit",
  requireLogin,
  asyncHandler(async (req, res) => {
    const form = { title: clean(req.body.title), body: clean(req.body.body) };
    const validationError = validateQuestion(form);
    if (validationError) {
      return res.status(400).render("edit-question", {
        title: "Edit question",
        question: { question_id: req.params.id, ...form },
        error: validationError,
      });
    }

    try {
      const [questions] = await execute(
        "SELECT uid_user FROM Qa1_questions WHERE question_id = ?",
        [req.params.id],
      );
      const question = questions[0];
      if (!question) return res.status(404).render("404", { title: "Question not found" });
      if (question.uid_user !== req.session.user.id) {
        return res.status(403).render("error", {
          title: "Not allowed",
          error: "You can only edit your own questions.",
        });
      }
      await execute(
        "UPDATE Qa1_questions SET title = ?, body = ? WHERE question_id = ? AND uid_user = ?",
        [form.title, form.body, req.params.id, req.session.user.id],
      );
      res.redirect(`/questions/${req.params.id}`);
    } catch (error) {
      renderDatabaseError(res, error, "edit-question", {
        question: { question_id: req.params.id, ...form },
      });
    }
  }),
);

router.post(
  "/questions/:id/delete",
  requireLogin,
  asyncHandler(async (req, res) => {
    try {
      const [result] = await execute(
        "DELETE FROM Qa1_questions WHERE question_id = ? AND uid_user = ?",
        [req.params.id, req.session.user.id],
      );
      if (result.affectedRows === 0) {
        return res.status(403).render("error", {
          title: "Not allowed",
          error: "You can only delete your own questions.",
        });
      }
      // The database's ON DELETE CASCADE removes this question's answers.
      res.redirect("/");
    } catch (error) {
      renderDatabaseError(res, error, "setup");
    }
  }),
);

module.exports = router;
