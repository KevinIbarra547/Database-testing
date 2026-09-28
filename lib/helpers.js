// Small helpers shared by every route file.

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

module.exports = {
  asyncHandler,
  clean,
  friendlyDatabaseError,
  renderDatabaseError,
  requireLogin,
};
