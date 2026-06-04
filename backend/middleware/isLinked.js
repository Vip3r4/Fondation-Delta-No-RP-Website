const pool = require("../config/db");

async function isLinked(req, res, next) {
  if (!req.user || !req.user.discord_id) {
    return res.status(401).json({ 
      success: false, 
      error: "Non authentifié" 
    });
  }

  try {
    const result = await pool.query(
      "SELECT steam_id FROM users WHERE discord_id = $1",
      [req.user.discord_id]
    );

    if (result.rows.length === 0 || !result.rows[0].steam_id) {
      return res.status(403).json({ 
        success: false, 
        error: "Compte Steam non lié. Utilisez /link.html pour lier votre compte." 
      });
    }

    req.steam_id = result.rows[0].steam_id;
    next();
  } catch (error) {
    console.error("Erreur isLinked:", error.message);
    res.status(500).json({ 
      success: false, 
      error: "Erreur serveur" 
    });
  }
}

module.exports = isLinked;