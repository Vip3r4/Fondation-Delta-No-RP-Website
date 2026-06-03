const STAFF_API_KEY = process.env.STAFF_API_KEY;

function isStaff(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  console.log("Clé reçue :", apiKey);
  console.log("Clé attendue :", STAFF_API_KEY);
  console.log("Comparaison :", apiKey === STAFF_API_KEY);

  if (!apiKey) {
    return res.status(403).json({ 
      success: false, 
      error: "Accès refusé. Clé API manquante." 
    });
  }

  if (apiKey !== STAFF_API_KEY) {
    return res.status(403).json({ 
      success: false, 
      error: "Accès refusé. Clé API invalide." 
    });
  }

  next();
}

module.exports = isStaff;