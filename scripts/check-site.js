// End-to-end checks for the whole site: sign up, log in, questions, answers,
// ownership rules, and every board rule. Run it after every change:
//
//   1. Start the app (the Run button).
//   2. In the Shell:  npm run check
//
// It must end with "ALL PASSED" before a change is committed.
//
// TEST DATABASE ONLY. The checks create users and board posts, and board posts
// can never be deleted. The script refuses to run unless the database already
// has the sample data from `npm run seed`, which only belongs in a test database.
//
// Set BASE_URL to check a different address (default http://127.0.0.1:5000).

const { execute, missingSecrets } = require("../db");

const BASE = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 5000}`;
const run = Date.now().toString(36);
let failures = 0;

function check(name, passed, detail = "") {
  if (!passed) failures += 1;
  console.log(`${passed ? "PASS" : "FAIL"} ${name}${passed || !detail ? "" : `  (${detail})`}`);
}

// A tiny browser: remembers its login cookie and never follows redirects,
// so each check can look at exactly where the app sends it.
function client() {
  let cookie = "";
  return async (method, path, form) => {
    const response = await fetch(BASE + path, {
      method,
      redirect: "manual",
      headers: { cookie, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return { status: response.status, location: response.headers.get("location") || "", text: await response.text() };
  };
}

async function sqlValue(sql, params = []) {
  const [rows] = await execute(sql, params);
  return Object.values(rows[0])[0];
}

async function checkQuestionsAndAnswers(a, b, anon, ua) {
  check("home page loads", (await anon("GET", "/")).status === 200);
  check("duplicate username rejected", (await b("POST", "/signup", { username: ua, email: `z${ua}@example.net`, password: "password1" })).text.includes("username is already taken"));
  check("wrong password rejected", (await anon("POST", "/login", { username: ua, password: "wrong-password" })).status === 401);
  check("logged-out user can't ask", (await anon("POST", "/questions/new", { title: "t", body: "b" })).location === "/login");

  const asked = await a("POST", "/questions/new", { title: `Check question ${run}`, body: "Body" });
  check("user A asks a question", /^\/questions\/\d+$/.test(asked.location), `status ${asked.status}`);
  const questionId = asked.location.split("/").pop();
  check("home lists the new question", (await anon("GET", "/")).text.includes(`Check question ${run}`));
  check("B can't edit A's question", (await b("POST", `/questions/${questionId}/edit`, { title: "hack", body: "x" })).status === 403);
  check("A edits own question", (await a("POST", `/questions/${questionId}/edit`, { title: `Check question v2 ${run}`, body: "Body 2" })).status === 302);
  check("B answers", (await b("POST", `/questions/${questionId}/answers`, { body: `Answer ${run}` })).status === 302);
  const answerId = await sqlValue("SELECT answer_id FROM Qa1_answers WHERE question_id = ? ORDER BY answer_id DESC LIMIT 1", [questionId]);
  check("question page shows edit and answer", (await anon("GET", `/questions/${questionId}`)).text.includes(`Answer ${run}`));
  check("A can't edit B's answer", (await a("POST", `/answers/${answerId}/edit`, { body: "hack" })).status === 403);
  check("A can't delete B's answer", (await a("POST", `/answers/${answerId}/delete`)).status === 403);
  check("empty answer edit rejected", (await b("POST", `/answers/${answerId}/edit`, { body: "  " })).status === 400);
  check("B can't delete A's question", (await b("POST", `/questions/${questionId}/delete`)).status === 403);
  return questionId;
}

async function checkBoard(a, b, anon, questionId) {
  const boardRows = () => sqlValue("SELECT COUNT(*) FROM Qa1_board_posts");
  const rowsBefore = Number(await boardRows());

  check("anyone can read the board", (await anon("GET", "/board")).status === 200);
  check("logged-out user can't post", (await anon("POST", "/board/new", { title: "x", body: "y", post_type: "discussion" })).location === "/login");
  check("missing title rejected", (await a("POST", "/board/new", { title: "", body: "y", post_type: "discussion" })).status === 400);
  check("unknown post type rejected", (await a("POST", "/board/new", { title: "t", body: "y", post_type: "announcement" })).status === 400);
  check("javascript: link rejected", (await a("POST", "/board/new", { title: "t", body: "y", post_type: "resource", link_url: "javascript:alert(1)" })).status === 400);
  check("missing question number rejected", (await a("POST", "/board/new", { title: "t", body: "y", post_type: "discussion", question_id: "99999999" })).status === 400);

  const created = await a("POST", "/board/new", { title: `Board <script>x</script> ${run}`, body: "Line1\nLine2", post_type: "resource", link_url: "https://example.com/doc", question_id: questionId });
  check("A creates a board post", /^\/board\/\d+$/.test(created.location), `status ${created.status}`);
  const postId = created.location.split("/").pop();
  let page = await anon("GET", `/board/${postId}`);
  check("typed HTML is escaped", page.text.includes("&lt;script&gt;") && !page.text.includes("<script>x"));
  check("resource link and linked question shown", page.text.includes('href="https://example.com/doc"') && page.text.includes(`/questions/${questionId}`));

  const reply = await b("POST", `/board/${postId}/replies`, { body: `Reply ${run}` });
  check("B replies", reply.location.startsWith(`/board/${postId}#post-`), `status ${reply.status}`);
  const replyId = reply.location.split("#post-").pop();
  check("reply to a reply is refused", (await a("POST", `/board/${replyId}/replies`, { body: "nested" })).status === 400);

  check("B can't edit A's post", (await b("POST", `/board/${postId}/edit`, { title: "hack", body: "hack" })).status === 403);
  check("B can't delete A's post", (await b("POST", `/board/${postId}/delete`)).status === 403);
  check("B can't change A's status", (await b("POST", `/board/${postId}/status`, { status: "closed" })).status === 403);
  check("A edits once", (await a("POST", `/board/${postId}/edit`, { title: `Edited ${run}`, body: "Edited body" })).location === `/board/${postId}`);
  check("a second edit is refused", (await a("POST", `/board/${postId}/edit`, { title: "again", body: "again" })).status === 403);
  check("original text kept", String(await sqlValue("SELECT original_body FROM Qa1_board_posts WHERE post_id = ?", [postId])).startsWith("Line1"));

  check("A closes the post", (await a("POST", `/board/${postId}/status`, { status: "closed" })).location === `/board/${postId}`);
  check("closed post refuses replies", (await b("POST", `/board/${postId}/replies`, { body: "late" })).status === 400);
  await a("POST", `/board/${postId}/status`, { status: "open" });

  check("A deletes own post", (await a("POST", `/board/${postId}/delete`)).location === `/board/${postId}`);
  page = await anon("GET", `/board/${postId}`);
  check("deleted post hides its text, keeps replies", page.text.includes("deleted by its author") && !page.text.includes("Edited body") && page.text.includes(`Reply ${run}`));

  const linked = await b("POST", "/board/new", { title: `About Q ${run}`, body: "b", post_type: "discussion", question_id: questionId });
  const linkedId = linked.location.split("/").pop();
  check("A deletes own question", (await a("POST", `/questions/${questionId}/delete`)).location === "/");
  check("board post survives its question being deleted", (await anon("GET", `/board/${linkedId}`)).text.includes("was deleted"));
  check("no board rows were removed", Number(await boardRows()) === rowsBefore + 3);
}

