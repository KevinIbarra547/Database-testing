# Plan: question numbers, votes, and the next big feature

This plan comes **after** the class feed (`docs/class-feed-plan.md`, steps 1–4)
is finished and merged into `main`. Each phase is its own branch and its own
pull request. Don't start a phase until the one before it is merged.

| Phase | What it adds | Database change | Who runs the migration |
|---|---|---|---|
| 1 | Question numbers ("#12") everywhere, and "#12" in the search box | None | — |
| 2 | Up/down votes on questions and answers | **One migration: two new tables** | Kevin |
| 3 | A big feature built around changing existing tables (you pick it) | **Migrations on existing tables** | Kevin |

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
| Answer order on a question page | **Highest score first**, ties oldest first. | That's the point of votes. This changes the original spec, which said "oldest first". **Kevin: say if you want to keep oldest first.** |

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

## Phase 3: The big feature (needs your decision first)

### What makes a migration "big"

Phase 2 only **adds** tables, which is the easy kind of migration. The real
skill is changing tables that **already hold data** while the site keeps
working. The usual way is **expand, then switch**:

1. **Expand:** add new columns that old code ignores (nullable, or with a default).
2. **Switch:** deploy the code that uses them.
3. **(Optional) contract:** remove anything old, in a later migration.

Done in this order, the site never breaks, even if steps 1 and 2 happen days apart.

### The options

| Option | What users get | Database change | Size |
|---|---|---|---|
| **A. Q&A safety upgrade** ⭐ | Questions and answers work like the board: deleting keeps the text in the database and shows "deleted", one edit with the original kept, no more answers wiped out by `CASCADE` | `ALTER TABLE` on **`Qa1_questions` and `Qa1_answers`** (the original tables) | Large |
| B. Notifications | A bell with "maya_r answered your question", "2 new replies", marked read when opened | 1 new table with an index on `(uid_user, read_at)` | Large |
| C. Tags | Questions tagged `sql`, `joins`…, tag pages, filter by tag | 2 new tables (many-to-many) | Medium |
| D. Best answer + reputation + profiles | The asker marks the best answer; profile pages with points from votes | 1 new table; points calculated from votes | Medium |

### My recommendation: A

It's the one that teaches real migration work, and it matches the rule your
class chose for the board ("nothing gets deleted"). Right now, deleting a
question still wipes out every answer under it for good.

What I already tested for option A, on a copy of the database with the sample
data, votes and 130 questions:

```sql
ALTER TABLE Qa1_questions
  ADD COLUMN original_title VARCHAR(150) NULL AFTER body,
  ADD COLUMN original_body TEXT NULL AFTER original_title,
  ADD COLUMN edit_count TINYINT NOT NULL DEFAULT 0 AFTER original_body,
  ADD COLUMN deleted_at DATETIME NULL AFTER created_at;
ALTER TABLE Qa1_answers
  ADD COLUMN original_body TEXT NULL AFTER body,
  ADD COLUMN edit_count TINYINT NOT NULL DEFAULT 0 AFTER original_body,
  ADD COLUMN deleted_at DATETIME NULL AFTER created_at;
```

- The `ALTER` worked on tables that already hold data: every existing row got
  `edit_count = 0` and `deleted_at = NULL`.
- **The current code kept working right after the change:** `npm run check`
  passed with no code changes. That's "expand" done safely: step 1 can go live
  before step 2.

**Before choosing A, you need to decide one thing:** your original spec says
"must not create, drop, or alter any tables". Option A changes two of the
original tables. Since this is the test version of the site, that's
reasonable, but it's your call.

Once you choose an option, I'll write its full step-by-step plan the same way
as the class feed and phase 2: exact files, tested SQL, an undo migration, new
checks for `npm run check`, and a checklist.
