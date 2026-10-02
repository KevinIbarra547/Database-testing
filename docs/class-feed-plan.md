# Plan: the class feed (design direction A)

This plan is written for the **Replit Agent** to carry out, one step at a time.
Kevin (the site owner) runs each step, checks it, and pushes it to GitHub
before starting the next one.

**Goal:** one "class feed" page that lists Q&A questions and board posts
together, with filters, like Ed Discussion or Piazza, so students stop
wondering where to post. Along the way, make the existing pages easier to read.

**This plan needs NO database changes.** No new tables, no new columns, no
migrations. Every step only changes server code, pages and CSS. If you think a
step needs a database change, **stop and ask Kevin** instead.

---

## Rules for the agent (read before every step)

### Database: never do these
- Never run `CREATE`, `ALTER`, `DROP`, `RENAME`, `TRUNCATE` or `DELETE` SQL,
  in the app, in the Shell, or anywhere else.
- Never touch the trigger `trg_board_posts_no_delete`. It is supposed to block
  deletes. If you see "Board posts cannot be deleted", that is correct behavior.
- Never add or edit files in `migrations/`. Never edit `db.js`, `scripts/migrate.js`
  or `scripts/seed.js`.
- Never run `npm run seed` or `npm run check` unless Kevin confirms that
  `DB_NAME` points at a **test** database.

### Code: always do these
- Every query uses `?` placeholders. Never put anything the user typed into
  the SQL text.
