# Plan: question numbers, votes, and the next big feature

This plan comes **after** the class feed (`docs/class-feed-plan.md`, steps 1–4)
is finished and merged into `main`. Each phase is its own branch and its own
pull request. Don't start a phase until the one before it is merged.

| Phase | What it adds | Database change | Who runs the migration |
|---|---|---|---|
| 1 | Question numbers ("#12") everywhere, and "#12" in the search box | None | — |
| 2 | Up/down votes on questions and answers | **One migration: two new tables** | Kevin |
| 3 | Q&A safety upgrade: deleting hides instead of erasing, one edit with the original kept, database lock | **Four migrations, two of them change existing tables** | Kevin |

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

(Phase 3 changes the last check in this function on purpose, see 3.9a.)

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

## Phase 3: Q&A safety upgrade (changes the original tables)

**Decided by Kevin:** option A, and changing the original tables is approved
for this test site. This is an intentional change from the original spec,
which said not to alter the tables.

### What users get

Questions and answers work the way board posts already do:

| Today | After phase 3 |
|---|---|
| Deleting a question **permanently erases** it, every answer under it, and their votes (`ON DELETE CASCADE`) | Deleting **hides** the question: its page says "This question was deleted by its author" and **its answers stay** |
| Deleting an answer erases it | The answer shows "This answer was deleted by its author" |
| Editing overwrites the old text forever | One edit each; the original text is kept and shown under **View original** |
| phpMyAdmin can delete anything | The database **refuses** to delete questions and answers (like the board) |

Deleted questions no longer appear on the home page or in the feed, and
deleted answers don't count in answer totals. Nobody can answer, edit or vote
on a deleted question or answer.

### The four migrations, and why they run in this order

| Step | File | What it does | Old code still works? |
|---|---|---|---|
| 3.1 | `202610050900_questions_keep_history.sql` | Adds `original_title`, `original_body`, `edit_count`, `deleted_at` to `Qa1_questions` | ✅ Yes (tested: every check passed) |
| 3.2 | `202610050901_answers_keep_history.sql` | Adds `original_body`, `edit_count`, `deleted_at` to `Qa1_answers` | ✅ Yes (same test) |
| — | *(code change, below)* | Delete becomes "hide", edits keep the original | — |
| 3.3 | `202610050902_questions_no_delete_trigger.sql` | MySQL refuses `DELETE` on questions | ❌ **No**: with the old code, 4 checks failed |
| 3.4 | `202610050903_answers_no_delete_trigger.sql` | MySQL refuses `DELETE` on answers | ❌ No |

This is the **expand → switch → lock** pattern:

1. **Expand:** 3.1 and 3.2 only *add* columns. Each new column is empty
   (`NULL`) or has a default (`edit_count = 0`), and the old code only reads
   the columns it names, so nothing notices. These can go live first, even
   days before the code.
2. **Switch:** deploy the new code that uses the new columns.
3. **Lock:** 3.3 and 3.4 make real deletes impossible. These must come
   **last**. The old code's Delete button really runs `DELETE`, so locking
   first breaks it. That was tested: 4 checks failed with "Questions cannot
   be deleted".

Each file holds one statement, so if one fails, nothing in it was applied and
it can simply be run again after fixing the cause.

### 3.0 `replit.md` "Current task" for this phase

```md
## Current task

Phase 3 of `docs/next-features-plan.md`: the Q&A safety upgrade. Do only
Phase 3, then stop. Also follow `AGENTS.md`.

Exceptions to the "Never" list, for this phase only:
- Create exactly the four migration files in Phase 3, with the exact content
  from the plan. Don't run them; Kevin runs them, in the order the plan gives.
- Qa1_questions and Qa1_answers are changed by those migrations (Kevin approved).
- Questions and answers are never deleted with DELETE any more: "delete" sets
  deleted_at. Don't touch the trg_questions_no_delete or trg_answers_no_delete
  triggers.
```

### 3.1–3.4 The migration files (use exactly these)

`migrations/202610050900_questions_keep_history.sql`:

