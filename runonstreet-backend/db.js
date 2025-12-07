// db.js
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

pool
  .connect()
  .then((client) => {
    console.log("✅ Connecté à PostgreSQL");
    client.release();
  })
  .catch((err) => {
    console.error("❌ Erreur de connexion PostgreSQL:", err.message);
  });

module.exports = { pool };
