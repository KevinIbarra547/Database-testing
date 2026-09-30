const path = require("path");
const express = require("express");
const session = require("express-session");
const { getConfigurationMessage, isConfigured } = require("./db");

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

// Each feature lives in its own route file so people (and AI agents) can work
// on different features at the same time without editing the same file.
app.use(require("./routes/questions"));
app.use(require("./routes/answers"));
app.use(require("./routes/auth"));
app.use(require("./routes/board"));

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