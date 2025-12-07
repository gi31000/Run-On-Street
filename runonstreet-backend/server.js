// server.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { Pool } = require("pg");
const { distanceInMeters } = require("./geo");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Connexion DB
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool
  .connect()
  .then(() => console.log("✅ Connecté à PostgreSQL"))
  .catch((err) =>
    console.error("❌ Erreur de connexion PostgreSQL:", err.message)
  );

// ======================
// ✅ ROUTE HEALTH
// ======================
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "ok" });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: err.message,
    });
  }
});

// ======================
// ✅ ROUTE OFFRES PROCHES
// ======================
app.get("/api/offers/nearby", async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radius = parseInt(req.query.radius, 10) || 2000;

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({
        error: "Paramètres lat et lng obligatoires.",
      });
    }

    const result = await pool.query(
      `SELECT 
        id,
        title,
        description,
        category,
        latitude,
        longitude,
        duration_seconds AS "durationSeconds",
        reward_text AS "rewardText",
        city,
        created_at AS "createdAt"
      FROM offers
      WHERE is_active = TRUE;`
    );

    const nearby = (result.rows || [])
      .map((offer) => {
        const distanceMeters = distanceInMeters(
          lat,
          lng,
          offer.latitude,
          offer.longitude
        );
        return {
          ...offer,
          distanceMeters: Math.round(distanceMeters),
        };
      })
      // 🔥 filtre désactivé pour debug (tu pourras le remettre)
      // .filter((offer) => offer.distanceMeters <= radius)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);

    console.log("✅ OFFERS SENT TO CLIENT:", nearby.length);

    res.json({
      count: nearby.length,
      offers: nearby,
    });
  } catch (err) {
    console.error("❌ Erreur /api/offers/nearby :", err);
    res.status(500).json({
      error: "Erreur récupération offres.",
    });
  }
});

// ======================
// ✅ ENREGISTRER UN DÉFI TERMINÉ (avec userId + anti-fraude)
// ======================
app.post("/api/challenges/complete", async (req, res) => {
  try {
    const {
      offerId,
      userId,         // 👈 maintenant accepté
      startedAt,
      completedAt,
      success,
      distanceMeters,
      qrCode,
    } = req.body;

    if (!offerId || !startedAt) {
      return res.status(400).json({
        error: "offerId et startedAt sont obligatoires.",
      });
    }

    const startDate = new Date(startedAt);
    const completeDate = completedAt ? new Date(completedAt) : null;

    // 🔎 ANTI-FRAUDE
    let suspectedFraud = false;
    let fraudReason = null;

    if (success === true) {
      const durMs = completeDate ? completeDate - startDate : null;
      const durSec = durMs != null ? durMs / 1000 : null;

      // Règle 1 : trop loin pour être crédible
      if (distanceMeters != null && distanceMeters > 2000) {
        suspectedFraud = true;
        fraudReason = "distance > 2km pour un défi réussi";
      }
      // Règle 2 : trop rapide pour être humain
      else if (durSec != null && durSec < 5) {
        suspectedFraud = true;
        fraudReason = "défi réussi en moins de 5 secondes";
      }
      // Règle 3 : déplacement trop rapide (800m en moins de 30s)
      else if (
        distanceMeters != null &&
        distanceMeters > 800 &&
        durSec != null &&
        durSec < 30
      ) {
        suspectedFraud = true;
        fraudReason =
          "déplacement trop rapide (distance > 800m en < 30s)";
      }
    }

    const result = await pool.query(
      `INSERT INTO challenge_runs
        (offer_id,
         user_id,
         started_at,
         completed_at,
         success,
         distance_meters,
         qr_code,
         suspected_fraud,
         fraud_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        offerId,
        userId ?? null,
        startDate,
        completeDate,
        success === true,
        distanceMeters ?? null,
        qrCode ?? null,
        suspectedFraud,
        fraudReason,
      ]
    );

    console.log("✅ CHALLENGE RUN SAVED:", result.rows[0]);

    res.status(201).json({
      status: "ok",
      run: result.rows[0],
    });
  } catch (err) {
    console.error("❌ Erreur /api/challenges/complete :", err);
    res.status(500).json({
      error: "Erreur enregistrement défi.",
    });
  }
});


// ======================
// ✅ VALIDATION COMMERÇANT PAR QR CODE
// ======================
app.post("/api/challenges/validate", async (req, res) => {
  try {
    const { qrCode } = req.body;

    if (!qrCode) {
      return res.status(400).json({ error: "qrCode obligatoire." });
    }

    const result = await pool.query(
      `UPDATE challenge_runs
       SET validated_at = NOW()
       WHERE qr_code = $1
         AND success = TRUE
         AND validated_at IS NULL
       RETURNING *`,
      [qrCode]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error:
          "Aucun challenge à valider trouvé pour ce code (déjà utilisé ou invalide).",
      });
    }

    console.log(
      "✅ CHALLENGE VALIDATED BY MERCHANT:",
      result.rows[0].id
    );

    res.json({
      status: "ok",
      run: result.rows[0],
    });
  } catch (err) {
    console.error("❌ Erreur /api/challenges/validate :", err);
    res.status(500).json({ error: "Erreur validation commerçant." });
  }
});

// ======================
// ✅ CRÉER / METTRE À JOUR UN USER
// ======================
app.post("/api/users", async (req, res) => {
  try {
    const { userId, pseudo } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId obligatoire." });
    }

    const result = await pool.query(
      `INSERT INTO users (id, pseudo)
       VALUES ($1, $2)
       ON CONFLICT (id)
       DO UPDATE SET pseudo = EXCLUDED.pseudo
       RETURNING *`,
      [userId, pseudo ?? null]
    );

    res.json({ status: "ok", user: result.rows[0] });
  } catch (err) {
    console.error("❌ Erreur /api/users :", err);
    res.status(500).json({ error: "Erreur user." });
  }
});


// ======================
// ✅ STATS PAR OFFRE (côté commerce / admin)
// ======================
app.get("/api/stats/offers/:offerId", async (req, res) => {
  try {
    const offerId = parseInt(req.params.offerId, 10);
    if (Number.isNaN(offerId)) {
      return res.status(400).json({ error: "offerId invalide." });
    }

    const result = await pool.query(
      `SELECT
        offer_id,
        COUNT(*) AS total_runs,
        COUNT(*) FILTER (WHERE success) AS total_success,
        COUNT(*) FILTER (WHERE success AND validated_at IS NOT NULL) AS total_validated,
        MIN(started_at) AS first_run_at,
        MAX(created_at) AS last_run_at
       FROM challenge_runs
       WHERE offer_id = $1
       GROUP BY offer_id`,
      [offerId]
    );

    if (result.rows.length === 0) {
      return res.json({
        offerId,
        total_runs: 0,
        total_success: 0,
        total_validated: 0,
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ Erreur /api/stats/offers/:offerId :", err);
    res.status(500).json({ error: "Erreur stats offre." });
  }
});

// ======================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend lancé sur http://0.0.0.0:${PORT}`);
});
