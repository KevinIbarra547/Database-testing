const express = require("express");
const { execute } = require("../db");
const { asyncHandler, clean, renderDatabaseError, requireLogin } = require("../lib/helpers");
const { validateAnswer } = require("../lib/validation");

const router = express.Router();

router.post(
  "/questions/:id/answers",
  requireLogin,
  asyncHandler(async (req, res) => {
    const body = clean(req.body.body);
    const validationError = validateAnswer(body);
    if (validationError) return res.redirect(`/questions/${req.params.id}?error=answer`);

    try {
      const [questions] = await execute(
        "SELECT question_id FROM Qa1_questions WHERE question_id = ?",
        [req.params.id],
      );
      if (!questions[0]) return res.status(404).render("404", { title: "Question not found" });
      await execute(
        "INSERT INTO Qa1_answers (question_id, uid_user, body) VALUES (?, ?, ?)",
        [req.params.id, req.session.user.id, body],
      );
      res.redirect(`/questions/${req.params.id}`);
    } catch (error) {
      renderDatabaseError(res, error, "setup");
    }
  }),
);

router.get(
  "/answers/:id/edit",
  requireLogin,
  asyncHandler(async (req, res) => {
    try {
      const [answers] = await execute(
        `SELECT answer_id, question_id, uid_user, body
         FROM Qa1_answers WHERE answer_id = ?`,
        [req.params.id],
      );
      const answer = answers[0];
      if (!answer) return res.status(404).render("404", { title: "Answer not found" });
      if (answer.uid_user !== req.session.user.id) {
        return res.status(403).render("error", {
          title: "Not allowed",
          error: "You can only edit your own answers.",
        });
      }
      res.render("edit-answer", { title: "Edit answer", answer, error: null });
    } catch (error) {
      renderDatabaseError(res, error, "setup");
    }
  }),
);

router.post(
  "/answers/:id/edit",
  requireLogin,
  asyncHandler(async (req, res) => {
    const body = clean(req.body.body);
    const validationError = validateAnswer(body);
    try {
      const [answers] = await execute(
        "SELECT answer_id, question_id, uid_user, body FROM Qa1_answers WHERE answer_id = ?",
        [req.params.id],
      );
      const answer = answers[0];
      if (!answer) return res.status(404).render("404", { title: "Answer not found" });
      if (answer.uid_user !== req.session.user.id) {
        return res.status(403).render("error", {
          title: "Not allowed",
          error: "You can only edit your own answers.",
        });
      }
      if (validationError) {
        return res.status(400).render("edit-answer", {
          title: "Edit answer",
          answer: { ...answer, body },
          error: validationError,
        });
      }
      await execute(
        "UPDATE Qa1_answers SET body = ? WHERE answer_id = ? AND uid_user = ?",
        [body, req.params.id, req.session.user.id],
      );
      res.redirect(`/questions/${answer.question_id}`);
    } catch (error) {
      renderDatabaseError(res, error, "edit-answer", {
        answer: { answer_id: req.params.id, body },
      });
    }
  }),
);

router.post(
  "/answers/:id/delete",
  requireLogin,
  asyncHandler(async (req, res) => {
    try {
      const [answers] = await execute(
        "SELECT question_id FROM Qa1_answers WHERE answer_id = ? AND uid_user = ?",
        [req.params.id, req.session.user.id],
      );
      const answer = answers[0];
      if (!answer) {
        return res.status(403).render("error", {
          title: "Not allowed",
          error: "You can only delete your own answers.",
        });
      }
      await execute("DELETE FROM Qa1_answers WHERE answer_id = ? AND uid_user = ?", [
        req.params.id,
        req.session.user.id,
      ]);
      res.redirect(`/questions/${answer.question_id}`);
    } catch (error) {
      renderDatabaseError(res, error, "setup");
    }
  }),
);

module.exports = router;
