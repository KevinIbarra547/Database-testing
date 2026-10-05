# Plan: question numbers, votes, and the next big feature

This plan comes **after** the class feed (`docs/class-feed-plan.md`, steps 1–4)
is finished and merged into `main`. Each phase is its own branch and its own
pull request. Don't start a phase until the one before it is merged.

| Phase | What it adds | Database change | Who runs the migration |
|---|---|---|---|
| 1 | Question numbers ("#12") everywhere, and "#12" in the search box | None | — |
| 2 | Up/down votes on questions and answers | **One migration: two new tables** | Kevin |
| 3 | Board topics and a related-posts dropdown | **One migration: two new tables** | Kevin |

Every query and code file in phases 1 and 2 was run against a copy of the
database (the 3 original tables, the board, and the sample data) before it was
put in this plan, and the full check suite (`npm run check`) passed with
phase 2 added. The code blocks below are copied from those tested files.

---

## Rules for every phase

Everything in `replit.md` and `AGENTS.md` still applies. In short:

- `?` placeholders in every query. `<%= %>` for every value in EJS.
- No new npm packages. Don't edit `db.js`, `scripts/migrate.js` or `scripts/seed.js`.
- Never `ALTER`, `DROP` or `DELETE` anything by hand. The only database changes
  are migration files from this plan, and **only Kevin runs them**.
- Work on a **test** database (`DB_NAME` pointing at it). `npm run check` must
  end with ALL PASSED before each commit.
- **At the start of each phase, Kevin replaces the "Current task" section of
  `replit.md`** with the text given in that phase. Phase 2 needs this: it is
  the only phase allowed to add a migration file and to delete rows (votes).
- The code in this plan is written for the site **after** the class feed. If
  the Replit Agent built something slightly differently (a different variable
  name, say), adapt the snippet to the real code. Never delete working code to
  make a snippet fit.

---

## Phase 1: Question numbers (no database change)

Every question already has a number: its `question_id` (that's the 12 in
`/questions/12`). The pages just don't show it. This phase shows it.

### 1.0 `replit.md` "Current task" for this phase

```md
## Current task

Phase 1 of `docs/next-features-plan.md`: question numbers. No database
changes. Do only Phase 1, then stop. Also follow `AGENTS.md`.
```

### 1a. Where to show "#12"

| Page | File | Change |
|---|---|---|
| Home list | `views/index.ejs` | Put `<span class="question-number">#<%= question.question_id %></span>` before the title, inside the link |
| Question page | `views/question.ejs` | Change the eyebrow to `Question #<%= question.question_id %>` |
| Feed | `views/feed.ejs` | For items with `kind === "question"`, show `#<%= item.id %>` before the title |
| Board post | `views/board/show.ejs` | Change "About Q&A question:" to `About Q&A question #<%= post.question.question_id %>:` |

CSS (`public/styles.css`):

```css
.question-number { color: var(--muted); font-weight: 600; }
```

### 1b. "#12" in the search box opens question 12

In `GET /` (`routes/questions.js`), right after `search` is read and **before**
the big query, add:

```js
// "#12" (or just "12") in the search box opens question 12, if it exists.
const jump = search.match(/^#?(\d{1,9})$/);
if (jump) {
  const [found] = await execute("SELECT question_id FROM Qa1_questions WHERE question_id = ?", [jump[1]]);
  if (found[0]) return res.redirect(`/questions/${found[0].question_id}`);
}
```

Typing `#12` or `12` opens question 12. If there's no question 12, or the
text is anything else (like `#12 joins`), the normal search runs instead.

### 1c. While you're in the feed: hide names on deleted posts

The feed query returns the author's name even for a deleted board post. On the
board itself, deleted posts don't show who wrote them. In `views/feed.ejs`, when
`item.is_deleted` is true, don't show the avatar or the username, the same way
`views/board/index.ejs` does.

### Why the numbers have gaps (don't "fix" this)

Numbers come from `AUTO_INCREMENT`. Deleted questions leave gaps (1, 2, 4, 7…),
and MySQL never reuses a number. That's normal; Stack Overflow works the same
way. **Never renumber questions:** links like `/questions/12` and the board's
links to questions (`question_id`) would point at the wrong question.

### Phase 1 checklist
- [ ] Home, question page, feed and board posts show "#12" style numbers.
- [ ] Searching `#1` opens question 1; `#99999` runs a normal search with no results; `joins` still searches.
- [ ] Deleted board posts in the feed show no name or avatar.
- [ ] `npm run check` ends with ALL PASSED.

---

## Phase 2: Up/down votes

### 2.0 `replit.md` "Current task" for this phase

```md
## Current task

Phase 2 of `docs/next-features-plan.md`: votes. Do only Phase 2, then stop.
Also follow `AGENTS.md`.

Exceptions to the "Never" list, for this phase only:
- Create exactly one migration file, `migrations/202610030900_create_votes.sql`,
  with the exact content from the plan. Don't run it; Kevin runs it.
- `routes/votes.js` may DELETE rows from `Qa1_question_votes` and
  `Qa1_answer_votes` (taking a vote back). No other DELETE anywhere.
```

### 2a. Decisions (already made, with reasons)

| Question | Decision | Why |
|---|---|---|
| What can be voted on? | Questions and answers. **Not** board posts. | The board is for conversation. Votes rank answers. |
| One table or two? | Two: `Qa1_question_votes` and `Qa1_answer_votes`. | Each vote gets a real foreign key, so deleting a question removes its votes automatically. A single table with a "type" column can't have foreign keys. |
| Can you vote on your own post? | No. | Same as Stack Overflow. Checked on the server. |
| How many votes per person? | One per question or answer. | The primary key `(question_id, uid_user)` makes a second row impossible. |
| Clicking the same arrow again? | Takes your vote back. | Lets people undo a mistake. |
| Can vote rows be deleted? | Yes. | Votes aren't content. The "nothing is ever deleted" lock is only on the board table. |
| Answer order on a question page | **Highest score first**, ties oldest first. | **Decided by Kevin.** That's the point of votes. This changes the original spec, which said "oldest first". |

