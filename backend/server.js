require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const isStaff = require("./middleware/isStaff");
const isLinked = require("./middleware/isLinked");
const auth = require("./middleware/auth");
const pool = require("./config/db");

const app = express();
const PORT = process.env.PORT || 5000;

const API_KEYS = process.env.API_KEYS ? process.env.API_KEYS.split(',') : [];

function validateApiKey(req, res, next) {
    const gameToken = req.headers['x-game-token'];
    if (gameToken && gameToken === process.env.GAME_API_TOKEN) {
        return next();
    }
    
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || !API_KEYS.includes(apiKey)) {
        return res.status(401).json({ 
            error: 'API key required',
            message: 'Cette clé API est invalide ou manquante'
        });
    }
    next();
}

function blockEndpointDiscovery(req, res, next) {
    const suspiciousPatterns = [
        /\.\.\//,
        /\/api\/v\d/,
        /\/admin/,
        /\/\.env/,
        /\/config/,
        /\/swagger/,
        /\/docs/,
        /\/_/,
        /\/server\.js/,
        /\/app\.js/,
    ];
    
    if (suspiciousPatterns.some(p => p.test(req.path))) {
        console.warn(`⚠️ Suspicious request: ${req.ip} - ${req.method} ${req.path}`);
        return res.status(404).json({ error: 'Not found' });
    }
    next();
}

// ========== SÉCURITÉ ==========

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https://avatars.steamstatic.com", "https://cdn.discordapp.com"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
        },
    },
}));

app.use(blockEndpointDiscovery);

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : "https://sitedeltadarkrp.fr",
    methods: ["GET", "POST"],
    credentials: true,
  })
);

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Trop de requêtes, veuillez réessayer plus tard.",
    standardHeaders: true,
    legacyHeaders: false,
});
app.use("/api/", globalLimiter);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: "Trop de tentatives, veuillez réessayer dans 15 minutes.",
});

const strictLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 20, // 20 requêtes max
    message: "Trop de requêtes, ralentissez.",
});

app.use("/api/link/generate-code", authLimiter);
app.use("/api/link/verify-code", authLimiter);
app.use("/api/link/check-status", authLimiter);

// ========== NOUVEAU : Rate limit pour les endpoints publics ==========
const publicLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: "Trop de requêtes, réessayez dans une minute.",
});
app.use("/api/leaderboard", publicLimiter);
app.use("/api/profile", publicLimiter);
app.use("/api/server-info", publicLimiter);

function sanitizeString(str) {
    if (!str || typeof str !== "string") return "";
    return str.replace(/[<>'"&]/g, (m) => {
        if (m === "<") return "&lt;";
        if (m === ">") return "&gt;";
        if (m === "'") return "&#39;";
        if (m === '"') return "&quot;";
        if (m === "&") return "&amp;";
        return m;
    });
}

function validateSteamId(steamId) {
    if (!steamId || typeof steamId !== "string") return null;
    const clean = steamId.split("@")[0];
    if (!/^\d{17}$/.test(clean)) return null;
    return clean;
}

app.use(express.json({ limit: "10kb" }));

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

