const jwt = require('jsonwebtoken');
const User = require('../models/User');

const ALGORITHM = 'HS256';

const signToken = (user) => jwt.sign(
  { userId: user._id, v: user.tokenVersion || 0 },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '7d', algorithm: ALGORITHM }
);

// Verifies the JWT and returns the matching user. Throws on any failure.
// A token is only valid while its version matches user.tokenVersion, so bumping
// the version (logout-all) revokes every previously issued token.
const authenticateToken = async (token) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: [ALGORITHM] });
  const user = await User.findById(decoded.userId).select('-password -twoFactorSecret +tokenVersion');
  if (!user) {
    const error = new Error('User not found');
    error.name = 'UserNotFound';
    throw error;
  }
  if ((decoded.v || 0) !== (user.tokenVersion || 0)) {
    const error = new Error('Token revoked');
    error.name = 'TokenRevoked';
    throw error;
  }
  return user;
};

module.exports = { signToken, authenticateToken };
