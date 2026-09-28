// Applies the SQL files in migrations/ to the database, in order, exactly once.
//
//   npm run migrate:status   -> read-only: shows which migrations are applied or pending
//   npm run migrate:up       -> applies pending migrations (asks you to confirm first)
//
// Applied migrations are recorded in the Qa1_migrations table, together with a
// checksum of the file, so the script can warn you if an old file was edited.
// Run this by hand from the Replit Shell. The web app itself never runs it.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const mysql = require("mysql2/promise");
const { missingSecrets } = require("../db");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
// Timestamped names (YYYYMMDDHHMM_what_it_does.sql) keep two people from picking the same number.
const FILE_PATTERN = /^\d{12}_[a-z0-9_]+\.sql$/;

function readMigrationFiles() {
  const names = fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql"));
  const badNames = names.filter((name) => !FILE_PATTERN.test(name));
  if (badNames.length > 0) {
    throw new Error(
      `These files are not named like YYYYMMDDHHMM_description.sql: ${badNames.join(", ")}`,
    );
  }
  return names.sort().map((name) => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    return { name, sql, checksum };
  });
}

async function connect() {
  if (missingSecrets.length > 0) {
    throw new Error(`Missing Secrets: ${missingSecrets.join(", ")}`);
  }
  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    // Migration files may hold several statements. This is safe here because the
    // SQL comes from files in the repo, never from anything a user typed.
    multipleStatements: true,
  });
}

async function loadApplied(connection, command) {
  // "status" must stay read-only, so it does not create the log table.
  const [tables] = await connection.query("SHOW TABLES LIKE 'Qa1_migrations'");
  if (tables.length === 0 && command === "status") return new Map();

  // The only table this project creates on its own: a log of applied migrations.
  await connection.query(
    `CREATE TABLE IF NOT EXISTS Qa1_migrations (
       name VARCHAR(255) NOT NULL PRIMARY KEY,
       checksum CHAR(64) NOT NULL,
       applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB`,
  );
  const [rows] = await connection.query("SELECT name, checksum FROM Qa1_migrations");
  return new Map(rows.map((row) => [row.name, row.checksum]));
}

function printStatus(files, applied) {
  for (const file of files) {
    const saved = applied.get(file.name);
    if (!saved) console.log(`  pending   ${file.name}`);
    else if (saved !== file.checksum) console.log(`  CHANGED   ${file.name}  <- edited after it was applied!`);
    else console.log(`  applied   ${file.name}`);
  }
  const unknown = [...applied.keys()].filter((name) => !files.some((file) => file.name === name));
  for (const name of unknown) console.log(`  missing   ${name}  <- applied, but the file is gone`);
}

async function confirm(question) {
  if (process.argv.includes("--yes")) return true;
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(question);
  prompt.close();
  return answer.trim() === process.env.DB_NAME;
}

async function main() {
  const command = process.argv[2];
  if (command !== "status" && command !== "up") {
    console.log("Usage: node scripts/migrate.js status | up [--yes]");
    process.exitCode = 1;
    return;
  }

  const files = readMigrationFiles();
  const connection = await connect();
  try {
    console.log(`Database: ${process.env.DB_NAME} on ${process.env.DB_HOST}\n`);
    const applied = await loadApplied(connection, command);
    printStatus(files, applied);

    const changed = files.filter((file) => applied.has(file.name) && applied.get(file.name) !== file.checksum);
    if (changed.length > 0) {
      console.log("\nAn applied migration was edited. Put the old file back and add a NEW migration instead.");
      process.exitCode = 1;
      return;
    }

    const pending = files.filter((file) => !applied.has(file.name));
    if (command === "status" || pending.length === 0) {
      console.log(pending.length === 0 ? "\nNothing to apply." : `\n${pending.length} pending.`);
      return;
    }

    console.log("\nBack up the database in phpMyAdmin (Export) before continuing.");
    const ok = await confirm(`Type the database name (${process.env.DB_NAME}) to apply ${pending.length} migration(s): `);
    if (!ok) {
      console.log("Cancelled. Nothing was changed.");
      return;
    }

    for (const file of pending) {
      console.log(`Applying ${file.name} ...`);
      try {
        await connection.query(file.sql);
      } catch (error) {
        // MySQL cannot roll back CREATE/ALTER statements, so stop right away and explain.
        console.error(`\nFailed on ${file.name}: ${error.message}`);
        console.error("Later migrations were NOT run. Check the tables in phpMyAdmin, fix the file, then run again.");
        process.exitCode = 1;
        return;
      }
      await connection.execute("INSERT INTO Qa1_migrations (name, checksum) VALUES (?, ?)", [
        file.name,
        file.checksum,
      ]);
      console.log("  done");
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
