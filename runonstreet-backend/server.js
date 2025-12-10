// server.js
const express = require("express");
const cors = require("cors");

// Routes
const merchantRoutes = require("./routes/merchants"); // 🔹 ta route commerçants
const userRoutes = require("./routes/users");         // 🔹 ta route utilisateurs

// DB (pool vers Neon)
const pool = require("./db");

const app = express();
const PORT = 4000;

// Middlewares
app.use(cors());
app.use(express.json());

// Routes API
app.use("/api/merchants", merchantRoutes);
app.use("/api/users", userRoutes);

// 🌍 Endpoint pour la map : récupère les établissements depuis Neon
app.get("/establishments", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        name,
        address,
        category,
        latitude,
        longitude
      FROM establishments;
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Erreur Neon :", err);
    // En cas d'erreur, on renvoie juste un tableau vide
    res.json([]);
  }
});

// Endpoint de test
app.get("/", (req, res) => {
  res.send("API Run On Street (Neon + users) OK");
});

app.listen(PORT, () => {
  console.log(`Serveur API sur http://localhost:${PORT}`);
});
