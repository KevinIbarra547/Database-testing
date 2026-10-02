// Fills the database with sample users, questions, answers and board posts so
// you can see what the site looks like when a whole class is using it.
//
//   npm run seed            -> asks you to type the database name first
//
// IMPORTANT: run this on a TEST database, not the real one. Board posts can
// never be deleted (the no-delete trigger), and users who wrote board posts
// can't be deleted either, so sample board data is permanent.
//
// Every sample user's email ends in @example.com and their password is
// "password123", so you can log in as any of them to try things out.

const readline = require("readline/promises");
const bcrypt = require("bcrypt");
const { execute, missingSecrets, withTransaction } = require("../db");

const PASSWORD = "password123";

const USERS = ["maya_r", "jordan_k", "priya.s", "lucas_m", "ava_chen", "noah_t", "sofia_g", "eli_w", "zara_b", "sam_ortiz"];

// [asker, title, body, hours ago, [[answerer, body, hours ago], ...]]
const QUESTIONS = [
  ["maya_r", "Why does my LEFT JOIN return NULL columns?",
    "I'm joining Qa1_questions to Qa1_answers with a LEFT JOIN and some rows have NULL for every answer column. Did I write the join wrong?",
    70, [
      ["jordan_k", "Nothing is wrong! A LEFT JOIN keeps every question, even ones with no answers. For those, MySQL fills the answer columns with NULL.", 69],
      ["priya.s", "If you only want questions that HAVE answers, use an INNER JOIN (just JOIN) instead.", 66],
      ["sam_ortiz", "Good question. Try adding WHERE a.answer_id IS NULL to your LEFT JOIN: that's a classic way to find questions with no answers yet.", 60],
    ]],
  ["lucas_m", "What's the difference between VARCHAR(255) and TEXT?",
    "Our table uses VARCHAR for titles but TEXT for the body. When should I pick each one?",
    52, [
      ["ava_chen", "VARCHAR has a max length you choose and can be indexed fully. TEXT is for long content like question bodies.", 50],
      ["eli_w", "Rule of thumb: short things you search or sort by → VARCHAR. Long paragraphs → TEXT.", 47],
    ]],
  ["ava_chen", "How does bcrypt know my password is right if it's hashed?",
    "If the database only stores a hash, how does bcrypt.compare check my password at login?",
    45, [
      ["noah_t", "The hash includes a random 'salt'. bcrypt.compare hashes what you typed with the same salt and checks if the results match. It never 'unhashes'.", 44],
    ]],
  ["noah_t", "Why do we use ? placeholders instead of putting values in the SQL string?",
    "It seems easier to just do \"SELECT * FROM users WHERE Uname = '\" + name + \"'\". Why does the spec forbid that?",
    40, [
      ["sofia_g", "Because of SQL injection. If someone types ' OR '1'='1 as their name, the string version would return every user.", 39],
      ["maya_r", "Placeholders send the value separately, so MySQL treats it as data, never as SQL code.", 37],
      ["jordan_k", "This is literally the #1 web security bug, so it's worth getting used to.", 30],
    ]],
  ["sofia_g", "What does ON DELETE CASCADE actually do?",
    "When I deleted a test question in phpMyAdmin, its answers vanished too. Is that the CASCADE thing?",
    33, [
      ["priya.s", "Yes. The foreign key from Qa1_answers to Qa1_questions says ON DELETE CASCADE, so deleting a question deletes its answers automatically.", 31],
    ]],
  ["eli_w", "Can someone explain GROUP BY with COUNT?",
    "The home page query uses COUNT(a.answer_id) and GROUP BY. I don't get why GROUP BY is needed.",
    26, [
      ["lucas_m", "Without GROUP BY, COUNT squashes everything into one row. GROUP BY q.question_id gives you one row (and one count) per question.", 24],
      ["sam_ortiz", "Try running it without GROUP BY in phpMyAdmin and compare. Seeing the difference makes it click.", 20],
    ]],
  ["zara_b", "Why did my Replit app say 'Database setup is incomplete'?",
    "I forked the project and the home page just shows the setup screen.",
    18, [
      ["jordan_k", "Your fork doesn't have the Secrets. Add DB_HOST, DB_PORT, DB_USER, DB_PASSWORD and DB_NAME in the Secrets tab, then restart.", 17],
    ]],
  ["priya.s", "What is a transaction and when do I need one?", "I saw withTransaction in db.js. When should I use it instead of execute?",
    12, []],
  ["jordan_k", "Is it bad to store dates as strings?", "Could we just save created_at as VARCHAR like '2026-10-01'?",
    6, [
      ["ava_chen", "You lose date math and correct sorting. DATETIME lets MySQL do things like DATE_SUB(NOW(), INTERVAL 7 DAY).", 5],
    ]],
  ["maya_r", "How do I see which migrations have been applied?", "I ran migrate:up but I'm not sure it worked.",
    2, []],
];

