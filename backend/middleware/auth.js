const jwt = require("jsonwebtoken");

module.exports = function auth(req, res, next) {
  if (req.method === "OPTIONS") {
    return next();
  }

  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token manquant ou invalide" });
  }

  const token = authHeader.split(" ")[1];

  if (!token || token.length < 10) {
    return res.status(401).json({ error: "Token invalide" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || typeof decoded !== 'object') {
      return res.status(403).json({ error: "Token corrompu" });
    }

    if (!decoded.discord_id) {
      return res.status(403).json({ error: "Token invalide - Discord ID manquant" });
    }
    
    req.user = decoded;
    next();
  } catch (error) {

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expiré, reconnectez-vous" });
    }
    if (error.name === "JsonWebTokenError") {
      return res.status(403).json({ error: "Token invalide" });
    }
    
    console.error("Erreur JWT:", error.message);
    return res.status(403).json({ error: "Token invalide ou expiré" });
  }
};