```sql
-- Phase 3, step 1 of 4 ("expand"): give questions the same safety as the board.
-- This CHANGES an original table (approved by Kevin for the test site).
--
--   original_title / original_body  the text from before the one allowed edit
--   edit_count                      0 or 1
--   deleted_at                      "soft delete": set instead of removing the row
--
-- Every new column is NULL or has a default, so the current code keeps working
-- the moment this runs (tested: `npm run check` passed with no code changes).
-- One statement per file: if it fails, nothing changed and it can be re-run.
ALTER TABLE Qa1_questions
  ADD COLUMN original_title VARCHAR(150) NULL AFTER body,
  ADD COLUMN original_body TEXT NULL AFTER original_title,
  ADD COLUMN edit_count TINYINT NOT NULL DEFAULT 0 AFTER original_body,
  ADD COLUMN deleted_at DATETIME NULL AFTER created_at;
```

`migrations/202610050901_answers_keep_history.sql`:

```sql
-- Phase 3, step 2 of 4 ("expand"): the same for answers.
-- This CHANGES an original table (approved by Kevin for the test site).
-- Every new column is NULL or has a default, so the current code keeps working.
ALTER TABLE Qa1_answers
  ADD COLUMN original_body TEXT NULL AFTER body,
  ADD COLUMN edit_count TINYINT NOT NULL DEFAULT 0 AFTER original_body,
  ADD COLUMN deleted_at DATETIME NULL AFTER created_at;
```

`migrations/202610050902_questions_no_delete_trigger.sql`:

```sql
-- Phase 3, step 3 of 4 ("lock"): MySQL refuses to DELETE a question, even from
-- phpMyAdmin. Run this ONLY AFTER the soft-delete code is live: the old code
-- really deletes questions, and this lock would make its Delete button fail.
--
-- Because questions are never deleted any more, ON DELETE CASCADE from
-- questions to answers and votes never runs: answers and votes are kept.
-- In its own file because some hosts don't allow triggers. If it fails with
-- "access denied" or "SUPER privilege", the site still works without the lock.
CREATE TRIGGER trg_questions_no_delete
BEFORE DELETE ON Qa1_questions
FOR EACH ROW
SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'Questions cannot be deleted. Set deleted_at instead.';
```

`migrations/202610050903_answers_no_delete_trigger.sql`:

```sql
-- Phase 3, step 4 of 4 ("lock"): the same for answers. Same rules as the
-- question lock: run it only after the soft-delete code is live.
CREATE TRIGGER trg_answers_no_delete
BEFORE DELETE ON Qa1_answers
FOR EACH ROW
SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'Answers cannot be deleted. Set deleted_at instead.';
```

**Kevin, in this order** (test database first, then the real one after the
pull request is merged):

1. Back up the database in phpMyAdmin (Export).
2. Temporarily move the two `*_no_delete_trigger.sql` files out of
   `migrations/` (for example to `docs/`), or have the agent add them in a
   second commit. Then `npm run migrate:up` runs **only 3.1 and 3.2**.
3. Run `npm run check` with the **old** code: it should still say ALL PASSED.
4. Pull the new code, restart, run `npm run check`.
5. Put the two trigger files back, run `npm run migrate:up` again (3.3 and 3.4), restart, run `npm run check`.

On the real database, the simplest safe order is: merge, pull, back up, run
`npm run migrate:up` (it applies all four in name order), restart right away.
The few seconds between the triggers being added and the restart are the only
moment the old Delete button would fail, and nobody is likely to press it.

### 3.5 `routes/answers.js` (replace the whole file)

The class feed plan doesn't touch this file, so it can be replaced whole.

