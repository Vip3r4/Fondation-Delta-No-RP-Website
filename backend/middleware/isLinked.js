const pool = require("../config/db");

async function isLinked(req, res, next) {
  const steam_id = req.params.steamid || req.body.steam_id;

  if (!steam_id) {
    return res.status(400).json({ 
      success: false, 
      error: "steam_id manquant" 
    });
  }

  try {
    const result = await pool.query(
      "SELECT steam_id FROM users WHERE steam_id = $1",
      [steam_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: "Joueur non trouvé ou compte non lié" 
      });
    }

    req.steam_id = steam_id;
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