### 2b. The migration (Kevin runs it)

Create exactly this file, `migrations/202610030900_create_votes.sql`. It is the
**only** file this phase adds to `migrations/`.

```sql
-- Up/down votes on questions and answers. This only ADDS two new tables.
--
-- One row = one user's vote on one question (or answer).
--   PRIMARY KEY (question_id, uid_user): a user can vote on each question once.
--   vote_value: +1 (up) or -1 (down). Taking a vote back deletes the row.
--   ON DELETE CASCADE: when a question or answer is deleted, its votes go too.
--
-- Two tables instead of one "votes" table with a target_type column, so that
-- every vote has a real foreign key and MySQL itself keeps them correct.
-- Both use IF NOT EXISTS, so re-running after a half-finished attempt is safe.
CREATE TABLE IF NOT EXISTS Qa1_question_votes (
  question_id INT NOT NULL,
  uid_user INT NOT NULL,
  vote_value TINYINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (question_id, uid_user),
  CONSTRAINT fk_question_votes_question FOREIGN KEY (question_id)
    REFERENCES Qa1_questions (question_id) ON DELETE CASCADE,
  CONSTRAINT fk_question_votes_user FOREIGN KEY (uid_user)
    REFERENCES Qa1_users (uid_user) ON DELETE CASCADE,
  CONSTRAINT chk_question_votes_value CHECK (vote_value IN (-1, 1))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS Qa1_answer_votes (
  answer_id INT NOT NULL,
  uid_user INT NOT NULL,
  vote_value TINYINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (answer_id, uid_user),
  CONSTRAINT fk_answer_votes_answer FOREIGN KEY (answer_id)
    REFERENCES Qa1_answers (answer_id) ON DELETE CASCADE,
  CONSTRAINT fk_answer_votes_user FOREIGN KEY (uid_user)
    REFERENCES Qa1_users (uid_user) ON DELETE CASCADE,
  CONSTRAINT chk_answer_votes_value CHECK (vote_value IN (-1, 1))
) ENGINE=InnoDB;
```

**Kevin, in this order:**
1. Pull the branch into Replit. `DB_NAME` should point at the **test** database.
2. Back up the test database in phpMyAdmin (Export).
3. `npm run migrate:status` should list `202610030900_create_votes.sql` as pending.
4. `npm run migrate:up`, type the database name.
5. Restart the app. Run `npm run check`.
6. Only after the pull request is merged: back up the **real** database, switch
   `DB_NAME` back, and run `npm run migrate:up` there too.

**The migration has to run before the new code.** The code reads the vote
tables, so code without the tables shows "The database is missing a table".
The tables without the code are harmless.

**Undo plan:** a *new* migration with `DROP TABLE Qa1_answer_votes;` and
`DROP TABLE Qa1_question_votes;`. That removes votes only; nothing else depends
on these tables. Never edit or delete the original migration file.

### 2c. `routes/votes.js` (new file, use exactly this)

```js
const express = require("express");
const { execute } = require("../db");
const { asyncHandler, renderDatabaseError, requireLogin } = require("../lib/helpers");

// Up/down votes on questions and answers.
// Rules: logged in only, never on your own post, one vote per person per post.
// Clicking the same arrow again takes the vote back; the other arrow switches it.
const router = express.Router();

const VOTE_VALUES = { up: 1, down: -1 };

// The SQL for each kind of thing you can vote on. These are fixed strings,
// never built from anything the user typed.
const QUESTION_SQL = {
  target: "SELECT uid_user, question_id FROM Qa1_questions WHERE question_id = ?",
  removeSame: "DELETE FROM Qa1_question_votes WHERE question_id = ? AND uid_user = ? AND vote_value = ?",
  save: `INSERT INTO Qa1_question_votes (question_id, uid_user, vote_value) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE vote_value = ?`,
};
const ANSWER_SQL = {
  target: "SELECT uid_user, question_id FROM Qa1_answers WHERE answer_id = ?",
  removeSame: "DELETE FROM Qa1_answer_votes WHERE answer_id = ? AND uid_user = ? AND vote_value = ?",
  save: `INSERT INTO Qa1_answer_votes (answer_id, uid_user, vote_value) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE vote_value = ?`,
};

// Saves one vote. Each statement is atomic on its own, so no transaction or
// row lock is needed, and two clicks at the same moment can't deadlock or
// create two votes. (A SELECT ... FOR UPDATE version deadlocked under fast clicks.)
// Returns { status, questionId }.
async function castVote(sql, targetId, userId, voteValue) {
  const [targets] = await execute(sql.target, [targetId]);
  const target = targets[0];
  if (!target) return { status: 404 };
  if (target.uid_user === userId) return { status: 403, questionId: target.question_id };

  // Clicking the same arrow again: this DELETE finds that exact vote and takes it back.
  const [removed] = await execute(sql.removeSame, [targetId, userId, voteValue]);
  if (removed.affectedRows === 0) {
    // Otherwise add the vote, or switch an existing opposite vote (the
    // primary key is the post id + uid_user, so there is never a second row).
    await execute(sql.save, [targetId, userId, voteValue, voteValue]);
  }
  return { status: 200, questionId: target.question_id };
}

function voteHandler(sql, anchor) {
  return asyncHandler(async (req, res) => {
    const voteValue = VOTE_VALUES[req.body.direction];
    const targetId = Number(req.params.id);
    if (!voteValue || !Number.isInteger(targetId) || targetId < 1) {
      return res.status(400).render("error", { title: "Invalid vote", error: "Please vote up or down." });
    }
    try {
      const result = await castVote(sql, targetId, req.session.user.id, voteValue);
      if (result.status === 404) return res.status(404).render("404", { title: "Not found" });
      if (result.status === 403) {
        return res.status(403).render("error", { title: "Not allowed", error: "You can't vote on your own post." });
      }
      res.redirect(`/questions/${result.questionId}${anchor(targetId)}`);
    } catch (error) {
      renderDatabaseError(res, error, "error", { title: "Something went wrong" });
    }
  });
}

router.post("/questions/:id/vote", requireLogin, voteHandler(QUESTION_SQL, () => ""));
router.post("/answers/:id/vote", requireLogin, voteHandler(ANSWER_SQL, (id) => `#answer-${id}`));