```js
const express = require("express");
const { execute } = require("../db");
const { asyncHandler, clean, renderDatabaseError, requireLogin } = require("../lib/helpers");
const { validateAnswer } = require("../lib/validation");

const router = express.Router();

// Checks that this user may edit this answer right now.
// Returns an error message, or null when editing is allowed.
function answerEditBlocker(answer, user) {
  if (answer.uid_user !== user.id) return "You can only edit your own answers.";
  if (answer.deleted_at !== null) return "Deleted answers can't be edited.";
  if (answer.edit_count >= 1) return "You've already used your one edit on this answer.";
  return null;
}

router.post(
  "/questions/:id/answers",
  requireLogin,
  asyncHandler(async (req, res) => {
    const body = clean(req.body.body);
    const validationError = validateAnswer(body);
    if (validationError) return res.redirect(`/questions/${req.params.id}?error=answer`);

    try {
      // Deleted questions can't get new answers.
      const [questions] = await execute(
        "SELECT question_id FROM Qa1_questions WHERE question_id = ? AND deleted_at IS NULL",
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

router.get(
  "/answers/:id/edit",
  requireLogin,
  asyncHandler(async (req, res) => {
    try {
      const [answers] = await execute(
        `SELECT answer_id, question_id, uid_user, body, edit_count, deleted_at
         FROM Qa1_answers WHERE answer_id = ?`,
        [req.params.id],
      );
      const answer = answers[0];
      if (!answer) return res.status(404).render("404", { title: "Answer not found" });
      const blocker = answerEditBlocker(answer, req.session.user);
      if (blocker) return res.status(403).render("error", { title: "Not allowed", error: blocker });
      res.render("edit-answer", { title: "Edit answer", answer, error: null });
    } catch (error) {
      renderDatabaseError(res, error, "setup");
    }
  }),
);

router.post(
  "/answers/:id/edit",
  requireLogin,
  asyncHandler(async (req, res) => {
    const body = clean(req.body.body);
    const validationError = validateAnswer(body);
    try {
      const [answers] = await execute(
        `SELECT answer_id, question_id, uid_user, body, edit_count, deleted_at
         FROM Qa1_answers WHERE answer_id = ?`,
        [req.params.id],
      );
      const answer = answers[0];
      if (!answer) return res.status(404).render("404", { title: "Answer not found" });
      const blocker = answerEditBlocker(answer, req.session.user);
      if (blocker) return res.status(403).render("error", { title: "Not allowed", error: blocker });
      if (validationError) {
        return res.status(400).render("edit-answer", {
          title: "Edit answer",
          answer: { ...answer, body },
          error: validationError,
        });
      }

      // One statement: the old text is copied to original_body before it is
      // replaced, and "edit_count = 0" stops a second edit.
      const [result] = await execute(
        `UPDATE Qa1_answers
         SET original_body = body, body = ?, edit_count = edit_count + 1
         WHERE answer_id = ? AND uid_user = ? AND edit_count = 0 AND deleted_at IS NULL`,
        [body, req.params.id, req.session.user.id],
      );
      if (result.affectedRows === 0) {
        return res.status(403).render("error", {
          title: "Not allowed",
          error: "You've already used your one edit on this answer.",
        });
      }
      res.redirect(`/questions/${answer.question_id}#answer-${answer.answer_id}`);
    } catch (error) {
      renderDatabaseError(res, error, "edit-answer", {
        answer: { answer_id: req.params.id, body },
      });
    }
  }),
);

router.post(
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
      // Soft delete: the answer stays in the database and shows as deleted.
      await execute(
        `UPDATE Qa1_answers SET deleted_at = NOW()
         WHERE answer_id = ? AND uid_user = ? AND deleted_at IS NULL`,
        [req.params.id, req.session.user.id],
      );
      res.redirect(`/questions/${answer.question_id}#answer-${req.params.id}`);
    } catch (error) {
      renderDatabaseError(res, error, "setup");
    }
  }),
);

module.exports = router;
```

### 3.6 `routes/questions.js`

**a. Two helpers.** Add them right below `const router = express.Router();`:

```js
// Clears the text of a soft-deleted question or answer before it reaches a page.
function hideIfDeleted(row, fields) {
  if (!row.deleted_at) return;
  for (const field of fields) row[field] = null;
}

