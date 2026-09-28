# Migrations

Each `.sql` file here is one change to the database's structure, such as
adding a table. The files run in name order, and each one runs only once.

- Name: `YYYYMMDDHHMM_short_description.sql` (for example `202609281530_create_tags.sql`).
- Only add new tables. Never change `Qa1_users`, `Qa1_questions` or `Qa1_answers`.
- Never edit a file after it has been applied. Add a new file instead.

## Running them (Replit Shell)

1. Back up the database in phpMyAdmin (Export → SQL).
2. `npm run migrate:status`: read-only; lists applied and pending files.
3. `npm run migrate:up`: asks you to type the database name, then applies the pending files.

Applied files are recorded in the `Qa1_migrations` table.