async function main() {
  if (missingSecrets.length > 0) throw new Error(`Missing Secrets: ${missingSecrets.join(", ")}`);
  const sampleUsers = Number(await sqlValue("SELECT COUNT(*) FROM Qa1_users WHERE email LIKE ?", ["%@example.com"]));
  if (sampleUsers === 0) {
    console.log(`Refusing to run on "${process.env.DB_NAME}": it has no sample data, so it may be the real database.`);
    console.log("Point DB_NAME at a TEST database, run `npm run migrate:up` and `npm run seed`, then try again.");
    process.exitCode = 1;
    return;
  }
  try {
    await fetch(BASE);
  } catch {
    throw new Error(`The app isn't running at ${BASE}. Press Run first.`);
  }
  console.log(`Checking ${BASE} against test database "${process.env.DB_NAME}"\n`);

  const a = client();
  const b = client();
  const anon = client();
  const ua = `ca${run}`;
  const ub = `cb${run}`;
  for (const [user, name] of [[a, ua], [b, ub]]) {
    check(`sign up ${name}`, (await user("POST", "/signup", { username: name, email: `${name}@example.net`, password: "password1" })).location === "/login?created=1");
    check(`log in ${name}`, (await user("POST", "/login", { username: name, password: "password1" })).location === "/");
  }

  const questionId = await checkQuestionsAndAnswers(a, b, anon, ua);
  await checkBoard(a, b, anon, questionId);
  check("unknown page shows 404", (await anon("GET", "/no-such-page")).status === 404);
  check("log out", (await a("POST", "/logout")).location === "/");

  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exitCode = failures ? 1 : 0;
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