// Checks that this user may edit this question right now.
// Returns an error message, or null when editing is allowed.
function questionEditBlocker(question, user) {
  if (question.uid_user !== user.id) return "You can only edit your own questions.";
  if (question.deleted_at !== null) return "Deleted questions can't be edited.";
  if (question.edit_count >= 1) return "You've already used your one edit on this question.";
  return null;
}
```

**b. Home query (`GET /`).** Two changes, everything else stays (search,
tabs, paging, `age_seconds`, `score`):

- The answers join only counts answers that aren't deleted:
  `LEFT JOIN Qa1_answers a ON a.question_id = q.question_id AND a.deleted_at IS NULL`
- Deleted questions are hidden. Put this condition first in the `WHERE`:
  `WHERE q.deleted_at IS NULL AND (? = '' OR q.title LIKE ? OR q.body LIKE ?)`

**c. Question page (`GET /questions/:id`).**

- In the question query, add this line right after `q.created_at,`:
  `q.original_title, q.original_body, q.edit_count, q.deleted_at,`
- In the answers query, add this line right after `a.created_at,`:
  `a.original_body, a.edit_count, a.deleted_at,`
- Replace the start of the `res.render("question", {` call with:

```js
      // Deleted posts never send their text to the page.
      hideIfDeleted(question, ["title", "body", "original_title", "original_body"]);
      answers.forEach((answer) => hideIfDeleted(answer, ["body", "original_body"]));
      res.render("question", {
        title: question.deleted_at ? "Deleted question" : question.title,
        question,
        answers,
```

**d. Edit and delete.** Replace the three handlers, `GET /questions/:id/edit`,
`POST /questions/:id/edit` and `POST /questions/:id/delete`, with:

```js
router.get(
  "/questions/:id/edit",
  requireLogin,
  asyncHandler(async (req, res) => {
    try {
      const [questions] = await execute(
        `SELECT question_id, uid_user, title, body, edit_count, deleted_at
         FROM Qa1_questions WHERE question_id = ?`,
        [req.params.id],
      );
      const question = questions[0];
      if (!question) return res.status(404).render("404", { title: "Question not found" });
      const blocker = questionEditBlocker(question, req.session.user);
      if (blocker) return res.status(403).render("error", { title: "Not allowed", error: blocker });
      res.render("edit-question", { title: "Edit question", question, error: null });
    } catch (error) {
      renderDatabaseError(res, error, "setup");
    }
  }),
);

router.post(
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
        "SELECT uid_user, edit_count, deleted_at FROM Qa1_questions WHERE question_id = ?",
        [req.params.id],
      );
      const question = questions[0];
      if (!question) return res.status(404).render("404", { title: "Question not found" });
      const blocker = questionEditBlocker(question, req.session.user);
      if (blocker) return res.status(403).render("error", { title: "Not allowed", error: blocker });

      // One statement does the whole edit. MySQL runs SET from left to right, so
      // original_title/original_body get the OLD text before it is replaced.
      // "edit_count = 0" makes a second edit (or a double-click) change nothing.
      const [result] = await execute(
        `UPDATE Qa1_questions
         SET original_title = title, original_body = body,
             title = ?, body = ?, edit_count = edit_count + 1
         WHERE question_id = ? AND uid_user = ? AND edit_count = 0 AND deleted_at IS NULL`,
        [form.title, form.body, req.params.id, req.session.user.id],
      );
      if (result.affectedRows === 0) {
        return res.status(403).render("error", {
          title: "Not allowed",
          error: "You've already used your one edit on this question.",
        });
      }
      res.redirect(`/questions/${req.params.id}`);
    } catch (error) {
      renderDatabaseError(res, error, "edit-question", {
        question: { question_id: req.params.id, ...form },
      });
    }
  }),
);

router.post(
  "/questions/:id/delete",
  requireLogin,
  asyncHandler(async (req, res) => {
    try {
      const [questions] = await execute(
        "SELECT uid_user FROM Qa1_questions WHERE question_id = ?",
        [req.params.id],
      );
      if (!questions[0]) return res.status(404).render("404", { title: "Question not found" });
      if (questions[0].uid_user !== req.session.user.id) {
        return res.status(403).render("error", {
          title: "Not allowed",
          error: "You can only delete your own questions.",
        });
      }
      // Soft delete: the question stays in the database and shows as deleted.
      // Its answers and votes are kept. The uid_user check is the real guard.
      await execute(
        `UPDATE Qa1_questions SET deleted_at = NOW()
         WHERE question_id = ? AND uid_user = ? AND deleted_at IS NULL`,
        [req.params.id, req.session.user.id],
      );
      res.redirect("/");
    } catch (error) {
      renderDatabaseError(res, error, "setup");
    }
  }),
);
```

### 3.7 Votes, board and feed

**`routes/votes.js`:** deleted posts count as "not found". Change the two
`target` queries to:

```js
  // in QUESTION_SQL
  target: "SELECT uid_user, question_id FROM Qa1_questions WHERE question_id = ? AND deleted_at IS NULL",
  // in ANSWER_SQL
  target: `SELECT a.uid_user, a.question_id FROM Qa1_answers a
           JOIN Qa1_questions q ON q.question_id = a.question_id
           WHERE a.answer_id = ? AND a.deleted_at IS NULL AND q.deleted_at IS NULL`,
