// db.js
const { Pool } = require("pg");

// ⚠️ Mets ici TA vraie connection string Neon (celle que tu as déjà dans server.js)
const connectionString = "postgresql://neondb_owner:npg_Zlpv6sIiw3CD@ep-snowy-recipe-agbssmng-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
});

module.exports = pool;
