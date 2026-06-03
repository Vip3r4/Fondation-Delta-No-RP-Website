require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const isStaff = require("./middleware/isStaff");
const isLinked = require("./middleware/isLinked");
const auth = require("./middleware/auth");
const pool = require("./config/db");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: "https://sitedeltadarkrp.fr",
    methods: ["GET", "POST", "PATCH", "DELETE"],
    credentials: true,
  })
);

app.use(express.json());

let cache = { data: null, lastUpdated: 0 };

/* ------- AFFICHAGE JOUEUR EN JEU INDEX --------------- */
app.get("/api/server-info", async (req, res) => {
  const now = Date.now();

  if (cache.data && now - cache.lastUpdated < 30000) {
    return res.json(cache.data);
  }

  try {
    const id = process.env.SCPSL_ID;
    const key = process.env.SCPSL_KEY;
    const response = await fetch(
      `https://api.scpslgame.com/serverinfo.php?id=${id}&key=${key}&players=true`
    );

    if (!response.ok) throw new Error("Erreur API SCP");

    const data = await response.json();
    cache.data = data;
    cache.lastUpdated = now;

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* ---------------- STATS JOUEURS ---------------- */
app.post("/api/game/stats", async (req, res) => {
  const raw_steam_id = req.body.steam_id;
  if (!raw_steam_id) return res.status(400).json({ error: "No ID" });

  const steam_id = raw_steam_id.split("@")[0];
  const { action } = req.body;
  const STEAM_API_KEY = process.env.apiKey;

  try {
    const steamRes = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steam_id}`
    );
    const steamData = await steamRes.json();
    const playerInfo = steamData.response.players[0] || {};

    const username = playerInfo.personaname || "Joueur Inconnu";
    const avatar = playerInfo.avatarfull || "images/logo (1).svg";

    const column = action === "kill" ? "kills" : "deaths";

    const query = `
      INSERT INTO users (steam_id, steam_username, steam_avatar, ${column}) 
      VALUES ($1, $2, $3, 1)
      ON CONFLICT (steam_id) 
      DO UPDATE SET 
        ${column} = users.${column} + 1,
        steam_username = EXCLUDED.steam_username,
        steam_avatar = EXCLUDED.steam_avatar
    `;

    await pool.query(query, [steam_id, username, avatar]);
    res.json({ success: true });
  } catch (error) {
    console.error("ERREUR STATS:", error);
    res.status(500).json({ error: "Erreur serveur", details: error.message });
  }
});

app.post("/api/game/time", async (req, res) => {
  const { steam_id, minutes } = req.body;

  if (!steam_id || !minutes) {
    return res.status(400).json({ error: "Données invalides" });
  }

  try {
    const cleanSteamId = String(steam_id).split("@")[0];

    const existingUser = await pool.query(
      "SELECT steam_username FROM users WHERE steam_id = $1",
      [cleanSteamId]
    );

    if (existingUser.rows.length > 0) {
      await pool.query(
        "UPDATE users SET play_time = COALESCE(play_time, 0) + $1 WHERE steam_id = $2",
        [minutes, cleanSteamId]
      );
    } else {
      await pool.query(
        `INSERT INTO users (steam_id, steam_username, steam_avatar, play_time) 
         VALUES ($1, 'Joueur En Jeu', 'images/logo (1).svg', $2)`,
        [cleanSteamId, minutes]
      );
    }

    res.json({ success: true, message: "Temps de jeu mis à jour." });
  } catch (error) {
    console.error("Erreur SQL Time:", error.message);
    res.status(500).json({ error: "Erreur temps de jeu" });
  }
});

app.post("/api/game/badge", async (req, res) => {
  const { steam_id, badge } = req.body;

  if (!steam_id) {
    return res.status(400).json({ error: "steam_id requis" });
  }

  try {
    await pool.query(
      "UPDATE users SET current_in_game_badge = $1 WHERE steam_id = $2",
      [badge || null, steam_id]
    );
    res.json({ success: true });
  } catch (error) {
    console.error("Erreur badge:", error.message);
    res.status(500).json({ error: "Erreur mise à jour badge" });
  }
});

/* ------------- LEADERBOARD -------------- */
app.get("/api/leaderboard/kills", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        steam_id, 
        steam_username, 
        steam_avatar,
        kills, 
        deaths, 
        COALESCE(ROUND(play_time::numeric / 60, 1), 0) as play_time_hours, 
        ROUND(COALESCE(kills, 0)::numeric / GREATEST(COALESCE(deaths, 0), 1), 2) as kda
      FROM users
      WHERE steam_id IS NOT NULL AND steam_id <> ''
      ORDER BY COALESCE(kills, 0) DESC 
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Erreur leaderboard kills:", error.message);
    res.status(500).json({ error: "Erreur leaderboard kills" });
  }
});

app.get("/api/leaderboard/time", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        steam_id, 
        steam_username, 
        steam_avatar,
        kills, 
        deaths, 
        COALESCE(ROUND(play_time::numeric / 60, 1), 0) as play_time_hours, 
        ROUND(COALESCE(kills, 0)::numeric / GREATEST(COALESCE(deaths, 0), 1), 2) as kda
      FROM users
      WHERE steam_id IS NOT NULL AND steam_id <> ''
      ORDER BY COALESCE(play_time, 0) DESC 
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Erreur leaderboard time:", error.message);
    res.status(500).json({ error: "Erreur leaderboard temps" });
  }
});

/* ---------------------- PROFIL --------------------- */
app.get("/api/profile/:steamid", async (req, res) => {
  const { steamid } = req.params;

  try {
    const userResult = await pool.query(
      `
      SELECT 
        steam_id, 
        steam_username,
        discord_username,
        steam_avatar,
        kills, 
        deaths, 
        COALESCE(ROUND(play_time::numeric / 60, 1), 0) as play_time_hours, 
        ROUND(COALESCE(kills, 0)::numeric / GREATEST(COALESCE(deaths, 0), 1), 2) as kda,
        current_in_game_badge,
        discord_roles,
        is_banned
      FROM users
      WHERE steam_id = $1
    `,
      [steamid]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "Joueur non trouvé" });
    }

    const warnsResult = await pool.query(
      `
      SELECT 
        id,
        type,
        reason,
        moderator_name,
        duration_minutes,
        created_at,
        expires_at,
        is_active
      FROM warns_bans
      WHERE steamid = $1
      ORDER BY created_at DESC
    `,
      [steamid]
    );

    res.json({
      success: true,
      profile: {
        ...userResult.rows[0],
        warns: warnsResult.rows.filter((w) => w.type === "warn"),
        bans: warnsResult.rows.filter((w) => w.type === "ban"),
      },
    });
  } catch (error) {
    console.error("Erreur profil:", error.message);
    res.status(500).json({ error: "Erreur profil joueur" });
  }
});

/* ----------------- DISCORD LINK --------------------- */
app.post("/api/link/generate-code", async (req, res) => {
  const { discord_id, discord_username } = req.body;

  if (!discord_id || !discord_username) {
    return res.status(400).json({ error: "Discord ID et username requis" });
  }

  try {
    await pool.query(
      "DELETE FROM link_codes WHERE discord_id = $1 AND is_used = FALSE",
      [discord_id]
    );

    const code = crypto.randomBytes(3).toString("hex").toUpperCase();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `INSERT INTO link_codes (code, discord_id, discord_username, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [code, discord_id, discord_username, expires_at]
    );

    res.json({ success: true, code, expires_at });
  } catch (error) {
    console.error("Erreur génération code:", error.message);
    res.status(500).json({ error: "Erreur lors de la génération" });
  }
});

app.get("/api/link/check-status", async (req, res) => {
  const { discord_id } = req.query;

  if (!discord_id) {
    return res.status(400).json({ error: "Discord ID requis" });
  }

  try {
    const result = await pool.query(
      `SELECT lc.is_used, lc.steam_id, u.discord_username, u.steam_avatar
       FROM link_codes lc
       LEFT JOIN users u ON u.steam_id = lc.steam_id
       WHERE lc.discord_id = $1 AND lc.is_used = TRUE
       ORDER BY lc.created_at DESC LIMIT 1`,
      [discord_id]
    );

    if (result.rows.length > 0) {
      await pool.query("DELETE FROM link_codes WHERE discord_id = $1", [
        discord_id,
      ]);
      return res.json({
        success: true,
        linked: true,
        steam_id: result.rows[0].steam_id,
        user: result.rows[0],
      });
    }

    res.json({ success: true, linked: false });
  } catch (error) {
    console.error("Erreur check-status:", error.message);
    res.status(500).json({ error: "Erreur lors de la vérification" });
  }
});

app.post("/api/link/verify-code", async (req, res) => {
  const { code, steam_id } = req.body;

  if (!code || !steam_id) {
    return res.status(400).json({ error: "Code et SteamID requis" });
  }

  const cleanSteamId = steam_id.split("@")[0];

  try {
    const codeResult = await pool.query(
      `SELECT discord_id, discord_username, expires_at, is_used
       FROM link_codes
       WHERE code = $1`,
      [code]
    );

    if (codeResult.rows.length === 0) {
      return res.status(404).json({ error: "Code invalide" });
    }

    const link = codeResult.rows[0];

    if (link.is_used) {
      return res.status(400).json({ error: "Code déjà utilisé" });
    }

    if (new Date() > link.expires_at) {
      return res.status(400).json({ error: "Code expiré" });
    }

    const existingUser = await pool.query(
      "SELECT steam_id FROM users WHERE steam_id = $1",
      [cleanSteamId]
    );

    if (existingUser.rows.length === 0) {
      const steamRes = await fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${process.env.apiKey}&steamids=${cleanSteamId}`
      );
      const steamData = await steamRes.json();
      const playerInfo = steamData.response.players[0] || {};

      await pool.query(
        `INSERT INTO users (steam_id, discord_id, discord_username, steam_avatar, kills, deaths, play_time)
         VALUES ($1, $2, $3, $4, 0, 0, 0)`,
        [
          cleanSteamId,
          link.discord_id,
          link.discord_username,
          playerInfo.avatarfull || "",
        ]
      );
    } else {
      await pool.query(
        "UPDATE users SET discord_id = $1, discord_username = $2 WHERE steam_id = $3",
        [link.discord_id, link.discord_username, cleanSteamId]
      );
    }

    await pool.query(
      `UPDATE link_codes SET is_used = TRUE, steam_id = $1 WHERE code = $2`,
      [cleanSteamId, code]
    );

    res.json({ success: true, message: "Comptes liés avec succès" });
  } catch (error) {
    console.error("Erreur vérification code:", error.message);
    res.status(500).json({ error: "Erreur lors de la liaison" });
  }
});

/* ----------------- STAFF ROUTES ----------------- */
app.get("/api/staff/players", auth, isStaff, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT steam_id, steam_username, kills, deaths, play_time
      FROM users
      WHERE steam_id IS NOT NULL AND steam_id <> ''
      ORDER BY steam_username
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Erreur" });
  }
});

app.post("/api/staff/warn", auth, isStaff, async (req, res) => {
  const { steam_id, reason, duration_minutes } = req.body;
  const expires_at = duration_minutes ? new Date(Date.now() + duration_minutes * 60000) : null;

  try {
    await pool.query(
      `INSERT INTO warns_bans (steamid, type, reason, moderator_name, duration_minutes, expires_at)
       VALUES ($1, 'warn', $2, $3, $4, $5)`,
      [steam_id, reason, req.user.discord_username, duration_minutes, expires_at]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Erreur" });
  }
});

app.post("/api/staff/ban", auth, isStaff, async (req, res) => {
  const { steam_id, reason, duration_minutes } = req.body;
  const expires_at = duration_minutes ? new Date(Date.now() + duration_minutes * 60000) : null;

  try {
    await pool.query(
      `INSERT INTO warns_bans (steamid, type, reason, moderator_name, duration_minutes, expires_at, is_active)
       VALUES ($1, 'ban', $2, $3, $4, $5, true)`,
      [steam_id, reason, req.user.discord_username, duration_minutes, expires_at]
    );
    await pool.query("UPDATE users SET is_banned = true WHERE steam_id = $1", [steam_id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Erreur" });
  }
});

/* ----------------- DISCORD OAUTH ----------------- */
const axios = require("axios");
const jwt = require("jsonwebtoken");

app.get("/auth/discord", (req, res) => {
  const url = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${process.env.DISCORD_REDIRECT_URI}&response_type=code&scope=identify`;
  res.redirect(url);
});

app.get("/auth/discord/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send("Code manquant");
  }

  try {
    const tokenResponse = await axios.post("https://discord.com/api/oauth2/token", 
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
      }), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      }
    );

    const { access_token } = tokenResponse.data;

    const userResponse = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const { id, username, avatar } = userResponse.data;

    let isStaff = false;
    try {
      const guildsResponse = await axios.get("https://discord.com/api/users/@me/guilds", {
        headers: { Authorization: `Bearer ${access_token}` }
      });
      const guild = guildsResponse.data.find(g => g.id === process.env.DISCORD_GUILD_ID);
      if (guild) {
        const memberResponse = await axios.get(`https://discord.com/api/guilds/${process.env.DISCORD_GUILD_ID}/members/${id}`, {
          headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` }
        });
        isStaff = memberResponse.data.roles.includes(process.env.DISCORD_STAFF_ROLE_ID);
      }
    } catch (err) {
      console.error("Erreur vérification staff:", err.message);
    }

    const token = jwt.sign(
      { discord_id: id, discord_username: username, avatar: avatar, isStaff: isStaff },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.redirect(`https://sitedeltadarkrp.fr/dashboard.html?token=${token}`);
  } catch (error) {
    console.error("Erreur OAuth:", error.message);
    res.status(500).send("Erreur lors de l'authentification");
  }
});

app.get("/api/me", auth, async (req, res) => {
  try {
    const user = await pool.query(
      "SELECT steam_id FROM users WHERE discord_id = $1",
      [req.user.discord_id]
    );
    
    res.json({
      discord_id: req.user.discord_id,
      discord_username: req.user.discord_username,
      avatar: req.user.avatar,
      isStaff: req.user.isStaff || false,
      steam_id: user.rows[0]?.steam_id || null
    });
  } catch (error) {
    console.error("Erreur /api/me:", error.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* ----------------- APP LISTEN --------------------- */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Serveur lancé sur : http://0.0.0.0:${PORT}`);
});