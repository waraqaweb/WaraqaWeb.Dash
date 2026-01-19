/**
 * JWT Utility Functions
 * 
 * Handles JWT token generation and verification
 */

const jwt = require('jsonwebtoken');

/**
 * Generate JWT token for user
 */
const generateToken = (user, options = {}) => {
  const userId = (user && (user._id || user.id)) ? (user._id || user.id) : user;
  const payload = {
    userId,
    email: user && user.email ? user.email : undefined,
    role: user && user.role ? user.role : undefined,
  };

  if (options && options.impersonatedBy) {
    payload.impersonatedBy = String(options.impersonatedBy);
    payload.isImpersonated = true;
  }

  return jwt.sign(payload, process.env.JWT_SECRET || 'your-secret-key', {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

/**
 * Verify JWT token
 */
const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
};

/**
 * Decode JWT token without verification
 */
const decodeToken = (token) => {
  return jwt.decode(token);
};

module.exports = {
  generateToken,
  verifyToken,
  decodeToken
};

