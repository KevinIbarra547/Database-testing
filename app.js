const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const {
  execute,
  getConfigurationMessage,
  isConfigured,
} = require("./db");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "development-only-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  }),
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.dbConfigured = isConfigured;
  res.locals.dbMessage = getConfigurationMessage();
  next();
});

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validateSignup({ username, email, password }) {
  if (!username || !email || !password) return "Username, email, and password are required.";
  if (username.length > 25) return "Username must be 25 characters or fewer.";
  if (email.length > 255) return "Email must be 255 characters or fewer.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  return null;
}

function validateQuestion({ title, body }) {
  if (!title || !body) return "Title and question body are required.";
  if (title.length > 150) return "Title must be 150 characters or fewer.";
  return null;
}

function validateAnswer(body) {
  return body ? null : "Answer text is required.";
}

function friendlyDatabaseError(error) {
  if (error.code === "DB_NOT_CONFIGURED") return error.message;
  if (error.code === "ER_DUP_ENTRY") {
    if (String(error.message).includes("Uname")) return "That username is already taken.";
    if (String(error.message).includes("email")) return "That email is already registered.";
    return "That value is already in use.";
  }
  console.error(error);
  return "Something went wrong while talking to the database. Please try again.";
}

function renderDatabaseError(res, error, template, data = {}) {
  return res.status(error.code === "DB_NOT_CONFIGURED" ? 503 : 500).render(template, {
    ...data,
    error: friendlyDatabaseError(error),
  });
}

app.get(
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

app.get("/signup", (req, res) => {
  res.render("signup", { title: "Sign up", error: null, form: {} });
});

app.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const form = {
      username: clean(req.body.username),
      email: clean(req.body.email),
    };
    const password = req.body.password || "";
    const validationError = validateSignup({ ...form, password });
    if (validationError) {
      return res.status(400).render("signup", {
        title: "Sign up",
        error: validationError,
        form,
      });
    }

    try {
      const passwordHash = await bcrypt.hash(password, 12);
      // Store the bcrypt hash, never the password a student typed.
      await execute(
        "INSERT INTO Qa1_users (Uname, password, email) VALUES (?, ?, ?)",
        [form.username, passwordHash, form.email],
      );
      res.redirect("/login?created=1");
    } catch (error) {
      res.status(error.code === "DB_NOT_CONFIGURED" ? 503 : 400).render("signup", {
        title: "Sign up",
        error: friendlyDatabaseError(error),
        form,
      });
    }
  }),
);

app.get("/login", (req, res) => {
  res.render("login", {
    title: "Log in",
    error: null,
    created: req.query.created === "1",
  });
});

app.post(
  "/login",
  asyncHandler(async (req, res) => {
    const username = clean(req.body.username);
    const password = req.body.password || "";
    if (!username || !password) {
      return res.status(400).render("login", {
        title: "Log in",
        error: "Username and password are required.",
        created: false,
      });
    }

    try {
      // Fetch by username, then compare the typed password with the stored hash.
      const [users] = await execute(
        "SELECT uid_user, Uname, password FROM Qa1_users WHERE Uname = ? LIMIT 1",
        [username],
      );
      const user = users[0];
      const matches = user ? await bcrypt.compare(password, user.password) : false;
      if (!matches) {
        return res.status(401).render("login", {
          title: "Log in",
          error: "Username or password is incorrect.",
          created: false,
        });
      }

      req.session.user = { id: user.uid_user, username: user.Uname };
      res.redirect("/");
    } catch (error) {
      renderDatabaseError(res, error, "login", { created: false });
    }
  }),
);

app.post("/logout", requireLogin, (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.get("/questions/new", requireLogin, (req, res) => {
  res.render("new-question", { title: "Ask a question", error: null, form: {} });
});

app.post(
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

app.get(
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
      res.render("question", { title: question.title, question, answers, error: null });
    } catch (error) {
      renderDatabaseError(res, error, "setup");
    }
  }),
);

app.get(
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

app.post(
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

app.post(
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

app.post(
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

app.get(
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

app.post(
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

app.post(
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

app.use((req, res) => {
  res.status(404).render("404", { title: "Page not found" });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).render("error", {
    title: "Something went wrong",
    error: "Something went wrong. Please try again.",
  });
});

if (!process.env.SESSION_SECRET) {
  console.warn("SESSION_SECRET is missing. Add it in Replit Secrets before using logins.");
}
if (!isConfigured) {
  console.warn(getConfigurationMessage());
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Q&A app listening on port ${PORT}`);
});