module.exports = router;
```

Mount it in `app.js` next to the other routes:

```js
app.use(require("./routes/votes"));
```

### 2d. Question page queries (`routes/questions.js`, `GET /questions/:id`)

Add `const viewerId = req.session.user ? req.session.user.id : null;` above
the question query, then make the two queries look like this. **`viewerId`
comes first in the parameters** because its `?` comes first in the SQL.

Question query, parameters `[viewerId, req.params.id]`:

```sql
SELECT q.question_id, q.uid_user, q.title, q.body, q.created_at,
       TIMESTAMPDIFF(SECOND, q.created_at, NOW()) AS age_seconds,
       u.Uname AS username,
       (SELECT CAST(COALESCE(SUM(v.vote_value), 0) AS SIGNED)
        FROM Qa1_question_votes v WHERE v.question_id = q.question_id) AS score,
       (SELECT v.vote_value FROM Qa1_question_votes v
        WHERE v.question_id = q.question_id AND v.uid_user = ?) AS my_vote
FROM Qa1_questions q
JOIN Qa1_users u ON u.uid_user = q.uid_user
WHERE q.question_id = ?
```

Answers query, parameters `[viewerId, req.params.id]`:

```sql
SELECT a.answer_id, a.uid_user, a.body, a.created_at,
       TIMESTAMPDIFF(SECOND, a.created_at, NOW()) AS age_seconds,
       u.Uname AS username,
       (SELECT CAST(COALESCE(SUM(v.vote_value), 0) AS SIGNED)
        FROM Qa1_answer_votes v WHERE v.answer_id = a.answer_id) AS score,
       (SELECT v.vote_value FROM Qa1_answer_votes v
        WHERE v.answer_id = a.answer_id AND v.uid_user = ?) AS my_vote
FROM Qa1_answers a
JOIN Qa1_users u ON u.uid_user = a.uid_user
WHERE a.question_id = ?
ORDER BY score DESC, a.created_at ASC, a.answer_id ASC
```

`CAST(... AS SIGNED)` matters: without it, MySQL returns `SUM()` as a decimal,
and the page would get the text `"3"` instead of the number 3.

### 2e. Scores on the home page and the feed

**Home (`GET /`):** add this column to the SELECT list, right after
`COUNT(a.answer_id) AS answer_count,` (and add that comma):

```sql
       (SELECT CAST(COALESCE(SUM(v.vote_value), 0) AS SIGNED)
        FROM Qa1_question_votes v WHERE v.question_id = q.question_id) AS score
```

**Feed (`routes/feed.js`, `FEED_SQL`):** add a `score` column to **both** sides
of the `UNION ALL`, as the last column, after `reply_count`:

- Question side: `,` then the same subquery as above, ending in `AS score`
- Board side: `, NULL AS score`

Both sides of a `UNION` must have the same number of columns in the same
order, or MySQL stops with "The used SELECT statements have a different number
of columns".

> **Trap: don't add votes with another `LEFT JOIN`.** The home query already
> joins answers. Joining votes too multiplies the rows: in testing, a question
> with 3 answers and 2 upvotes came out as **6 answers and a score of 6**.
> Always use the subquery above.

### 2f. The vote buttons

`views/partials/vote-buttons.ejs` (new file):

```ejs
<%# Up/down vote buttons with the score.
    Receives: score, my_vote (1, -1 or null), action (the vote URL), can_vote (true/false) %>
<div class="votes">
  <% if (can_vote) { %>
    <form method="post" action="<%= action %>">
      <input type="hidden" name="direction" value="up">
      <button class="vote-button<%= my_vote === 1 ? " voted" : "" %>" type="submit" aria-label="Upvote" aria-pressed="<%= my_vote === 1 %>">&#9650;</button>
    </form>
  <% } %>
  <span class="vote-score" title="Score"><%= score %></span>
  <% if (can_vote) { %>
    <form method="post" action="<%= action %>">
      <input type="hidden" name="direction" value="down">
      <button class="vote-button<%= my_vote === -1 ? " voted" : "" %>" type="submit" aria-label="Downvote" aria-pressed="<%= my_vote === -1 %>">&#9660;</button>
    </form>
  <% } %>
</div>
```

In `views/question.ejs`, under the question body:

```ejs
  <%- include("partials/vote-buttons", {
    score: question.score,
    my_vote: question.my_vote,
    action: `/questions/${question.question_id}/vote`,
    can_vote: Boolean(currentUser) && currentUser.id !== question.uid_user,
  }) %>
```

And at the top of each answer card. Also give the card an `id`, so the page
scrolls back to the answer after voting:

```ejs
      <article class="card answer-card" id="answer-<%= answer.answer_id %>">
        <%- include("partials/vote-buttons", {
          score: answer.score,
          my_vote: answer.my_vote,
          action: `/answers/${answer.answer_id}/vote`,
          can_vote: Boolean(currentUser) && currentUser.id !== answer.uid_user,
        }) %>
