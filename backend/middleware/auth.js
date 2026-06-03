const jwt = require('jsonwebtoken');

module.exports = function auth(req, res, next) {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ error: 'Accès refusé. Token manquant.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        console.error('Erreur JWT:', error.message);
        res.status(403).json({ error: 'Token invalide ou expiré.' });
    }
};