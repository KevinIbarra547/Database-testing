const express = require("express");

// Board feature routes (owned by Claude Code, see AGENTS.md).
// Until the board is built, /board shows a "coming soon" message so the
// header link never leads to a broken page.
const router = express.Router();

router.get("/board", (req, res) => {
  res.render("error", { title: "Board", error: "The class board is coming soon." });
});

module.exports = router;