```

On the home page and in the feed, show the score as text next to the answer
count, for example `2 votes` (use "vote" when the score is 1 or -1).

CSS (`public/styles.css`, add at the end):

```css
.question-number { color: var(--muted); font-weight: 600; }
.votes { display: inline-flex; align-items: center; gap: .4rem; margin: .5rem 0; }
.votes form { display: inline; }
.vote-button {
  border: 1px solid var(--line); border-radius: .4rem; background: var(--card);
  color: var(--muted); cursor: pointer; font: inherit; line-height: 1; padding: .3rem .5rem;
}
.vote-button:hover { border-color: var(--blue); color: var(--blue-dark); }
.vote-button.voted { background: var(--blue); border-color: var(--blue); color: #fff; }
.vote-score { min-width: 1.5rem; text-align: center; font-weight: 800; font-variant-numeric: tabular-nums; }
```

### 2g. Add the vote checks to `npm run check`

In `scripts/check-site.js`, paste this function above `async function main()`:

```js
async function checkVotes(a, b, anon) {
  const voteRows = (table, column, id) => sqlValue(`SELECT COUNT(*) FROM ${table} WHERE ${column} = ?`, [id]);
  const score = (table, column, id) => sqlValue(`SELECT COALESCE(SUM(vote_value), 0) FROM ${table} WHERE ${column} = ?`, [id]);

  const asked = await a("POST", "/questions/new", { title: `Vote question ${run}`, body: "Body" });
  const questionId = asked.location.split("/").pop();
  check("logged-out user can't vote", (await anon("POST", `/questions/${questionId}/vote`, { direction: "up" })).location === "/login");
  check("can't vote on your own question", (await a("POST", `/questions/${questionId}/vote`, { direction: "up" })).status === 403);
  check("invalid vote direction rejected", (await b("POST", `/questions/${questionId}/vote`, { direction: "sideways" })).status === 400);
  check("vote on a missing question is 404", (await b("POST", "/questions/99999999/vote", { direction: "up" })).status === 404);

  check("B upvotes A's question", (await b("POST", `/questions/${questionId}/vote`, { direction: "up" })).location === `/questions/${questionId}`);
  check("score is 1", Number(await score("Qa1_question_votes", "question_id", questionId)) === 1);
  await b("POST", `/questions/${questionId}/vote`, { direction: "up" });
  check("same arrow again takes the vote back", Number(await voteRows("Qa1_question_votes", "question_id", questionId)) === 0);
  await b("POST", `/questions/${questionId}/vote`, { direction: "down" });
  await b("POST", `/questions/${questionId}/vote`, { direction: "up" });
  check("switching keeps one vote per person", Number(await voteRows("Qa1_question_votes", "question_id", questionId)) === 1
    && Number(await score("Qa1_question_votes", "question_id", questionId)) === 1);

  await b("POST", `/questions/${questionId}/answers`, { body: `Vote answer ${run}` });
  const answerId = await sqlValue("SELECT answer_id FROM Qa1_answers WHERE question_id = ? ORDER BY answer_id DESC LIMIT 1", [questionId]);
  check("can't vote on your own answer", (await b("POST", `/answers/${answerId}/vote`, { direction: "up" })).status === 403);
  check("A upvotes B's answer", (await a("POST", `/answers/${answerId}/vote`, { direction: "up" })).location === `/questions/${questionId}#answer-${answerId}`);
  check("question page shows the question number", (await anon("GET", `/questions/${questionId}`)).text.includes(`#${questionId}`));

  await a("POST", `/questions/${questionId}/delete`);
  check("deleting a question deletes its votes", Number(await voteRows("Qa1_question_votes", "question_id", questionId)) === 0
    && Number(await voteRows("Qa1_answer_votes", "answer_id", answerId)) === 0);
}
```

And in `main()`, right after `await checkBoard(a, b, anon, questionId);`, add:

```js
  await checkVotes(a, b, anon);
```


### Phase 2 checklist
- [ ] `npm run migrate:status` shows the votes migration as applied on the test database.
- [ ] Logged out: scores show, arrows don't.
- [ ] Your own question and answers: score shows, arrows don't.
- [ ] Someone else's: up, up again (vote gone), down, up (switched) all work, and the highlighted arrow matches.
- [ ] Answers sort by score; equal scores stay oldest first.
- [ ] Deleting a question removes its votes (the check suite tests this).
- [ ] `npm run check` ends with ALL PASSED, including the new vote checks.

### Mistakes this plan already avoids

The first three were reproduced while testing this plan.

| Mistake | What happens | What the plan does instead |
|---|---|---|
| Locking the vote row with `SELECT ... FOR UPDATE` in a transaction | Three fast clicks, repeated 30 times: **18 of the 90 clicks crashed** with "Deadlock found" | One `DELETE` + one `INSERT ... ON DUPLICATE KEY UPDATE`, no lock: 270 fast clicks, 0 errors, never two votes from one person |
| Joining votes with a second `LEFT JOIN` | A question with 3 answers and 2 upvotes showed **6 answers and a score of 6** | Subqueries |
| `SUM()` without `CAST` | The score arrives as the text `"2"`, not the number 2 | `CAST(... AS SIGNED)` |
| Parameters in the wrong order | `my_vote` would be looked up for the wrong user | `viewerId` first, as written |

---

## Phase 3: Board topics and related posts

**Decided by Kevin:** topic tags (option B), board posts only, a dropdown of
related posts. The earlier "Q&A safety upgrade" idea is **not** being built.

### What users get

- **Topics when posting:** a "Topics" box on the new-post form. Type up to
  **3** topics separated by commas (`sql, joins, quiz-prep`). The most used
  topics are suggested under the box.
- **Topic tags:** each post shows its topics as tags (`#sql`). A tag opens
  `/board/topic/sql`, which lists every post with that topic.
- **Related posts dropdown:** under each post, a "Related posts (4)" dropdown,
  closed until clicked. It lists every other post that shares a topic, the
  ones sharing the **most** topics first, each with which topics it shares.
  Pick one to open it.
- **Changing topics:** the author can change a post's topics anytime with
  "Change topics". This doesn't use up the post's one edit, because topics
  aren't the post's text.

Replies don't have topics. Deleted posts don't show related posts and are never suggested.

### The database change: one migration, two new tables

Nothing existing changes. `Qa1_board_posts` and the original tables stay as they are.

| Table | One row per | Columns |
|---|---|---|
| `Qa1_topics` | topic name | `topic_id`, `name` (unique, like `joins`), `created_at` |
| `Qa1_board_post_topics` | post + topic pair | `post_id`, `topic_id` (primary key: both together) |

This is a **many-to-many** relationship: one post has many topics, and one
topic belongs to many posts. That needs the second "link" table in the middle.

**How "related" is worked out.** For a post, look at its topics ("mine"),
find every *other* post linked to one of those topics ("other"), and count
how many topics each one shares. That's a table joined to itself, plus
`GROUP BY` and `COUNT`. The full query is in `lib/topics.js` below.

### 3.0 `replit.md` "Current task" for this phase

```md
## Current task

Phase 3 of `docs/next-features-plan.md`: board topics and related posts.
Do only Phase 3, then stop. Also follow `AGENTS.md`.

Exceptions to the "Never" list, for this phase only:
- Create exactly one migration file, `migrations/202610060900_create_board_topics.sql`,
  with the exact content from the plan. Don't run it; Kevin runs it.
- `lib/topics.js` may DELETE rows from `Qa1_board_post_topics` (changing a
  post's topics). No other DELETE anywhere; board posts are never deleted.
```

### 3.1 The migration (Kevin runs it)

`migrations/202610060900_create_board_topics.sql`:

```sql
-- Topics for board posts, used to find related posts. This only ADDS two new
-- tables; Qa1_board_posts and the original tables are not changed.
--
--   Qa1_topics             one row per topic name ("sql", "joins", "quiz-prep")
--   Qa1_board_post_topics  one row per (post, topic) pair: a many-to-many link
--
-- PRIMARY KEY (post_id, topic_id) stops the same topic being added twice to a post.
-- The extra index (topic_id, post_id) makes "find every post with this topic" fast,
-- which is what the related-posts query and the topic pages do.
-- No ON DELETE rules: board posts are never deleted (see the board's trigger).
-- Both use IF NOT EXISTS, so re-running after a half-finished attempt is safe.
CREATE TABLE IF NOT EXISTS Qa1_topics (
  topic_id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(30) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (topic_id),
  CONSTRAINT uq_topics_name UNIQUE (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS Qa1_board_post_topics (
  post_id INT NOT NULL,
  topic_id INT NOT NULL,
  PRIMARY KEY (post_id, topic_id),
  KEY idx_board_post_topics_topic (topic_id, post_id),
  CONSTRAINT fk_board_post_topics_post FOREIGN KEY (post_id)
    REFERENCES Qa1_board_posts (post_id),
  CONSTRAINT fk_board_post_topics_topic FOREIGN KEY (topic_id)
    REFERENCES Qa1_topics (topic_id)
) ENGINE=InnoDB;
```

**Kevin, in this order:** back up the test database, `npm run migrate:status`
(it should list this file as pending), `npm run migrate:up`, restart, run
`npm run check`. After the pull request is merged, do the same on the real
database. **The migration runs before the new code**: the code reads these
tables, and the tables alone are harmless to the old code.

**Undo plan:** a *new* migration with `DROP TABLE Qa1_board_post_topics;` then
`DROP TABLE Qa1_topics;` (in that order, because of the foreign key). That
removes all topics; posts are untouched.

### 3.2 `lib/topics.js` (new file, use exactly this)

```js
// Topics on board posts, and finding related posts through shared topics.
// Tables: Qa1_topics (the names) and Qa1_board_post_topics (which post has which topic).
const { execute } = require("../db");

const MAX_TOPICS = 3;
const MAX_RELATED = 10;

// "SQL, Quiz Prep ,sql" -> { names: ["sql", "quiz-prep"] }, or { error: "..." }.
// Lowercase, spaces become hyphens, duplicates removed. An empty box is allowed.
function parseTopics(input) {
  const names = [];
  for (const part of String(input || "").split(",")) {
    const name = part.trim().toLowerCase().replace(/\s+/g, "-");
    if (!name) continue;
    if (!/^[a-z0-9][a-z0-9-]{0,29}$/.test(name)) {
      return { error: `"${part.trim()}" isn't a valid topic. Use letters, numbers and hyphens, up to 30 characters.` };
    }
    if (!names.includes(name)) names.push(name);
  }
  if (names.length > MAX_TOPICS) return { error: `Use at most ${MAX_TOPICS} topics.` };
  return { names };
}

