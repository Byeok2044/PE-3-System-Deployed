const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token.' });
  }

  let decoded;
  try { decoded = jwt.verify(token, process.env.JWT_SECRET); }
  catch (err) {
    return res.status(401).json({ message: 'Not authorized, invalid token.' });
  }

  try { req.user = await User.findById(decoded.id); }
  catch (err) {
    if (err.name === 'CastError') return res.status(401).json({ message: 'Not authorized, invalid token.' });
    // A database outage does not invalidate an otherwise valid login token.
    return res.status(503).json({ message: 'The authentication database is temporarily unavailable. Please retry when the backend database connection is restored.' });
  }
  if (!req.user) return res.status(401).json({ message: 'Not authorized, user not found.' });
  if (!['student', 'professor'].includes(req.user.role)) return res.status(403).json({ message: 'This account role is no longer supported.' });
  next();
};

module.exports = { protect };