```

**`routes/board.js`:** a hidden question counts as deleted for board links.
Three small changes:

| Where | Change |
|---|---|
| `renderPostPage`, the `LEFT JOIN Qa1_questions q ...` line | add `AND q.deleted_at IS NULL` to the end of the `ON` |
| `POST /board/new`, the `SELECT title FROM Qa1_questions ...` | add `AND deleted_at IS NULL` before `LOCK IN SHARE MODE` |
| `GET /board/new`, the `SELECT question_id, title FROM Qa1_questions ...` | add `AND deleted_at IS NULL` at the end |

**`lib/board.js`, in `shapePost`:** replace the `question:` and
`linked_question_deleted:` lines with:

```js
    // live_question_title is NULL when the linked question was deleted (soft or for real).
    question: row.live_question_title !== null ? { question_id: row.question_id, title: row.live_question_title } : null,
    linked_question_deleted: row.linked_question_title !== null && row.live_question_title === null,
```

(Before this phase, a deleted question set `question_id` to `NULL`. Now the
question row stays, so `question_id` keeps its value, and the old check would
have linked to a deleted question.)

**`routes/feed.js`:** in `FEED_SQL`, on the **question** side of the `UNION ALL`:

- the `reply_count` subquery gets `AND a.deleted_at IS NULL`
- add `WHERE q.deleted_at IS NULL` after `JOIN Qa1_users u ON u.uid_user = q.uid_user`

In `COUNTS_SQL`, the two question counts become:

```sql
    (SELECT COUNT(*) FROM Qa1_questions WHERE deleted_at IS NULL) AS questions,
    (SELECT COUNT(*) FROM Qa1_questions q WHERE q.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM Qa1_answers a WHERE a.question_id = q.question_id AND a.deleted_at IS NULL)) AS unanswered,