// Makes sure every topic name has a row, and returns their ids in the same order.
// Call this BEFORE the transaction: each INSERT runs and commits on its own, so
// the lock on a new topic is released at once. (Creating topics inside the post's
// transaction deadlocked when several people posted the same new topic at once.)
async function ensureTopics(names) {
  const ids = [];
  for (const name of names) {
    // Creates the topic the first time anyone uses it; later uses find the same row.
    await execute(
      "INSERT INTO Qa1_topics (name) VALUES (?) ON DUPLICATE KEY UPDATE topic_id = topic_id",
      [name],
    );
    const [rows] = await execute("SELECT topic_id FROM Qa1_topics WHERE name = ?", [name]);
    ids.push(rows[0].topic_id);
  }
  return ids;
}

// Links a NEW post to its topics. Call it inside the post's withTransaction, so
// the post and its links are saved together or not at all.
// (No DELETE first: on a new post there's nothing to delete, and that empty
// DELETE still locked part of the index and deadlocked with other new posts.)
async function linkTopics(connection, postId, topicIds) {
  for (const topicId of topicIds) {
    await connection.execute(
      "INSERT INTO Qa1_board_post_topics (post_id, topic_id) VALUES (?, ?)",
      [postId, topicId],
    );
  }
}

// Changes the topics of an EXISTING post: removes its old links, adds the new ones.
// Call it inside withTransaction. Only links are removed; posts and topics never are.
async function replaceTopics(connection, postId, topicIds) {
  await connection.execute("DELETE FROM Qa1_board_post_topics WHERE post_id = ?", [postId]);
  await linkTopics(connection, postId, topicIds);
}