- Numbers for `LIMIT ?` and `OFFSET ?` are passed as **strings**:
  `String(21)`. (MySQL 8 rejects plain numbers there with "Incorrect arguments
  to mysqld_stmt_execute".)
- Text from the user that goes into `LIKE` is escaped first:
  `"%" + text.replace(/[\\%_]/g, "\\$&") + "%"`.
- In EJS, use `<%= %>` for every value. `<%- %>` is only for `include(...)`.
- Times: never parse `created_at` in JavaScript. Ask MySQL for the age:
  `TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age_seconds`. (The database
  and Replit can be in different time zones, which makes JavaScript-computed
  ages wrong by hours.)
- No new npm packages. Write small helpers instead.
- Keep every existing page and URL working. Don't remove or rename routes.
- Keep the code style: small files, short comments above each query.

### After every step
1. Restart the app and click through the pages listed in the step's checklist.
2. On a test database only: run `npm run check`. It must end with **ALL PASSED**.
3. Commit with a clear message, for example `Step 1: friendly times and avatars`.
4. Stop and let Kevin review before starting the next step.

---

## Step 1: Friendly times, letter avatars, green "answered" counts

Small changes that make every page easier to read.

### 1a. `lib/format.js` (new file)

```js
// Small helpers for showing data in pages. Used from EJS via app.locals.

// 7853 -> "2 hours ago". ageSeconds comes from MySQL (TIMESTAMPDIFF), so the
// result is right even if the database and the app are in different time zones.
// After 30 days it shows the date instead, e.g. "2026-09-01".
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

// Picks one of 6 avatar colors from a username, always the same for that name.
function avatarColor(username) {
  let total = 0;
  for (const character of String(username)) total += character.charCodeAt(0);
  return total % 6;
}

module.exports = { avatarColor, timeAgo };
```

### 1b. `app.js` (two lines, right after `app.set("views", ...)`)

```js
const { avatarColor, timeAgo } = require("./lib/format");
app.locals.timeAgo = timeAgo;
app.locals.avatarColor = avatarColor;
```

### 1c. Add `age_seconds` to the queries that show a date

Add `TIMESTAMPDIFF(SECOND, <table>.created_at, NOW()) AS age_seconds` to:

| File | Query |
|---|---|
| `routes/questions.js` | `GET /` (home list) |
| `routes/questions.js` | `GET /questions/:id`, both the question query and the answers query |
| `routes/board.js` | the `GET /board` list query |
| `routes/board.js` | the `POST_COLUMNS` constant (it starts with `p.post_id`); add it as `TIMESTAMPDIFF(SECOND, p.created_at, NOW()) AS age_seconds` |

Then in `lib/board.js`, add `age_seconds: row.age_seconds,` to the objects
returned by `shapePost`, `shapeReply` and `shapeListItem`.

### 1d. `views/partials/avatar.ejs` (new file)

```ejs
<%# A letter avatar. Receives: name (a username) %>
<span class="avatar avatar-<%= avatarColor(name) %>" aria-hidden="true"><%= String(name).charAt(0).toUpperCase() %></span>
```

### 1e. Use them in the pages

Replace each displayed `created_at` with a `<time>` element that shows the
friendly text and keeps the exact time on hover, and put an avatar before the
username. Example for the home page:

```ejs
<p class="meta">
  <%- include("partials/avatar", { name: question.username }) %>
  Asked by <strong><%= question.username %></strong> ·
  <time datetime="<%= question.created_at %>" title="<%= question.created_at %>"><%= timeAgo(question.age_seconds, question.created_at) %></time>
</p>
```

Do the same in: `views/index.ejs`, `views/question.ejs` (question and each
answer), `views/board/index.ejs`, `views/board/show.ejs` (post and each reply).
In the board views the include path is `"../partials/avatar"`. On deleted board
posts and replies, don't show the avatar or the name (keep what they show today).

Leave the study-group meeting time (`event_at`) as it is: it is in the future.

### 1f. Green count for answered questions (`views/index.ejs`)

Give the answer count box an extra class when it has answers:

```ejs
<div class="answer-count<%= question.answer_count > 0 ? " has-answers" : "" %>">
```

### 1g. CSS (`public/styles.css`, add at the end)

```css
.avatar {
  display: inline-grid; place-items: center; width: 1.5rem; height: 1.5rem;
  border-radius: 50%; color: #fff; font-size: .75rem; font-weight: 800;
  vertical-align: middle; margin-right: .3rem;
}
.avatar-0 { background: #2f6fde; } .avatar-1 { background: #1d8a52; }
.avatar-2 { background: #b4541b; } .avatar-3 { background: #7a4bc9; }
.avatar-4 { background: #c23a62; } .avatar-5 { background: #0f7c8c; }
.answer-count.has-answers strong, .answer-count.has-answers span { color: var(--success); }
.answer-count.has-answers { border: 2px solid var(--success); border-radius: .6rem; padding: .3rem .5rem; }
```

### Step 1 checklist
- [ ] Home page shows "2 hours ago" style times, and hovering shows the exact time.
- [ ] Questions with 1 or more answers have a green answer count; 0 stays grey.
- [ ] Avatars appear next to names on the home page, question page, board list and board post.
- [ ] Deleted board posts and replies still show only "deleted by its author".
- [ ] `npm run check` (test database) ends with ALL PASSED.

---

## Step 2: Search, "Unanswered" tab and pages on the home page

### 2a. Replace the query in `GET /` (`routes/questions.js`)

This exact query was tested. Keep the comment.

```js
// One query handles the search box, the All/Unanswered tabs and paging.
// "? = ''" turns the search off when the box is empty.
// HAVING runs after GROUP BY, so it can filter on the answer count.
const [rows] = await execute(
  `SELECT q.question_id, q.title, q.body, q.created_at,
          TIMESTAMPDIFF(SECOND, q.created_at, NOW()) AS age_seconds,
          u.Uname AS username, COUNT(a.answer_id) AS answer_count
   FROM Qa1_questions q
   JOIN Qa1_users u ON u.uid_user = q.uid_user
   LEFT JOIN Qa1_answers a ON a.question_id = q.question_id
   WHERE (? = '' OR q.title LIKE ? OR q.body LIKE ?)
   GROUP BY q.question_id, q.title, q.body, q.created_at, u.Uname
   HAVING (? = 'all' OR COUNT(a.answer_id) = 0)
   ORDER BY q.created_at DESC, q.question_id DESC
   LIMIT ? OFFSET ?`,
  [search, like, like, filter, String(PAGE_SIZE + 1), String((page - 1) * PAGE_SIZE)],
);
const hasNextPage = rows.length > PAGE_SIZE;
const questions = rows.slice(0, PAGE_SIZE);
```

Read the inputs like this, above the query:

```js
const PAGE_SIZE = 20;
const search = clean(req.query.q).slice(0, 100);
const like = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
// Only these two filters exist; anything else means "all".
const filter = req.query.filter === "unanswered" ? "unanswered" : "all";
const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 500);
```

Pass `search`, `filter`, `page` and `hasNextPage` to the view along with `questions`.

### 2b. `views/index.ejs`

- A search form above the list: `<form method="get" action="/">` with an
  input `name="q"` (pre-filled with `search`) and a hidden input `name="filter"`.
- Two tabs as links: **All** (`/?q=...`) and **Unanswered** (`/?filter=unanswered&q=...`).
  Mark the current one. Build the links with `encodeURIComponent(search)`.
- Below the list: **Previous** and **Next** links that keep `q` and `filter`
  and change `page`. Hide Previous on page 1 and Next when `hasNextPage` is false.
- When the list is empty and `search` isn't empty: "No questions match
  "<search>"." with a link to clear the search.

### Step 2 checklist
- [ ] Searching "join" finds only matching questions; clearing the search shows all.
- [ ] Searching `100%` or `_` doesn't crash and doesn't match everything.
- [ ] The Unanswered tab shows only questions with 0 answers.
- [ ] With more than 20 questions, Next and Previous work and keep the search and tab.
- [ ] `/?page=abc` and `/?filter=bogus` show the normal first page instead of an error.
- [ ] `npm run check` ends with ALL PASSED.

---

## Step 3: The class feed page (`/feed`)

### 3a. New files

| File | What it holds |
|---|---|
| `routes/feed.js` | `GET /feed` (and `GET /new` in step 4) |
| `views/feed.ejs` | the page |
| `public/feed.css` | its styles (class names start with `feed-`) |

Wire it in, these are the only edits to shared files in this step:
- `app.js`: `app.use(require("./routes/feed"));` next to the other routes.
- `views/partials/header.ejs`: link `feed.css` next to `board.css`, and add a
  `<a href="/feed">Feed</a>` link before the Board link.

### 3b. The feed query (`routes/feed.js`)

This exact query was tested on the real table layout. **Keep every
`CONVERT(... USING utf8mb4) COLLATE utf8mb4_general_ci`.** The old tables and
the board table may use different collations, and without these MySQL stops
with "Illegal mix of collations for operation 'UNION'".

```js
// The feed is questions and board posts in one list. UNION ALL stacks two
// SELECTs that return the same columns; the outer query filters, sorts and pages.
// Deleted board posts come back with a NULL title so their text never reaches the page.
const FEED_SQL = `
  SELECT feed.*, TIMESTAMPDIFF(SECOND, feed.created_at, NOW()) AS age_seconds
  FROM (
    SELECT 'question' AS kind, q.question_id AS id,
           CONVERT(q.title USING utf8mb4) COLLATE utf8mb4_general_ci AS title,
           CONVERT(u.Uname USING utf8mb4) COLLATE utf8mb4_general_ci AS username,
           NULL AS post_type, NULL AS status, NULL AS event_at, 0 AS is_deleted, q.created_at,
           (SELECT COUNT(*) FROM Qa1_answers a WHERE a.question_id = q.question_id) AS reply_count
    FROM Qa1_questions q
    JOIN Qa1_users u ON u.uid_user = q.uid_user
    UNION ALL
    SELECT 'board' AS kind, p.post_id AS id,
           CASE WHEN p.deleted_at IS NULL THEN CONVERT(p.title USING utf8mb4) COLLATE utf8mb4_general_ci END AS title,
           CONVERT(u.Uname USING utf8mb4) COLLATE utf8mb4_general_ci AS username,
           p.post_type, p.status, p.event_at, p.deleted_at IS NOT NULL AS is_deleted, p.created_at,
           (SELECT COUNT(*) FROM Qa1_board_posts r WHERE r.parent_id = p.post_id) AS reply_count
    FROM Qa1_board_posts p
    JOIN Qa1_users u ON u.uid_user = p.uid_user
    WHERE p.parent_id IS NULL
  ) AS feed
  WHERE (? = 'all'
     OR (? = 'questions' AND feed.kind = 'question')
     OR (? = 'unanswered' AND feed.kind = 'question' AND feed.reply_count = 0)
     OR feed.post_type = ?)
  ORDER BY feed.created_at DESC, feed.kind DESC, feed.id DESC
  LIMIT ? OFFSET ?`;

// How many items each filter has, for the numbers in the sidebar.
const COUNTS_SQL = `
  SELECT
    (SELECT COUNT(*) FROM Qa1_questions) AS questions,
    (SELECT COUNT(*) FROM Qa1_questions q
       WHERE NOT EXISTS (SELECT 1 FROM Qa1_answers a WHERE a.question_id = q.question_id)) AS unanswered,
    (SELECT COUNT(*) FROM Qa1_board_posts WHERE parent_id IS NULL AND post_type = 'discussion') AS discussion,
    (SELECT COUNT(*) FROM Qa1_board_posts WHERE parent_id IS NULL AND post_type = 'study_group') AS study_group,
    (SELECT COUNT(*) FROM Qa1_board_posts WHERE parent_id IS NULL AND post_type = 'resource') AS resource`;
```

Run it with the filter four times, then the paging:

```js
const FILTERS = ["all", "questions", "unanswered", "discussion", "study_group", "resource"];
const filter = FILTERS.includes(req.query.filter) ? req.query.filter : "all";
// page and PAGE_SIZE exactly as in step 2
const [rows] = await execute(FEED_SQL, [filter, filter, filter, filter, String(PAGE_SIZE + 1), String((page - 1) * PAGE_SIZE)]);
```

"All" in the sidebar = `questions + discussion + study_group + resource`.
Wrap both queries in `try`/`catch` with `renderDatabaseError` like the other routes.

### 3c. The page (`views/feed.ejs`)

Layout (see mock-up A on the design page):

- **Left sidebar:** a **New thread** button (logged in only; it links to
  `/questions/new` until step 4), then the filters as links with their counts:
  All, Questions, Unanswered, Discussions, Study groups, Resources. Mark the
  current filter.
- **Main list**, one row per item:
  - a type pill: Question, Discussion, Study group or Resource (reuse the
    board badge colors);
  - for questions with `reply_count > 0`, a green check icon (inline SVG);
  - the title, linking to `/questions/<id>` for questions and `/board/<id>`
    for board posts; for deleted board posts, "This post was deleted by its
    author." in grey;
  - avatar, username and `timeAgo(...)`, plus "N answers" (questions) or
    "N replies" (board posts);
  - a Closed or Resolved pill when `status` says so, and "Meets: ..." for
    study groups with `event_at`.
- **Previous/Next** links like step 2, keeping `filter`.
- **Empty state:** "Nothing here yet." with a New thread link.
- **Phone width:** the sidebar becomes one row of filter chips above the list
  that scrolls sideways inside its own container (`overflow-x: auto`), never
  making the whole page scroll sideways.

Not in this step: a reading pane next to the list. Clicking an item opens the
existing question or board page.

### Step 3 checklist
- [ ] `/feed` shows questions and board posts mixed, newest first.
- [ ] Every filter shows the right items, and its number matches.
- [ ] `/feed?filter=bogus` shows All instead of an error.
- [ ] Deleted board posts show as deleted, with no title.
- [ ] Clicking an item opens the right question or board page.
- [ ] On a phone-width window, the filters become a chip row and nothing overflows.
- [ ] The old home page and `/board` still work exactly as before.
- [ ] `npm run check` ends with ALL PASSED.

---

## Step 4: One "New thread" button

### 4a. `GET /new` in `routes/feed.js`

Logged in only (`requireLogin`). Renders `views/new-thread.ejs` with
`{ title: "New thread" }`. No database query.

### 4b. `views/new-thread.ejs`

Two large choices, each a link styled as a card:

| Choice | Explanation on the card | Links to |
|---|---|---|
| **Question** | "Something specific that has an answer. Example: Why does my LEFT JOIN return NULL?" | `/questions/new` |
| **Post** | "A discussion, a study group, or a link to share." | `/board/new` |

Under them: "Not sure? If someone could answer it in a sentence or two, it's a question."

### 4c. Point the buttons at it

- The feed's **New thread** button → `/new`.
- Keep the existing "Ask a question" and "New post" buttons on the old pages.

### Step 4 checklist
- [ ] Logged out, `/new` goes to the login page.
- [ ] Both cards open the right form.
- [ ] `npm run check` ends with ALL PASSED.

---

## Later, only if Kevin decides

These are deliberately **not** part of this plan:
- Making `/feed` the home page (changing what `/` shows).
- A reading pane next to the feed list.
- Marking a "most helpful" answer: this needs a new table, so it gets its own
  plan and migration, the same way the board was planned.

## If something goes wrong

| Error | Cause | Fix |
|---|---|---|
| `Illegal mix of collations for operation 'UNION'` | A `CONVERT(... USING utf8mb4) COLLATE utf8mb4_general_ci` was removed | Put it back on every text column on both sides of the UNION |
| `Incorrect arguments to mysqld_stmt_execute` | A number was passed to `LIMIT ?` or `OFFSET ?` | Pass `String(number)` |
| `Board posts cannot be deleted` | Something tried to `DELETE` a board post | Correct behavior. Use `deleted_at` instead; never drop the trigger |
| `The database is missing a table` | Migrations weren't run on this database | Kevin runs `npm run migrate:up` |
| Times are off by several hours | `created_at` was turned into a JavaScript `Date` | Use `age_seconds` from `TIMESTAMPDIFF` and `timeAgo()` |
| `npm run check` refuses to run | `DB_NAME` points at a database without sample data | Correct behavior. Ask Kevin to switch to the test database |
