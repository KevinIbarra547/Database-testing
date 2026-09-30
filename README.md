# Class Q&A: a database learning project

This is a small server-rendered Q&A app built from the attached spec:

- Node.js + Express
- EJS templates
- MySQL through `mysql2`
- `express-session` for login sessions
- `bcrypt` for password hashing

## Start here

1. Confirm the existing MySQL database has the exact tables `Qa1_users`, `Qa1_questions`, and `Qa1_answers`.
2. In Replit Secrets, add `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME`.
3. Use the database host's public hostname. `127.0.0.1` means "this same server" and will not point from Replit to your other host.
4. Make sure the host allows remote MySQL connections.
5. Restart the app workflow.

`SESSION_SECRET` is also required for real login sessions. Do not put any database password in this file.

## Project layout

- `app.js`: sets up Express and mounts the route files
- `routes/`: one file per feature (`auth`, `questions`, `answers`, `board`)
- `lib/`: shared helpers and form validation
- `db.js`: the connection pool, `execute`, and `withTransaction`
- `migrations/` + `scripts/migrate.js`: safe, tracked database changes (see `migrations/README.md`)
- `AGENTS.md`: rules for the AI agents that work on this repo in parallel

## Working with several AI agents

Each agent builds its own part on its own branch and opens a pull request (see
`AGENTS.md`). Merge the pull requests one at a time on GitHub. Then, in Replit:

1. Pull `main` from the Git pane.
2. Back up the database in phpMyAdmin, then run `npm run migrate:up` in the Shell.
3. Restart the app.

## How to learn from the code

1. Start with `db.js`: it creates one connection pool and exposes `execute` and `withTransaction`.
2. Read the `GET /` route in `routes/questions.js`: the `JOIN` connects questions to users and the `COUNT` counts answers.
3. Read the sign-up route: `bcrypt.hash` protects the password before the `INSERT`.
4. Compare the edit and delete routes: ownership is checked on the server, not only hidden in the HTML.
5. Look at the EJS templates: `<%= %>` escapes text typed by users.

## Useful database checks

These are read-only checks you can run in phpMyAdmin's SQL tab:

```sql
SHOW TABLES;
DESCRIBE Qa1_users;
DESCRIBE Qa1_questions;
DESCRIBE Qa1_answers;
SELECT uid_user, Uname, email, register FROM Qa1_users;
```

The app never creates, drops, or alters the existing tables. New tables are only added through files in `migrations/`, which you run yourself.