// { 12: ["joins", "sql"], 15: ["quiz-prep"] } for a list of post ids, in one query.
async function loadTopics(postIds) {
  const byPost = {};
  if (postIds.length === 0) return byPost;
  const placeholders = postIds.map(() => "?").join(", ");
  const [rows] = await execute(
    `SELECT pt.post_id, t.name
     FROM Qa1_board_post_topics pt
     JOIN Qa1_topics t ON t.topic_id = pt.topic_id
     WHERE pt.post_id IN (${placeholders})
     ORDER BY t.name`,
    postIds,
  );
  for (const row of rows) (byPost[row.post_id] = byPost[row.post_id] || []).push(row.name);
  return byPost;
}

// Other posts that share at least one topic with this post, most shared topics first.
// "mine" is this post's topics; "other" is every other post with one of those topics.
// GROUP BY + COUNT turns the matches into one row per post with a score.
async function relatedPosts(postId) {
  const [rows] = await execute(
    `SELECT p.post_id, p.title, p.post_type,
            COUNT(*) AS shared_count,
            GROUP_CONCAT(t.name ORDER BY t.name SEPARATOR ', ') AS shared_topics
     FROM Qa1_board_post_topics mine
     JOIN Qa1_board_post_topics other
       ON other.topic_id = mine.topic_id AND other.post_id <> mine.post_id
     JOIN Qa1_board_posts p ON p.post_id = other.post_id
     JOIN Qa1_topics t ON t.topic_id = mine.topic_id
     WHERE mine.post_id = ? AND p.deleted_at IS NULL
     GROUP BY p.post_id, p.title, p.post_type, p.created_at
     ORDER BY shared_count DESC, p.created_at DESC, p.post_id DESC
     LIMIT ?`,
    [postId, String(MAX_RELATED)],
  );
  return rows;
}

// The most used topics, shown as suggestions under the topics box.
async function popularTopics() {
  const [rows] = await execute(
    `SELECT t.name, COUNT(*) AS uses
     FROM Qa1_topics t
     JOIN Qa1_board_post_topics pt ON pt.topic_id = t.topic_id
     GROUP BY t.topic_id, t.name
     ORDER BY uses DESC, t.name
     LIMIT 12`,
  );
  return rows.map((row) => row.name);
}

module.exports = {
  MAX_TOPICS,
  ensureTopics,
  linkTopics,
  loadTopics,
  parseTopics,
  popularTopics,
  relatedPosts,
  replaceTopics,
};
```

### 3.3 `routes/board.js`

The class feed plan also changes this file (times and avatars), so these are
additions to make, not a whole new file.

**a.** Below the existing `require("../lib/board")` lines:

```js
const {
  ensureTopics,
  linkTopics,
  loadTopics,
  parseTopics,
  popularTopics,
  relatedPosts,
  replaceTopics,
} = require("../lib/topics");
```

**b. Board list (`GET /board`).** Replace the `res.render("board/index", ...)` line with:

```js
      const posts = rows.map(shapeListItem);
      // One extra query loads the topics for every post on the page.
      const topics = await loadTopics(posts.map((post) => post.post_id));
      posts.forEach((post) => { post.topics = topics[post.post_id] || []; });
      res.render("board/index", { title: "Class board", posts, topic: null });
```

**c. New post (`GET /board/new`).**
- Add `topics: ""` to the `form` object.
- At the start of the `try` block, add
  `formPage.popular_topics = await popularTopics();`. The handler needs a
  `try` around everything that touches the database; move the existing
  `?question_id=` lookup inside it.
- In `renderForm`, add `popular_topics: []` to the defaults:
  `{ error: null, linked_question: null, popular_topics: [], ...data }`.

**d. New post (`POST /board/new`).**
- Add `topics: clean(req.body.topics),` to the `form` object.
- Right after the existing `validateNewPost` check:

```js
    const topics = parseTopics(form.topics);
    if (topics.error) return renderForm(res, 400, { ...formPage, error: topics.error });
```

- First line inside `try`, **before** `withTransaction`:

```js
      // Topics are created first, outside the transaction (see ensureTopics).
      const topicIds = await ensureTopics(topics.names);
```

- Inside the transaction, right before `return { postId: insert.insertId };`:

```js
        // Same transaction: the post and its topic links are saved together or not at all.
        await linkTopics(connection, insert.insertId, topicIds);
