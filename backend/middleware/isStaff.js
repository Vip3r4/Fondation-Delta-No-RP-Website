const pool = require("../config/db");

async function isStaff(req, res, next) {
  if (req.user && req.user.isStaff) {
    return next();
  }
  
  const apiKey = req.headers['x-api-key'];
  const validApiKeys = process.env.API_KEYS ? process.env.API_KEYS.split(',') : [];
  
  if (apiKey && validApiKeys.includes(apiKey)) {
    return next();
  }

  return res.status(403).json({ 
    success: false, 
    error: "Accès refusé - Droits staff requis" 
  });
}

module.exports = isStaff;