app.post("/api/game/stats", validateApiKey, async (req, res) => {

  const gameToken = req.headers['x-game-token'];
  if (gameToken !== process.env.GAME_API_TOKEN) {
    return res.status(401).json({ error: "Token invalide" });
  }
  
  const raw_steam_id = req.body.steam_id;
  if (!raw_steam_id) return res.status(400).json({ error: "No ID" });

  const steam_id = validateSteamId(raw_steam_id);
  if (!steam_id) return res.status(400).json({ error: "Steam ID invalide" });

  const { action } = req.body;
  if (action !== "kill" && action !== "death") {
    return res.status(400).json({ error: "Action invalide" });
  }

  const STEAM_API_KEY = process.env.apiKey;

  try {
    const steamRes = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steam_id}`
    );
    const steamData = await steamRes.json();
    const playerInfo = steamData.response.players[0] || {};

    const username = sanitizeString(playerInfo.personaname) || "Joueur Inconnu";
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

app.post("/api/game/time", validateApiKey, async (req, res) => {

  const gameToken = req.headers['x-game-token'];
  if (gameToken !== process.env.GAME_API_TOKEN) {
    return res.status(401).json({ error: "Token invalide" });
  }
  
  const { steam_id, minutes } = req.body;

  if (!steam_id || !minutes) {
    return res.status(400).json({ error: "Données invalides" });
  }

  const cleanSteamId = validateSteamId(steam_id);
  if (!cleanSteamId) return res.status(400).json({ error: "Steam ID invalide" });

  const timeMinutes = parseInt(minutes);
  if (isNaN(timeMinutes) || timeMinutes <= 0 || timeMinutes > 60) {
    return res.status(400).json({ error: "Minutes invalides" });
  }

  try {
    const existingUser = await pool.query(
      "SELECT steam_username FROM users WHERE steam_id = $1",
      [cleanSteamId]
    );

    if (existingUser.rows.length > 0) {
      await pool.query(
        "UPDATE users SET play_time = COALESCE(play_time, 0) + $1 WHERE steam_id = $2",
        [timeMinutes, cleanSteamId]
      );
    } else {
      await pool.query(
        `INSERT INTO users (steam_id, steam_username, steam_avatar, play_time) 
         VALUES ($1, 'Joueur En Jeu', 'images/logo (1).svg', $2)`,
        [cleanSteamId, timeMinutes]
      );
    }

    res.json({ success: true, message: "Temps de jeu mis à jour." });
  } catch (error) {
    console.error("Erreur SQL Time:", error.message);
    res.status(500).json({ error: "Erreur temps de jeu" });
  }
});

app.post("/api/game/badge", validateApiKey, async (req, res) => {

  const gameToken = req.headers['x-game-token'];
  if (gameToken !== process.env.GAME_API_TOKEN) {
    return res.status(401).json({ error: "Token invalide" });
  }
  
  const { steam_id, badge } = req.body;

  if (!steam_id) {
    return res.status(400).json({ error: "steam_id requis" });
  }

  const cleanSteamId = validateSteamId(steam_id);
  if (!cleanSteamId) return res.status(400).json({ error: "Steam ID invalide" });

  const cleanBadge = badge ? sanitizeString(badge).substring(0, 50) : null;

  try {
    await pool.query(
      "UPDATE users SET current_in_game_badge = $1 WHERE steam_id = $2",
      [cleanBadge, cleanSteamId]
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
  let { steamid } = req.params;

  const cleanSteamId = validateSteamId(steamid);
  if (!cleanSteamId) {
    return res.status(400).json({ error: "Steam ID invalide" });
  }

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
      [cleanSteamId]
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
      [cleanSteamId]
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

app.get("/api/profile/me", auth, isLinked, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        steam_id, 
        steam_username,
        discord_username,
        steam_avatar,
        kills, 
        deaths, 
        COALESCE(ROUND(play_time::numeric / 60, 1), 0) as play_time_hours, 
        ROUND(COALESCE(kills, 0)::numeric / GREATEST(COALESCE(deaths, 0), 1), 2) as kda,
        current_in_game_badge,
        is_banned
      FROM users
      WHERE steam_id = $1`,
      [req.steam_id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Profil non trouvé" });
    }
    
    res.json({ success: true, profile: result.rows[0] });
  } catch (error) {
    console.error("Erreur profil/me:", error.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* ----------------- DISCORD LINK --------------------- */

app.post("/api/link/generate-code", auth, async (req, res) => {
  let { discord_id, discord_username } = req.body;

  if (!discord_id || !discord_username) {
    return res.status(400).json({ error: "Discord ID et username requis" });
  }

  if (typeof discord_id !== "string" || discord_id.length > 32 || !/^\d+$/.test(discord_id)) {
    return res.status(400).json({ error: "Discord ID invalide" });
  }

  if (typeof discord_username !== "string" || discord_username.length > 64) {
    return res.status(400).json({ error: "Discord username invalide" });
  }

  discord_username = sanitizeString(discord_username);

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

app.get("/api/link/check-status", auth, async (req, res) => {
  const { discord_id } = req.query;

  if (!discord_id) {
    return res.status(400).json({ error: "Discord ID requis" });
  }

  if (typeof discord_id !== "string" || !/^\d+$/.test(discord_id)) {
    return res.status(400).json({ error: "Discord ID invalide" });
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
  let { code, steam_id } = req.body;

  if (!code || !steam_id) {
    return res.status(400).json({ error: "Code et SteamID requis" });
  }

  if (typeof code !== "string" || !/^[A-F0-9]{6}$/.test(code)) {
    return res.status(400).json({ error: "Code invalide" });
  }

  const cleanSteamId = validateSteamId(steam_id);
  if (!cleanSteamId) return res.status(400).json({ error: "Steam ID invalide" });

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
          sanitizeString(link.discord_username),
          playerInfo.avatarfull || "",
        ]
      );
    } else {
      await pool.query(
        "UPDATE users SET discord_id = $1, discord_username = $2 WHERE steam_id = $3",
        [link.discord_id, sanitizeString(link.discord_username), cleanSteamId]
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
    console.error("Erreur staff players:", error.message);
    res.status(500).json({ error: "Erreur" });
  }
});

app.post("/api/staff/warn", async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  const validApiKeys = process.env.API_KEYS ? process.env.API_KEYS.split(',') : [];
  
  console.log("=== DEBUG STAFF WARN ===");
  console.log("API Key reçue:", apiKey);
  console.log("API Keys valides:", validApiKeys);
  
  if (apiKey && validApiKeys.includes(apiKey)) {
    console.log("✅ Clé API valide, traitement...");
    let { steam_id, reason, moderator_name } = req.body;
    
    const cleanSteamId = validateSteamId(steam_id);
    if (!cleanSteamId) {
      console.log("❌ Steam ID invalide:", steam_id);
      return res.status(400).json({ error: "steam_id invalide" });
    }
    if (!reason || typeof reason !== "string" || reason.length > 500) {
      console.log("❌ Raison invalide:", reason);
      return res.status(400).json({ error: "raison invalide (max 500 caractères)" });
    }
    reason = sanitizeString(reason);
    moderator_name = moderator_name ? sanitizeString(moderator_name).substring(0, 64) : "Inconnu";
    
    try {
      await pool.query(
        `INSERT INTO warns_bans (steamid, type, reason, moderator_name, is_active)
         VALUES ($1, 'warn', $2, $3, true)`,
        [cleanSteamId, reason, moderator_name]
      );
      console.log("✅ Warn ajouté avec succès");
      return res.json({ success: true });
    } catch (error) {
      console.error("❌ Erreur SQL:", error.message);
      return res.status(500).json({ error: "Erreur serveur" });
    }
  }
  
  console.log("❌ Aucune clé API valide trouvée");
  return res.status(401).json({ error: "Token manquant ou invalide" });
});

app.post("/api/staff/ban", auth, isStaff, async (req, res) => {
  let { steam_id, reason, duration_minutes } = req.body;

  const cleanSteamId = validateSteamId(steam_id);
  if (!cleanSteamId) {
    return res.status(400).json({ error: "steam_id invalide" });
  }

  if (!reason || typeof reason !== "string" || reason.length > 500) {
    return res.status(400).json({ error: "raison invalide (max 500 caractères)" });
  }

  reason = sanitizeString(reason);
  
  let duration = null;
  if (duration_minutes && !isNaN(parseInt(duration_minutes))) {
    duration = parseInt(duration_minutes);
    if (duration <= 0 || duration > 525600) { // max 1 an
      return res.status(400).json({ error: "durée invalide" });
    }
  }
  
  const expires_at = duration ? new Date(Date.now() + duration * 60000) : null;

  try {
    await pool.query(
      `INSERT INTO warns_bans (steamid, type, reason, moderator_name, duration_minutes, expires_at, is_active)
       VALUES ($1, 'ban', $2, $3, $4, $5, true)`,
      [cleanSteamId, reason, req.user.discord_username, duration, expires_at]
    );
    await pool.query("UPDATE users SET is_banned = true WHERE steam_id = $1", [cleanSteamId]);
    res.json({ success: true });
  } catch (error) {
    console.error("Erreur ajout ban:", error.message);
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
  const { code, error } = req.query;
  
  console.log("=== CALLBACK REÇU ===");
  console.log("Code:", code);
  console.log("Error:", error);

  if (error) {
    console.log("Erreur Discord:", error);
    return res.status(400).send(`Erreur Discord: ${error}`);
  }

  if (!code) {
    console.log("Pas de code");
    return res.status(400).send("Code manquant");
  }

  try {
    console.log("Envoi requête à Discord...");
    console.log("Client ID:", process.env.DISCORD_CLIENT_ID);
    console.log("Redirect URI:", process.env.DISCORD_REDIRECT_URI);
    
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

    console.log("Token reçu !");

    const { access_token } = tokenResponse.data;

    const userResponse = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const { id, username, avatar } = userResponse.data;

    let isStaffUser = false;
    const staffIds = process.env.STAFF_DISCORD_IDS ? process.env.STAFF_DISCORD_IDS.split(',') : [];
    if (staffIds.includes(id)) {
      isStaffUser = true;
    }

    const token = jwt.sign(
      { discord_id: id, discord_username: sanitizeString(username), avatar: avatar, isStaff: isStaffUser },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    
    console.log("Token généré, redirection vers dashboard...");
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

/* --------- WARNS -------------- */

app.get("/api/player/warns/:steamid", async (req, res) => {
  const { steamid } = req.params;
  
  const cleanSteamId = validateSteamId(steamid);
  if (!cleanSteamId) {
    return res.status(400).json({ error: "Steam ID invalide" });
  }
  
  try {
    const result = await pool.query(
      `SELECT id, reason, moderator_name, created_at, is_active 
       FROM warns_bans 
       WHERE steamid = $1 AND type = 'warn' 
       ORDER BY created_at DESC`,
      [cleanSteamId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Erreur warns:", error.message);
    res.status(500).json({ error: "Erreur" });
  }
});

app.get("/api/player/bans/:steamid", async (req, res) => {
  const { steamid } = req.params;
  
  const cleanSteamId = validateSteamId(steamid);
  if (!cleanSteamId) {
    return res.status(400).json({ error: "Steam ID invalide" });
  }
  
  try {
    const result = await pool.query(
      `SELECT id, reason, moderator_name, created_at, expires_at, is_active 
       FROM warns_bans 
       WHERE steamid = $1 AND type = 'ban' 
       ORDER BY created_at DESC`,
      [cleanSteamId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Erreur bans:", error.message);
    res.status(500).json({ error: "Erreur" });
  }
});

/* ----------------- APP LISTEN --------------------- */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Serveur lancé sur : http://0.0.0.0:${PORT}`);
});