```

**e. Post page (`renderPostPage`).**
- Add a sixth parameter: `async function renderPostPage(req, res, postId, replyError = null, replyForm = { body: "" }, extra = {})`.
- Right after `const post = shapePost(row, user);`, add these lines (they
  replace the start of the existing `res.status(...).render("board/show", {` line):

```js
  const topics = (await loadTopics([postId]))[postId] || [];
  // Deleted posts don't suggest related posts.
  const related = post.is_deleted || topics.length === 0 ? [] : await relatedPosts(postId);
  res.status(replyError || extra.topics_error ? 400 : 200).render("board/show", {
```

- At the end of the object passed to `render`, after `reply_form: replyForm,`:

```js
    topics,
    related,
    can_edit_topics: post.can_delete,
    topics_error: null,
    topics_form: topics.join(", "),
    ...extra,
```

**f. Two new routes,** right above `module.exports = router;`:

```js
router.post(
  "/board/:id/topics",
  requireLogin,
  asyncHandler(async (req, res) => {
    const postId = parseId(req.params.id);
    if (!postId) return notFound(res);
    const input = clean(req.body.topics);
    try {
      const row = await findPost(postId);
      if (!row) return notFound(res);
      // Only the author, only top-level posts (not replies), only while not deleted.
      if (row.uid_user !== req.session.user.id || row.parent_id !== null || row.deleted_at !== null) {
        return notAllowed(res, "You can only change the topics of your own posts.");
      }
      const topics = parseTopics(input);
      if (topics.error) {
        return await renderPostPage(req, res, postId, null, { body: "" }, { topics_error: topics.error, topics_form: input });
      }
      // Changing topics doesn't use up the post's one edit: topics aren't the post's text.
      const topicIds = await ensureTopics(topics.names);
      await withTransaction((connection) => replaceTopics(connection, postId, topicIds));
      res.redirect(`/board/${postId}`);
    } catch (error) {
      renderDatabaseError(res, error, "error", { title: "Class board" });
    }
  }),
);

router.get(
  "/board/topic/:name",
  asyncHandler(async (req, res) => {
    const { names } = parseTopics(req.params.name);
    if (!names || names.length !== 1) return notFound(res);
    try {
      // Every post with this topic, newest first. Deleted posts are left out.
      const [rows] = await execute(
        `SELECT p.post_id, p.post_type, p.status, p.title, p.event_at, p.created_at,
                p.deleted_at, u.Uname AS username,
                (SELECT COUNT(*) FROM Qa1_board_posts r WHERE r.parent_id = p.post_id) AS reply_count
         FROM Qa1_board_post_topics pt
         JOIN Qa1_topics t ON t.topic_id = pt.topic_id
         JOIN Qa1_board_posts p ON p.post_id = pt.post_id
         JOIN Qa1_users u ON u.uid_user = p.uid_user
         WHERE t.name = ? AND p.deleted_at IS NULL
         ORDER BY p.created_at DESC, p.post_id DESC`,
        [names[0]],
      );
      const posts = rows.map(shapeListItem);
      const topics = await loadTopics(posts.map((post) => post.post_id));
      posts.forEach((post) => { post.topics = topics[post.post_id] || []; });
      res.render("board/index", { title: `Topic: ${names[0]}`, posts, topic: names[0] });
    } catch (error) {
      renderDatabaseError(res, error, "error", { title: "Class board" });
    }
  }),
);

```

### 3.4 Pages

**`views/board/_topics.ejs` (new file):**

```ejs
<%# Topic tags for one post. Each links to that topic's page. Receives: topics (array of names) %>
<% if (topics.length > 0) { %>
  <p class="board-topics">
    <% topics.forEach((name) => { %>
      <a class="board-topic" href="/board/topic/<%= name %>">#<%= name %></a>
    <% }) %>
  </p>
<% } %>
```

**`views/board/index.ejs`:**
- Replace the hero text (from `<p class="eyebrow">Class board</p>` through the
  `board-guide` paragraph) with this, so the same page also works as a topic page:

```ejs
    <p class="eyebrow">Class board</p>
    <% if (topic) { %>
      <h1>#<%= topic %></h1>
      <p class="intro">Every board post about <%= topic %>. <a href="/board">Back to all posts</a></p>
    <% } else { %>
    <h1>Talk, plan, and share</h1>
    <p class="intro">Start a discussion, organize a study group, or share a useful resource.</p>
    <p class="muted board-guide">Answering someone's question? Post it as an answer on <a href="/">the question's page</a> so all the answers stay together.</p>
    <% } %>
```

- In each post card, right above `<p class="meta">`:
  `<% if (!post.is_deleted) { %><%- include("_topics", { topics: post.topics }) %><% } %>`

**`views/board/show.ejs`:**
- Right above the post body (`<div class="card post-body"><%= post.body %></div>`):
  `<%- include("_topics", { topics }) %>`
- Right above `<section class="answers-section">`, the dropdown and the
  author's "Change topics" form:

```ejs
  <% if (!post.is_deleted) { %>
    <%# The related-posts dropdown: closed until clicked, then pick a post to open. %>
    <details class="board-related">
      <summary>Related posts (<%= related.length %>)</summary>
      <% if (topics.length === 0) { %>
        <p class="muted">This post has no topics yet, so there's nothing to compare it with.</p>
      <% } else if (related.length === 0) { %>
        <p class="muted">No other posts share these topics yet.</p>
      <% } else { %>
        <ul>
          <% related.forEach((item) => { %>
            <li>
              <a href="/board/<%= item.post_id %>"><%= item.title %></a>
              <span class="muted">shares <%= item.shared_topics %></span>
            </li>
          <% }) %>
        </ul>
      <% } %>
    </details>

    <% if (can_edit_topics) { %>
      <details class="board-topics-edit"<%= topics_error ? " open" : "" %>>
        <summary>Change topics</summary>
        <% if (topics_error) { %><div class="alert error" role="alert"><%= topics_error %></div><% } %>
        <form method="post" action="/board/<%= post.post_id %>/topics">
          <label for="topics">Topics <span class="hint">(up to 3, separated by commas)</span></label>
          <input id="topics" name="topics" maxlength="100" value="<%= topics_form %>">
          <button class="button secondary small" type="submit">Save topics</button>
        </form>
      </details>
    <% } %>
  <% } %>

```

**`views/board/form.ejs`:** inside the `mode === "new"` block, right above the
study-group `<label for="event_at">`:

```ejs
      <label for="topics">Topics <span class="hint">(optional, up to 3, separated by commas, e.g. sql, joins)</span></label>
      <input id="topics" name="topics" maxlength="100" value="<%= form.topics %>">
      <% const popular = locals.popular_topics || []; %>
      <% if (popular.length > 0) { %>
        <p class="hint">Popular: <%= popular.join(", ") %></p>
      <% } %>

```

**CSS (`public/board.css`, add at the end):**

```css
.board-topics { display: flex; flex-wrap: wrap; gap: .35rem; margin: .2rem 0 .5rem; }
.board-topic {
  border-radius: 999px; background: var(--chip, #eef2f7); color: var(--blue-dark);
  font-size: .8rem; font-weight: 700; padding: .1rem .55rem; text-decoration: none;
}
.board-topic:hover { text-decoration: underline; }
.board-related, .board-topics-edit {
  border: 1px solid var(--line); border-radius: .6rem; background: var(--card); margin: 1rem 0; padding: .7rem 1rem;
}
.board-related summary, .board-topics-edit summary { cursor: pointer; font-weight: 700; color: var(--blue-dark); }
.board-related ul { display: grid; gap: .45rem; margin: .7rem 0 0; padding-left: 1.1rem; }
.board-related li span { font-size: .85rem; margin-left: .3rem; }
```

### 3.5 `npm run check`

Paste this function above `async function main()` in `scripts/check-site.js`:

```js
async function checkTopics(a, b, anon) {
  const topicsOf = async (postId) => {
    const [rows] = await execute(
      `SELECT t.name FROM Qa1_board_post_topics pt JOIN Qa1_topics t ON t.topic_id = pt.topic_id
       WHERE pt.post_id = ? ORDER BY t.name`,
      [postId],
    );
    return rows.map((row) => row.name).join(",");
  };
  const t1 = `t1${run}`;
  const t2 = `t2${run}`;
  const t3 = `t3${run}`;

  const tooMany = await a("POST", "/board/new", { title: "x", body: "y", post_type: "discussion", topics: "a, b, c, d" });
  check("more than 3 topics rejected (form kept)", tooMany.status === 400 && tooMany.text.includes("at most 3"));
  check("invalid topic rejected", (await a("POST", "/board/new", { title: "x", body: "y", post_type: "discussion", topics: "c++!" })).status === 400);

  const first = await a("POST", "/board/new", { title: `Topic post A ${run}`, body: "a", post_type: "discussion", topics: ` ${t1.toUpperCase()}, ${t2} , ${t1}` });
  const firstId = first.location.split("/").pop();
  check("topics are saved cleaned and without duplicates", (await topicsOf(firstId)) === [t1, t2].sort().join(","));
  const second = await b("POST", "/board/new", { title: `Topic post B ${run}`, body: "b", post_type: "resource", topics: `${t1}, ${t2}` });
  const secondId = second.location.split("/").pop();
  const third = await b("POST", "/board/new", { title: `Topic post C ${run}`, body: "c", post_type: "discussion", topics: t2 });
  const thirdId = third.location.split("/").pop();
  await b("POST", "/board/new", { title: `Unrelated ${run}`, body: "d", post_type: "discussion", topics: t3 });

  let page = await anon("GET", `/board/${firstId}`);
  const related = page.text.slice(page.text.indexOf("board-related"));
  check("related posts list the posts that share topics", related.includes(`Topic post B ${run}`) && related.includes(`Topic post C ${run}`));
  check("most shared topics come first", related.indexOf(`Topic post B ${run}`) < related.indexOf(`Topic post C ${run}`));
  check("posts with no shared topic aren't related", !related.includes(`Unrelated ${run}`));
  check("topic page lists every post with that topic", (await anon("GET", `/board/topic/${t2}`)).text.includes(`Topic post C ${run}`));

  check("B can't change A's topics", (await b("POST", `/board/${firstId}/topics`, { topics: t3 })).status === 403);
  check("bad topic change rejected", (await a("POST", `/board/${firstId}/topics`, { topics: "a, b, c, d" })).status === 400);
  check("A changes own topics", (await a("POST", `/board/${firstId}/topics`, { topics: t3 })).location === `/board/${firstId}`);
  check("changing topics doesn't use up the one edit", Number(await sqlValue("SELECT edit_count FROM Qa1_board_posts WHERE post_id = ?", [firstId])) === 0);
  page = await anon("GET", `/board/${firstId}`);
  check("related posts follow the new topics", page.text.includes(`Unrelated ${run}`) && !page.text.includes(`Topic post C ${run}`));

  await b("POST", `/board/${thirdId}/delete`);
  page = await anon("GET", `/board/${secondId}`);
  check("deleted posts aren't suggested as related", !page.text.slice(page.text.indexOf("board-related")).includes(`Topic post C ${run}`));
}
```

And in `main()`, right after `await checkBoard(a, b, anon, questionId);`, add:

```js
  await checkTopics(a, b, anon);
```

### Phase 3 checklist
- [ ] `npm run migrate:status` shows the topics migration as applied on the test database.
- [ ] A new post with `SQL, Joins, sql` ends up with exactly `#joins` and `#sql`.
- [ ] 4 topics, or a topic like `c++!`, is refused with a clear message, and the form keeps what you typed.
- [ ] The related-posts dropdown lists posts that share topics, most shared first, and shows which topics they share.
- [ ] Clicking a tag opens the topic page with every post that has it.
- [ ] "Change topics" works for the author only, and the post can still use its one edit afterwards.
- [ ] Deleted posts never appear as related.
- [ ] `npm run check` ends with ALL PASSED (58 checks at the end of testing this plan, before phases 1–2 are added).

### Problems found while testing this phase

| What happened | What the plan does instead |
|---|---|
| Creating topics inside the post's transaction: **75 of 100** posts made at the same moment with the same new topics crashed with "Deadlock found" | `ensureTopics` creates topics *before* the transaction, one committed statement each |
| Still **~44 of 100** crashed: a new post first ran `DELETE` on its (empty) topic links, which locked part of the index and collided with other new posts | New posts only add links (`linkTopics`); only changing topics deletes first (`replaceTopics`). Result: **300 of 300** saved, 0 deadlocks, no duplicate topics |
| The new-post form can be shown from an error path that doesn't pass the suggestions | The form reads `locals.popular_topics || []` |