```

### 3.8 Pages

**`views/question.ejs`.** Four changes. Keep the time and avatar changes from
the class feed plan wherever these snippets show `created_at` or a username.

1. Replace the title, meta line, body and question vote buttons (everything
   from `<h1>` down to just before the "Discuss this on the board" block) with
   the block below. The "Discuss" block's opening line becomes
   `<% if (currentUser && !question.deleted_at) { %>`.

```ejs
  <% if (question.deleted_at) { %>
    <h1>Deleted question</h1>
    <div class="card post-body muted">This question was deleted by its author. Its answers are still below.</div>
  <% } else { %>
    <h1><%= question.title %></h1>
    <p class="meta">Asked by <strong><%= question.username %></strong> · <%= question.created_at %>
      <% if (question.edit_count > 0) { %> · <em>Edited</em><% } %></p>
    <div class="card post-body"><%= question.body %></div>
    <% if (question.edit_count > 0) { %>
      <details class="original-text">
        <summary>View original</summary>
        <p><strong><%= question.original_title %></strong></p>
        <div class="post-body"><%= question.original_body %></div>
      </details>
    <% } %>
  <% } %>
  <%- include("partials/vote-buttons", {
    score: question.score,
    my_vote: question.my_vote,
    action: `/questions/${question.question_id}/vote`,
    can_vote: Boolean(currentUser) && currentUser.id !== question.uid_user && !question.deleted_at,
  }) %>
```

2. Replace the question's Edit/Delete block with:

```ejs
  <% if (currentUser && currentUser.id === question.uid_user && !question.deleted_at) { %>
    <div class="post-actions">
      <% if (question.edit_count === 0) { %>
        <a class="button secondary small" href="/questions/<%= question.question_id %>/edit">Edit question (once)</a>
      <% } %>
      <form method="post" action="/questions/<%= question.question_id %>/delete" onsubmit="return confirm('Delete this question? Its answers will stay.')">
        <button class="button danger small" type="submit">Delete question</button>
      </form>
    </div>
  <% } %>
```

3. Replace each answer card (the whole `<article ...>` inside the
   `answers.forEach` loop) with:

```ejs
      <article class="card answer-card" id="answer-<%= answer.answer_id %>">
        <%- include("partials/vote-buttons", {
          score: answer.score,
          my_vote: answer.my_vote,
          action: `/answers/${answer.answer_id}/vote`,
          can_vote: Boolean(currentUser) && currentUser.id !== answer.uid_user && !answer.deleted_at && !question.deleted_at,
        }) %>
        <% if (answer.deleted_at) { %>
          <p class="muted">This answer was deleted by its author.</p>
        <% } else { %>
        <div class="post-body"><%= answer.body %></div>
        <p class="meta">Answered by <strong><%= answer.username %></strong> · <%= answer.created_at %>
          <% if (answer.edit_count > 0) { %> · <em>Edited</em><% } %></p>
        <% if (answer.edit_count > 0) { %>
          <details class="original-text">
            <summary>View original</summary>
            <div class="post-body"><%= answer.original_body %></div>
          </details>
        <% } %>
        <% if (currentUser && currentUser.id === answer.uid_user) { %>
          <div class="post-actions">
            <% if (answer.edit_count === 0) { %>
              <a class="button secondary small" href="/answers/<%= answer.answer_id %>/edit">Edit (once)</a>
            <% } %>
            <form method="post" action="/answers/<%= answer.answer_id %>/delete" onsubmit="return confirm('Delete this answer?')">
              <button class="button danger small" type="submit">Delete</button>
            </form>
          </div>
        <% } %>
        <% } %>
      </article>
```

4. The answer form at the bottom: replace its opening `<% if (currentUser) { %>` with:

```ejs
  <% if (question.deleted_at) { %>
    <section class="card callout"><p>This question was deleted, so it can't get new answers.</p></section>
  <% } else if (currentUser) { %>
```

**`views/edit-question.ejs` and `views/edit-answer.ejs`:** add this line right above `<% if (error) { %>`:

```ejs
  <div class="alert board-note">You can only edit once. Your original text will be kept and visible to everyone.</div>
```

**CSS (`public/styles.css`, add at the end):**

```css
.original-text { background: #f2f6fb; border-radius: .6rem; margin: 0 0 1rem; padding: .75rem 1rem; }
.original-text summary { color: var(--blue-dark); cursor: pointer; font-weight: 700; }
```

### 3.9 `npm run check`

**a. Two vote checks change on purpose,** because votes now survive a deleted
question. In `checkVotes`, replace the last check ("deleting a question
deletes its votes") with:

```js
  check("votes are kept when a question is deleted", Number(await voteRows("Qa1_question_votes", "question_id", questionId)) === 1
    && Number(await voteRows("Qa1_answer_votes", "answer_id", answerId)) === 1);
  check("deleted question can't be voted on", (await b("POST", `/questions/${questionId}/vote`, { direction: "down" })).status === 404);
```

**b. New checks.** Paste this function above `async function main()`:

```js
async function checkHistory(a, b, anon) {
  const asked = await a("POST", "/questions/new", { title: `History ${run}`, body: "First version" });
  const questionId = asked.location.split("/").pop();
  check("A edits own question once", (await a("POST", `/questions/${questionId}/edit`, { title: `History v2 ${run}`, body: "Second version" })).location === `/questions/${questionId}`);
  let page = await anon("GET", `/questions/${questionId}`);
  check("edited question shows Edited and the original", page.text.includes("Second version") && page.text.includes("View original") && page.text.includes("First version"));
  check("a second question edit is refused", (await a("POST", `/questions/${questionId}/edit`, { title: "again", body: "again" })).status === 403);

  await b("POST", `/questions/${questionId}/answers`, { body: `Kept answer ${run}` });
  await b("POST", `/questions/${questionId}/answers`, { body: `Gone answer ${run}` });
  const [answerRows] = await execute("SELECT answer_id FROM Qa1_answers WHERE question_id = ? ORDER BY answer_id", [questionId]);
  const [keptId, goneId] = answerRows.map((row) => row.answer_id);
  check("B edits own answer once", (await b("POST", `/answers/${keptId}/edit`, { body: `Kept answer v2 ${run}` })).status === 302);
  check("a second answer edit is refused", (await b("POST", `/answers/${keptId}/edit`, { body: "again" })).status === 403);
  check("B deletes own answer", (await b("POST", `/answers/${goneId}/delete`)).status === 302);
  page = await anon("GET", `/questions/${questionId}`);
  check("deleted answer shows as deleted, text hidden", page.text.includes("This answer was deleted") && !page.text.includes(`Gone answer ${run}`));
  check("deleted answer is still in the database", Number(await sqlValue("SELECT COUNT(*) FROM Qa1_answers WHERE answer_id = ? AND deleted_at IS NOT NULL", [goneId])) === 1);

  check("A deletes own question", (await a("POST", `/questions/${questionId}/delete`)).location === "/");
  check("home no longer lists the deleted question", !(await anon("GET", "/")).text.includes(`History v2 ${run}`));
  page = await anon("GET", `/questions/${questionId}`);
  check("deleted question page hides its text, keeps answers", page.text.includes("deleted by its author") && !page.text.includes("Second version") && page.text.includes(`Kept answer v2 ${run}`));
  check("deleted question can't get new answers", (await b("POST", `/questions/${questionId}/answers`, { body: "late" })).status === 404);
  check("deleted question can't be edited", (await a("GET", `/questions/${questionId}/edit`)).status === 403);
  check("deleted question is still in the database", Number(await sqlValue("SELECT COUNT(*) FROM Qa1_questions WHERE question_id = ? AND deleted_at IS NOT NULL", [questionId])) === 1);
}
```

And in `main()`, right after `await checkVotes(a, b, anon);`, add:

```js
  await checkHistory(a, b, anon);
```

### 3.10 Update the rulebooks

These still say the original tables can't change. After phase 3 is merged:

- `migrations/README.md`: replace "Only add new tables. Never change
  `Qa1_users`, `Qa1_questions` or `Qa1_answers`." with "Prefer adding new
  tables. Changing an existing table needs Kevin's approval and must keep the
  current code working (add columns that are NULL or have a default)."
- `AGENTS.md`, rule 1 under "Database rules": the same wording.

### Phase 3 checklist

- [ ] After 3.1 and 3.2 only, with the **old** code: `npm run check` ends with ALL PASSED.
- [ ] Edit a question once: "Edited" shows, and "View original" shows the old title and text. A second edit is refused.
- [ ] Same for an answer.
- [ ] Delete an answer: it shows "This answer was deleted by its author", and the row is still in phpMyAdmin with `deleted_at` filled in.
- [ ] Delete a question: it disappears from the home page and feed; its page says deleted; its answers are still listed; no new answers, edits or votes.
- [ ] A board post linked to that question says the linked question was deleted.
- [ ] After 3.3 and 3.4: in phpMyAdmin's SQL tab on the **test** database, `DELETE FROM Qa1_answers WHERE answer_id = 1;` fails with "Answers cannot be deleted".
- [ ] `npm run check` ends with ALL PASSED (72 checks at the end of testing this plan).

### Undo plan

Never edit or delete the four migration files. To undo, add **new** migrations, in reverse order:

```sql
DROP TRIGGER trg_answers_no_delete;
DROP TRIGGER trg_questions_no_delete;
ALTER TABLE Qa1_answers DROP COLUMN original_body, DROP COLUMN edit_count, DROP COLUMN deleted_at;
ALTER TABLE Qa1_questions DROP COLUMN original_title, DROP COLUMN original_body, DROP COLUMN edit_count, DROP COLUMN deleted_at;
```

⚠️ Dropping the columns **erases** every saved original text, and turns
every "deleted" question and answer back into a visible one. Remove the code
that uses the columns first, then run this. (Tested: the tables went back to
their exact original columns.)

### Problems found while testing this phase

| What happened | What the plan does about it |
|---|---|
| Adding the triggers before the new code: 4 checks failed ("Questions cannot be deleted") | Triggers are steps 3.3 and 3.4, after the code switch |
| A board post linked to a soft-deleted question kept linking to it, because `question_id` is no longer cleared | The board checks the live question's `deleted_at` (3.7) |
| Inserting the new columns into the question query by matching the wrong line made **every** post look deleted, so all their text disappeared | 3.6c says exactly which line they go after, `hideIfDeleted` treats a missing column as "not deleted", and `npm run check` caught it immediately |
| "Deleting a question deletes its votes" stopped being true | The check is replaced on purpose (3.9a) |
