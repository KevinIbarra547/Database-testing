const express = require("express");
const bcrypt = require("bcrypt");
const { execute } = require("../db");
const {
  asyncHandler,
  clean,
  friendlyDatabaseError,
  renderDatabaseError,
  requireLogin,
} = require("../lib/helpers");
const { validateSignup } = require("../lib/validation");

const router = express.Router();

router.get("/signup", (req, res) => {
  res.render("signup", { title: "Sign up", error: null, form: {} });
});

router.post(
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

router.get("/login", (req, res) => {
  res.render("login", {
    title: "Log in",
    error: null,
    created: req.query.created === "1",
  });
});

router.post(
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

router.post("/logout", requireLogin, (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

module.exports = router;