// Board posts. linkTo = index into QUESTIONS; deletedLink = simulate a deleted linked question.
const BOARD = [
  { by: "maya_r", type: "study_group", title: "Study group for the JOINs quiz", hoursAgo: 30, eventInDays: 2,
    body: "Library room 2, after school. Bring your laptop and the JOIN practice sheet.",
    replies: [["jordan_k", "I'm in!", 29], ["ava_chen", "Can we also go over GROUP BY?", 28], ["maya_r", "Yes, let's do both.", 27]] },
  { by: "ava_chen", type: "resource", title: "Great visual guide to SQL JOINs", hoursAgo: 48, link: "https://dev.mysql.com/doc/refman/8.0/en/join.html",
    body: "The official MySQL docs page on JOIN syntax. The examples near the bottom helped me a lot.",
    replies: [["noah_t", "Bookmarked, thanks!", 46]] },
  { by: "noah_t", type: "discussion", title: "Discussing: Why do we use ? placeholders?", hoursAgo: 38, linkTo: 3,
    body: "I read the answers but I want to try an actual SQL injection on a test database to see it happen. Anyone want to try it together?",
    replies: [["sofia_g", "Only on a copy of the database!", 37], ["sam_ortiz", "Great idea for a demo. Use a throwaway database, never the class one.", 35]] },
  { by: "lucas_m", type: "discussion", title: "Which feature should the class build next?", hoursAgo: 20, status: "resolved",
    body: "Votes? Tags? Profiles? Post your favorite.",
    original: ["Next feature?", "What should we build next?"],
    replies: [["zara_b", "Profiles!", 19], ["eli_w", "Votes on answers.", 18], ["lucas_m", "Thanks all, we picked the board!", 10]] },
  { by: "sofia_g", type: "resource", title: "phpMyAdmin keyboard shortcuts", hoursAgo: 15, link: "https://docs.phpmyadmin.net/en/latest/",
    body: "Ctrl+Enter runs the query in the SQL tab. Saves a lot of clicking.", replies: [] },
  { by: "eli_w", type: "discussion", title: "Discussing: an old question about indexes", hoursAgo: 14, deletedLink: "When should I add an index?",
    body: "The original question got deleted, but I still think indexes are worth talking about. Anyone know how EXPLAIN works?",
    replies: [["priya.s", "EXPLAIN shows whether MySQL uses an index. Try it on the home page query!", 13]] },
  { by: "zara_b", type: "discussion", title: "Oops, posted this twice", hoursAgo: 9, deleted: true,
    body: "Duplicate of the study group post.", replies: [["maya_r", "No worries, see the study group post above.", 8]] },
  { by: "jordan_k", type: "study_group", title: "Weekend review session (online)", hoursAgo: 5, eventInDays: 4, status: "closed",
    body: "Full for this week, sorry! I'll post another one next week.",
    replies: [["priya.s", "Can I join?", 4.5], ["jordan_k", "We're full, closing this one.", 4]] },
  { by: "priya.s", type: "discussion", title: "Tips for writing good questions", hoursAgo: 3,
    body: "Include the exact error, what you tried, and the SQL you ran. It makes answering way faster.",
    replies: [["sam_ortiz", "Agreed. Also say what you EXPECTED to happen.", 2.5, { deleted: false, original: "Agreed." }],
      ["noah_t", "This reply was a mistake.", 2, { deleted: true }]] },
];

async function confirm() {
  if (process.argv.includes("--yes")) return true;
  console.log(`Database: ${process.env.DB_NAME} on ${process.env.DB_HOST}\n`);
  console.log("This adds sample users and posts. Board posts can NEVER be deleted, and");
  console.log("users with board posts can't be deleted. Use a TEST database, not the real one.\n");
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(`Type the database name (${process.env.DB_NAME}) to add sample data: `);
  prompt.close();
  return answer.trim() === process.env.DB_NAME;
}

