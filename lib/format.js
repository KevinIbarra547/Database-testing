// Small helpers for showing data in pages. Used from EJS via app.locals.

// ageSeconds comes from MySQL, so times stay correct across time zones.
// After 30 days, show the date instead.
function timeAgo(ageSeconds, createdAt) {
  const seconds = Math.max(0, Number(ageSeconds) || 0);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return String(createdAt).slice(0, 10);
}

// Picks one of six avatar colors consistently for each username.
function avatarColor(username) {
  let total = 0;
  for (const character of String(username)) total += character.charCodeAt(0);
  return total % 6;
}

module.exports = { avatarColor, timeAgo };