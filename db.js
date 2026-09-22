const mysql = require("mysql2/promise");

// These names match the Secrets you will add in Replit.
const requiredSecrets = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"];
const missingSecrets = requiredSecrets.filter((name) => !process.env[name]);

const isConfigured = missingSecrets.length === 0;
const pool = isConfigured
  ? mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      dateStrings: true,
    })
  : null;

function getConfigurationMessage() {
  if (isConfigured) return null;
  return `Database setup is incomplete. Add these Secrets: ${missingSecrets.join(", ")}.`;
}

async function execute(sql, params = []) {
  if (!pool) {
    const error = new Error(getConfigurationMessage());
    error.code = "DB_NOT_CONFIGURED";
    throw error;
  }

  // All callers pass values separately from SQL, so user input stays parameterized.
  return pool.execute(sql, params);
}

module.exports = {
  execute,
  getConfigurationMessage,
  isConfigured,
  missingSecrets,
};