async function main() {
  if (missingSecrets.length > 0) throw new Error(`Missing Secrets: ${missingSecrets.join(", ")}`);

  // Refuse to run twice, and make sure the board migration has been applied.
  const [existing] = await execute("SELECT COUNT(*) AS n FROM Qa1_users WHERE email LIKE ?", ["%@example.com"]);
  if (existing[0].n > 0) {
    console.log("Sample data is already in this database. Nothing was added.");
    return;
  }
  const [boardTable] = await execute("SHOW TABLES LIKE 'Qa1_board_posts'");
  if (boardTable.length === 0) throw new Error("Run `npm run migrate:up` first; the board table is missing.");

  if (!(await confirm())) {
    console.log("Cancelled. Nothing was changed.");
    return;
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  // One transaction: either all the sample data is added, or none of it.
  await withTransaction(async (connection) => {
    const userIds = {};
    for (const [index, name] of USERS.entries()) {
      const [result] = await connection.execute(
        "INSERT INTO Qa1_users (Uname, password, email, register) VALUES (?, ?, ?, DATE_SUB(NOW(), INTERVAL ? DAY))",
        [name, passwordHash, `${name.replace(".", "_")}@example.com`, 21 - index],
      );
      userIds[name] = result.insertId;
    }

    const questionIds = [];
    for (const [asker, title, body, hoursAgo, answers] of QUESTIONS) {
      const [result] = await connection.execute(
        "INSERT INTO Qa1_questions (uid_user, title, body, created_at) VALUES (?, ?, ?, DATE_SUB(NOW(), INTERVAL ? MINUTE))",
        [userIds[asker], title, body, Math.round(hoursAgo * 60)],
      );
      questionIds.push({ id: result.insertId, title });
      for (const [answerer, answerBody, answerHoursAgo] of answers) {
        await connection.execute(
          "INSERT INTO Qa1_answers (question_id, uid_user, body, created_at) VALUES (?, ?, ?, DATE_SUB(NOW(), INTERVAL ? MINUTE))",
          [result.insertId, userIds[answerer], answerBody, Math.round(answerHoursAgo * 60)],
        );
      }
    }

    for (const post of BOARD) {
      const linked = post.linkTo !== undefined ? questionIds[post.linkTo] : null;
      const [result] = await connection.execute(
        `INSERT INTO Qa1_board_posts
           (uid_user, question_id, linked_question_title, post_type, status, title, body,
            original_title, original_body, edit_count, link_url, event_at, created_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 IF(? IS NULL, NULL, DATE_ADD(CURDATE(), INTERVAL ? DAY) + INTERVAL 15 HOUR + INTERVAL 30 MINUTE),
                 DATE_SUB(NOW(), INTERVAL ? MINUTE), IF(?, NOW(), NULL))`,
        [
          userIds[post.by],
          linked ? linked.id : null,
          linked ? linked.title : post.deletedLink || null,
          post.type,
          post.status || "open",
          post.title,
          post.body,
          post.original ? post.original[0] : null,
          post.original ? post.original[1] : null,
          post.original ? 1 : 0,
          post.link || null,
          post.eventInDays ?? null,
          post.eventInDays ?? 0,
          Math.round(post.hoursAgo * 60),
          post.deleted ? 1 : 0,
        ],
      );
      for (const [author, body, hoursAgo, extra = {}] of post.replies) {
        await connection.execute(
          `INSERT INTO Qa1_board_posts
             (uid_user, parent_id, post_type, status, body, original_body, edit_count, created_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL ? MINUTE), IF(?, NOW(), NULL))`,
          [
            userIds[author],
            result.insertId,
            post.type,
            post.status || "open",
            body,
            extra.original || null,
            extra.original ? 1 : 0,
            Math.round(hoursAgo * 60),
            extra.deleted ? 1 : 0,
          ],
        );
      }
    }
  });

  console.log(`Added ${USERS.length} users, ${QUESTIONS.length} questions and ${BOARD.length} board posts.`);
  console.log(`Log in as any of them (for example "maya_r") with the password "${PASSWORD}".`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
