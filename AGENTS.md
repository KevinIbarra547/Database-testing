# Rules for AI agents working on this repo

Two AI agents work on this project **at the same time**, each on its own
feature and its own branch. These rules keep them from breaking the database
or creating merge conflicts. Read the whole file before changing anything.

The app is described in `attached_assets/Pasted-Q-A-CRUD-App-Spec-*.txt` and
`README.md`. The security rules in the spec still apply to all new code.

## Who owns what

| Feature | Agent | Branch |
|---|---|---|
| Voting on answers | Claude Code | `claude/dazzling-noether-hgzvt0` |
| Tags on questions | Google AI Studio | `ai-studio/tags` |

Only work on **your** feature, on **your** branch. Never push to `main` or to
the other agent's branch.

### Files you own (edit freely)

| Voting (Claude Code) | Tags (Google AI Studio) |
|---|---|
| `routes/votes.js` | `routes/tags.js` |
| `public/votes.css` | `public/tags.css` |
| `views/partials/answer-votes.ejs` | `views/partials/question-tags.ejs` |
| new files named `*vote*` | new files named `*tag*` (for example `lib/tags.js`, `views/tag.ejs`) |
| your own migration files | your own migration files |

These placeholder files already exist and are already connected to the app:
the routers are mounted in `app.js`, the CSS files are linked in
`views/partials/header.ejs`, and the partials are already included in the
pages. **You do not need to edit `app.js`, `header.ejs` or `styles.css`.**

### Shared files (small, targeted edits only)

| File | Voting may change | Tags may change |
|---|---|---|
| `routes/questions.js` | only the answers query in `GET /questions/:id` | `GET /`, `POST /questions/new`, `POST /questions/:id/edit`, and one line in `GET /questions/:id` that loads the question's tags |
| `views/new-question.ejs`, `views/edit-question.ejs` | nothing | add a tags input |

Keep shared-file edits small: call a helper from your own file instead of
pasting big blocks into shared files. Do not reformat, rename or reorder
code you are not changing.

### Do not touch

`db.js`, `app.js`, `lib/`, `scripts/`, `package.json`, `package-lock.json`,
`.replit`, the spec, and any migration file you did not write. If you think
one of these must change, say so in your pull request instead.

## Database rules

1. **Never change the three original tables** (`Qa1_users`, `Qa1_questions`,
   `Qa1_answers`). No `ALTER`, `DROP`, `RENAME` or `TRUNCATE` on them.
2. **New tables only, through migration files.** Never tell the user to run
   SQL by hand, and never create tables from the app's code.
3. Migration files go in `migrations/` and are named
   `YYYYMMDDHHMM_short_description.sql` using the current date and time,
   for example `202609281530_create_tags.sql`. The timestamp keeps two agents
   from picking the same name.
4. Use `CREATE TABLE IF NOT EXISTS`, `ENGINE=InnoDB`, and name every
   constraint (`CONSTRAINT fk_tags_... FOREIGN KEY ...`).
5. A foreign key column must have exactly the same type as the column it
   points to. The original id columns are plain `INT` (not `UNSIGNED`).
6. Once a migration is merged, **never edit it**. Add a new one instead.
   `npm run migrate:status` flags edited migrations.
7. Name new tables with the `Qa1_` prefix (for example `Qa1_tags`).

## Code rules (from the spec)

- Every query uses `?` placeholders. Never build SQL from user input.
- Use `execute(sql, params)` from `db.js` for single queries. When one action
  writes to more than one table, use `withTransaction` from `db.js` so it is
  all-or-nothing.
- Check ownership on the server before any edit or delete.
- In EJS, use `<%= %>` for anything a user typed, never `<%- %>`.
- Validate input and show friendly errors (use `renderDatabaseError` from
  `lib/helpers.js`); never show raw database errors.
- Keep files small, with short comments explaining each query. This is a
  learning project.
- No new npm packages.

## Finishing your work

1. Make sure the app still starts with `npm start` and every existing page
   still works.
2. Open a pull request from your branch into `main`. In the description, list
   every file you changed and every migration you added.
3. The human merges pull requests one at a time. After merging, they pull in
   Replit, run `npm run migrate:up` in the Shell, and restart the app.
