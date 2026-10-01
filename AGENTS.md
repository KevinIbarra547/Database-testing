# Rules for AI agents working on this repo

These rules keep AI agents from breaking the database or creating merge
conflicts. Read the whole file before changing anything.

The app is described in `attached_assets/Pasted-Q-A-CRUD-App-Spec-*.txt` and
`README.md`. The security rules in the spec still apply to all new code.

## Who owns what

| Part | Agent | Branch |
|---|---|---|
| The class board (database, server, pages, CSS) | Claude Code | `claude/dazzling-noether-hgzvt0` |

Google AI Studio is **not** used on this project. If another agent joins
later, give it its own branch and its own files, and add a row above first.
Never push to `main` or to another agent's branch.

### Board files

`routes/board.js`, `lib/board.js`, `views/board/*.ejs`, `public/board.css`,
and `migrations/*board*.sql`. The router is mounted in `app.js`, `board.css`
is linked and the "Board" link is in `views/partials/header.ejs`.

## The board, in one paragraph

Logged-in users write **posts** (type `discussion`, `study_group` or
`resource`) and **replies** (one level only: no replies to replies). Anyone can
read. Only the author can edit, delete or change the status of their own post
or reply. A post or reply can be edited **once**; the text from before the edit
is kept and can be viewed. "Delete" is a soft delete: the post stays in place
and shows as deleted, and its replies stay visible. A post can link to a Q&A
question; if that question is deleted, the post says so. A `closed` post
accepts no new replies. There is no pinning UI and no announcements.

## Page contract

`routes/board.js` renders these views with exactly this data, and the pages
only use these names. Keep both sides in sync when changing either. Every view also gets
`currentUser` (`{ id, username }` or `null`) and must start with
`<%- include("../partials/header", { title }) %>` and end with
`<%- include("../partials/footer") %>`. All dates are strings like
`2026-09-30 13:06:03`. Use `<%= %>` for every value below; never `<%- %>`.

Post types for labels: `discussion` → "Discussion", `study_group` → "Study group",
`resource` → "Resource". Statuses: `open`, `resolved`, `closed`.

### `views/board/index.ejs` (GET `/board`)

- `title`: string
- `posts`: array, newest first (pinned first, but nothing is pinned yet). Each:
  - `post_id`, `post_type`, `status`, `username`, `created_at`
  - `title`: string, or `null` when deleted
  - `is_deleted`: boolean. Show "This post was deleted by its author." instead of the title
  - `reply_count`: number
  - `event_at`: string or `null` (study groups)
- Show a "New post" button linking to `/board/new` when `currentUser` is set.
- Each post links to `/board/<post_id>`.

### `views/board/show.ejs` (GET `/board/:id`)

- `title`: string
- `post`:
  - `post_id`, `post_type`, `status`, `username`, `created_at`, `updated_at` (or `null`)
  - `is_deleted`: boolean. When `true`, `title`, `body`, `link_url`,
    `original_title` and `original_body` are `null`; show "This post was
    deleted by its author." and still show the replies
  - `title`, `body`: strings (show `body` with line breaks kept)
  - `link_url`: string or `null` (resources; show as a link)
  - `event_at`: string or `null` (study groups)
  - `edit_count`: 0 or 1. When 1, show "Edited" and a "View original"
    `<details>` that shows `original_title` and `original_body`
  - `original_title`, `original_body`: strings or `null`
  - `question`: `{ question_id, title }` when linked to a live Q&A question
    (link to `/questions/<question_id>`), otherwise `null`
  - `linked_question_deleted`: boolean. When `true`, show
    "The linked question "<linked_question_title>" was deleted."
  - `linked_question_title`: string or `null`
  - `can_edit`, `can_delete`, `can_change_status`: booleans (the server
    already checked ownership, the edit limit and deletion)
- `replies`: array, oldest first. Each: `post_id`, `username`, `created_at`,
  `is_deleted`, `body` (or `null` when deleted), `edit_count`,
  `original_body` (or `null`), `can_edit`, `can_delete`
- `can_reply`: boolean (logged in, post not closed, not deleted)
- `reply_error`: string or `null` (show above the reply form)
- `reply_form`: `{ body }` (what the user typed, if the reply was rejected)

Forms on this page (plain HTML, `method="post"`):

| Action | URL | Fields | Show when |
|---|---|---|---|
| Reply | `/board/<post.post_id>/replies` | `body` (textarea) | `can_reply` |
| Edit post | link to `/board/<post.post_id>/edit` | none | `post.can_edit` |
| Delete post | `/board/<post.post_id>/delete` | none (add `onsubmit` confirm) | `post.can_delete` |
| Change status | `/board/<post.post_id>/status` | `status` (select: open/resolved/closed) | `post.can_change_status` |
| Edit reply | link to `/board/<reply.post_id>/edit` | none | `reply.can_edit` |
| Delete reply | `/board/<reply.post_id>/delete` | none (confirm) | `reply.can_delete` |

### `views/board/form.ejs` (new post, edit post, edit reply)

- `title`: string (page heading)
- `mode`: `"new"` or `"edit"`
- `is_reply`: boolean. When `true`, show only the `body` field
- `action`: URL the form posts to
- `cancel_url`: URL for the Cancel link
- `error`: string or `null`
- `form`: `{ title, body, post_type, link_url, event_at, question_id }`
  (strings; empty string when blank). Pre-fill every field from it.
  In `"edit"` mode `form` only has `{ title, body }`: **only the title and
  message can be edited** (replies: only the message).
- When `mode` is `"edit"`, show a note: "You can only edit once. Your
  original text will be kept and visible to everyone."

Field names: `title` (max 150), `body` (textarea), `post_type` (select:
discussion/study_group/resource), `link_url` (optional, `type="url"`),
`event_at` (optional, `type="datetime-local"`), `question_id` (optional
number: "Link a Q&A question by its number").

## Database rules

1. **Never change the three original tables** (`Qa1_users`, `Qa1_questions`,
   `Qa1_answers`). No `ALTER`, `DROP`, `RENAME` or `TRUNCATE` on them.
2. **Only one new table: `Qa1_board_posts`.** It is created only through
   migration files. Never create tables from the app's code. A trigger
   (`trg_board_posts_no_delete`) makes MySQL refuse every `DELETE` on it.
3. Migration files go in `migrations/`, named
   `YYYYMMDDHHMM_short_description.sql` using the current date and time.
4. Use `CREATE TABLE IF NOT EXISTS`, `ENGINE=InnoDB`, and name every constraint.
5. A foreign key column must have exactly the same type as the column it
   points to. The original id columns are plain `INT` (not `UNSIGNED`).
6. Once a migration is merged, **never edit it**. Add a new one instead.
7. **Nothing on the board is ever deleted.** No `DELETE` queries on
   `Qa1_board_posts`; "delete" sets `deleted_at`.

## Code rules (from the spec)

- Every query uses `?` placeholders. Never build SQL from user input.
- Use `execute(sql, params)` from `db.js`; use `withTransaction` when one
  action needs several queries that must succeed or fail together.
- Check ownership on the server before any edit, delete or status change.
- In EJS, use `<%= %>` for anything a user typed, never `<%- %>`.
- Validate input and show friendly errors; never show raw database errors.
- Keep files small, with short comments. This is a learning project.
- No new npm packages. No front-end JavaScript frameworks.

## Finishing your work

1. Make sure the app still starts with `npm start` and every existing page
   still works.
2. Open a pull request from your branch into `main`, listing every file you
   changed.
3. The human merges pull requests one at a time. After merging, they pull in
   Replit, run `npm run migrate:up` in the Shell, and restart the app.
