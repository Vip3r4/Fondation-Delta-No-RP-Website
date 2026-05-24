require('dotenv').config();
const express = require('express');
const cors = require('cors');

const pool = require('./config/db'); 

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/api/server-info', async (req, res) => {
    try {
        const id = process.env.SCPSL_ID;
        const key = process.env.SCPSL_KEY;
        const response = await fetch(`https://api.scpslgame.com/serverinfo.php?id=${id}&key=${key}&players=true`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erreur serveur" });
    }
});

app.post('/api/game/stats', async (req, res) => {
    const { steam_id, action } = req.body;

    if (!steam_id || !['kill', 'death'].includes(action)) {
        return res.status(400).json({ error: "Données invalides" });
    }

    try {
        let query = "";
        if (action === 'kill') {
            query = `
                INSERT INTO users (steam_id, discord_id, discord_username, kills) 
                VALUES ($1, $2, 'Joueur En Jeu', 1)
                ON CONFLICT (steam_id) DO UPDATE SET kills = users.kills + 1;
            `;
        } else {
            query = `
                INSERT INTO users (steam_id, discord_id, discord_username, deaths) 
                VALUES ($1, $2, 'Joueur En Jeu', 1)
                ON CONFLICT (steam_id) DO UPDATE SET deaths = users.deaths + 1;
            `;
        }

        await pool.query(query, [steam_id, steam_id]);
        res.json({ success: true, message: `Statistique ${action} enregistrée.` });
    } catch (error) {
        console.error("Erreur SQL Stats :", error.message);
        res.status(500).json({ error: "Erreur lors de la mise à jour des stats" });
    }
});

app.post('/api/game/time', async (req, res) => {
    const { steam_id, minutes } = req.body;

    if (!steam_id || !minutes) {
        return res.status(400).json({ error: "Données invalides" });
    }

    try {
        await pool.query(`
            INSERT INTO users (steam_id, discord_id, discord_username, play_time) 
            VALUES ($1, $2, 'Joueur En Jeu', $3)
            ON CONFLICT (steam_id) DO UPDATE SET play_time = users.play_time + $3;
        `, [steam_id, steam_id, minutes]);

        res.json({ success: true, message: "Temps de jeu mis à jour." });
    } catch (error) {
        console.error("Erreur SQL Time :", error.message);
        res.status(500).json({ error: "Erreur temps de jeu" });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                steam_id, 
                discord_username, 
                discord_avatar,
                kills, 
                deaths, 
                play_time,
                ROUND(kills::numeric / GREATEST(deaths, 1), 2) as kda
            FROM users
            WHERE steam_id IS NOT NULL AND steam_id <> ''
            ORDER BY kills DESC 
            LIMIT 50;
        `);

        res.json(result.rows);
    } catch (error) {
        console.error("Erreur SQL Leaderboard :", error.message);
        res.status(500).json({ error: "Erreur serveur leaderboard" });
    }
});

app.listen(PORT, () => {
    console.log(`Serveur lancé sur : http://localhost:${PORT}`);
});