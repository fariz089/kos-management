const jwt = require('jsonwebtoken');
const prisma = require('../utils/prisma');

// JWT auth for dashboard users
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// API key auth for Hermes Agent
const hermesAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.HERMES_API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

module.exports = { authMiddleware, hermesAuth };
