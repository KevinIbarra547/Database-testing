// Rules for the class board: allowed values, form checks, and how rows from
// Qa1_board_posts are turned into the data the board pages receive.

const POST_TYPES = ["discussion", "study_group", "resource"];
const STATUSES = ["open", "resolved", "closed"];
const MAX_EDITS = 1;

// Turns a URL id like "12" into the number 12, or null for anything else.
function parseId(value) {
  return /^[1-9]\d*$/.test(String(value)) ? Number(value) : null;
}

// A browser's datetime-local value ("2026-10-02T15:30") becomes a MySQL DATETIME.
function toMysqlDatetime(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value.replace("T", " ")}:00` : null;
}

// Checks the new-post form. Returns { error } or { values } ready for the INSERT.
function validateNewPost(form) {
  if (!form.title || !form.body) return { error: "Title and message are required." };
  if (form.title.length > 150) return { error: "Title must be 150 characters or fewer." };
  if (!POST_TYPES.includes(form.post_type)) return { error: "Please choose a post type." };

  let linkUrl = null;
  if (form.post_type === "resource" && form.link_url) {
    // Only http(s) links, so a "javascript:" link can never be saved.
    if (!/^https?:\/\/\S+$/i.test(form.link_url)) return { error: "The link must start with http:// or https://." };
    if (form.link_url.length > 500) return { error: "The link must be 500 characters or fewer." };
    linkUrl = form.link_url;
  }

  let eventAt = null;
  if (form.post_type === "study_group" && form.event_at) {
    eventAt = toMysqlDatetime(form.event_at);
    if (!eventAt) return { error: "Please enter a valid date and time for the study group." };
  }

  let questionId = null;
  if (form.question_id) {
    questionId = parseId(form.question_id);
    if (!questionId) return { error: "The question number must be a whole number, like 12." };
  }

  return { values: { ...form, link_url: linkUrl, event_at: eventAt, question_id: questionId } };
}

// Checks the edit form (only the title and message can be edited).
function validateEdit({ title, body }, isReply) {
  if (!body) return "The message is required.";
  if (isReply) return null;
  if (!title) return "Title is required.";
  if (title.length > 150) return "Title must be 150 characters or fewer.";
  return null;
}

function isOwner(row, user) {
  return Boolean(user) && row.uid_user === user.id;
}

// Shapes one post (a row with parent_id NULL) for views/board/show.ejs.
// Deleted posts never send their text to the page.
function shapePost(row, user) {
  const deleted = row.deleted_at !== null;
  const mine = isOwner(row, user) && !deleted;
  return {
    post_id: row.post_id,
    post_type: row.post_type,
    status: row.status,
    username: row.username,
    created_at: row.created_at,
    age_seconds: row.age_seconds,
    updated_at: row.updated_at,
    is_deleted: deleted,
    title: deleted ? null : row.title,
    body: deleted ? null : row.body,
    link_url: deleted ? null : row.link_url,
    event_at: row.event_at,
    edit_count: row.edit_count,
    original_title: deleted ? null : row.original_title,
    original_body: deleted ? null : row.original_body,
    question: row.question_id ? { question_id: row.question_id, title: row.live_question_title } : null,
    linked_question_deleted: row.question_id === null && row.linked_question_title !== null,
    linked_question_title: row.linked_question_title,
    can_edit: mine && row.edit_count < MAX_EDITS,
    can_delete: mine,
    can_change_status: mine,
  };
}

// Shapes one reply for views/board/show.ejs.
function shapeReply(row, user) {
  const deleted = row.deleted_at !== null;
  const mine = isOwner(row, user) && !deleted;
  return {
    post_id: row.post_id,
    username: row.username,
    created_at: row.created_at,
    age_seconds: row.age_seconds,
    is_deleted: deleted,
    body: deleted ? null : row.body,
    edit_count: row.edit_count,
    original_body: deleted ? null : row.original_body,
    can_edit: mine && row.edit_count < MAX_EDITS,
    can_delete: mine,
  };
}

// Shapes one row of the board list for views/board/index.ejs.
function shapeListItem(row) {
  const deleted = row.deleted_at !== null;
  return {
    post_id: row.post_id,
    post_type: row.post_type,
    status: row.status,
    username: row.username,
    created_at: row.created_at,
    age_seconds: row.age_seconds,
    title: deleted ? null : row.title,
    is_deleted: deleted,
    reply_count: Number(row.reply_count),
    event_at: row.event_at,
  };
}

module.exports = {
  MAX_EDITS,
  POST_TYPES,
  STATUSES,
  parseId,
  shapeListItem,
  shapePost,
  shapeReply,
  validateEdit,
  validateNewPost,
};
