require("dotenv").config();
const express = require("express");
const cors = require("cors");
const isStaff = require("./middleware/isStaff");
const isLinked = require("./middleware/isLinked");

const pool = require("./config/db");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: "https://sitedeltadarkrp.fr",
    methods: ["GET", "POST"],
    credentials: true,
  }),
);

app.use(express.json());

let cache = { data: null, lastUpdated: 0 };

app.get("/api/test-staff", isStaff, (req, res) => {
  res.json({ success: true, message: "Tu es staff" });
});

app.get("/api/server-info", async (req, res) => {
  const now = Date.now();

  if (cache.data && now - cache.lastUpdated < 30000) {
    return res.json(cache.data);
  }

  try {
    const id = process.env.SCPSL_ID;
    const key = process.env.SCPSL_KEY;
    const response = await fetch(
      `https://api.scpslgame.com/serverinfo.php?id=${id}&key=${key}&players=true`,
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

app.post('/api/game/stats', async (req, res) => {
    const raw_steam_id = req.body.steam_id;
    if (!raw_steam_id) return res.status(400).json({ error: "No ID" });
    
    const steam_id = raw_steam_id.split('@')[0];
    const { action } = req.body;
    const STEAM_API_KEY = process.env.apiKey;

    try {
        const steamRes = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steam_id}`);
        const steamData = await steamRes.json();
        const playerInfo = steamData.response.players[0] || {};
        
        const username = playerInfo.personaname || 'Joueur Inconnu';
        const avatar = playerInfo.avatarfull || 'images/logo (1).svg';

        const column = action === 'kill' ? 'kills' : 'deaths';

        const query = `
            INSERT INTO users (steam_id, discord_id, discord_username, steam_avatar, ${column}) 
            VALUES ($1, $1, $2, $3, 1)
            ON CONFLICT (steam_id) 
            DO UPDATE SET 
                ${column} = users.${column} + 1,
                discord_username = EXCLUDED.discord_username,
                steam_avatar = EXCLUDED.steam_avatar;
        `;

        await pool.query(query, [steam_id, username, avatar]);
        res.json({ success: true });
    } catch (error) {
        console.error("ERREUR DÉTAILLÉE :", error); 
        res.status(500).json({ error: "Erreur serveur", details: error.message });
    }
});

app.post("/api/game/time", async (req, res) => {
  const { steam_id, minutes } = req.body;

  if (!steam_id || !minutes) {
    return res.status(400).json({ error: "Données invalides" });
  }

  try {
    const cleanSteamId = String(steam_id).split('@')[0];
    
    const existingUser = await pool.query(
      'SELECT discord_username, steam_avatar FROM users WHERE steam_id = $1',
      [cleanSteamId]
    );
    
    if (existingUser.rows.length > 0) {
      await pool.query(
        'UPDATE users SET play_time = COALESCE(play_time, 0) + $1 WHERE steam_id = $2',
        [minutes, cleanSteamId]
      );
    } else {
      await pool.query(
        `INSERT INTO users (steam_id, discord_id, discord_username, steam_avatar, play_time) 
         VALUES ($1, $2, 'Joueur En Jeu', 'images/logo (1).svg', $3)`,
        [cleanSteamId, cleanSteamId, minutes]
      );
    }

    res.json({ success: true, message: "Temps de jeu mis à jour." });
  } catch (error) {
    console.error("Erreur SQL Time :", error.message);
    res.status(500).json({ error: "Erreur temps de jeu" });
  }
});

app.get("/api/leaderboard/kills", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        steam_id, 
        discord_username, 
        steam_avatar,
        kills, 
        deaths, 
        COALESCE(ROUND(play_time::numeric / 60, 1), 0) as play_time_hours, 
        ROUND(COALESCE(kills, 0)::numeric / GREATEST(COALESCE(deaths, 0), 1), 2) as kda
      FROM users
      WHERE steam_id IS NOT NULL AND steam_id <> ''
      ORDER BY COALESCE(kills, 0) DESC 
      LIMIT 50;
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
        discord_username, 
        steam_avatar,
        kills, 
        deaths, 
        COALESCE(ROUND(play_time::numeric / 60, 1), 0) as play_time_hours, 
        ROUND(COALESCE(kills, 0)::numeric / GREATEST(COALESCE(deaths, 0), 1), 2) as kda
      FROM users
      WHERE steam_id IS NOT NULL AND steam_id <> ''
      ORDER BY COALESCE(play_time, 0) DESC 
      LIMIT 50;
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Erreur leaderboard time:", error.message);
    res.status(500).json({ error: "Erreur leaderboard temps" });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur lancé sur : http://localhost:${PORT}`);
});