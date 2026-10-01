// Form checks. Each returns an error message, or null when the input is fine.

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

module.exports = {
  validateAnswer,
  validateQuestion,
  validateSignup,
};
