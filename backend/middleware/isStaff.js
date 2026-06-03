const STAFF_API_KEY = process.env.STAFF_API_KEY;

function isStaff(req, res, next) {
  const apiKey = req.headers['x-api-key'];

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