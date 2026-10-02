# Notes for the Replit Agent

Class Q&A: a school database project (Node.js, Express, EJS, MySQL through
`mysql2`). The database is an external MySQL database; its login is in Replit
Secrets.

## Current task

Build the **class feed**, one step at a time, exactly as written in
`docs/class-feed-plan.md`. Do only the step Kevin asks for, then stop.
Also follow `AGENTS.md`.

## Never

- Never change the database structure: no `CREATE`, `ALTER`, `DROP`,
  `RENAME`, `TRUNCATE` or `DELETE` SQL anywhere, and never touch the
  `trg_board_posts_no_delete` trigger. This task needs no database changes.
- Never edit `db.js`, `migrations/`, `scripts/migrate.js` or `scripts/seed.js`.
- Never install npm packages.
- Never run `npm run seed` or `npm run check`, and never create test posts in
  the app, unless Kevin confirms `DB_NAME` points at a **test** database.
  Board posts can never be deleted, so test posts on the real database stay forever.

## Always

- `?` placeholders in every query; numbers for `LIMIT ?`/`OFFSET ?` passed as strings.
- `<%= %>` for every value in EJS.
- Keep every existing page working. After each step, on a test database,
  `npm run check` must end with **ALL PASSED**.
