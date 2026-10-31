const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { signToken } = require('../utils/token');

const router = express.Router();

// POST /api/auth/register
router.post('/register', [
  body('username').isString().trim().isLength({ min: 3, max: 32 })
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers, and underscores'),
  body('email').isEmail().normalizeEmail(),
  body('password').isString().isLength({ min: 8, max: 128 }).withMessage('Password must be 8-128 characters'),
  body('displayName').optional().isString().trim().isLength({ max: 32 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password, displayName } = req.body;

    // Check existing user
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });
    if (existingUser) {
      const field = existingUser.email === email ? 'email' : 'username';
      return res.status(400).json({ error: `This ${field} is already in use` });
    }

    const user = new User({
      username,
      email,
      password,
      displayName: displayName || username
    });
    await user.save();

    res.status(201).json({
      token: signToken(user),
      user: user.toJSON()
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'This email or username is already in use' });
    }
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').isString().notEmpty().isLength({ max: 128 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+tokenVersion');
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update status to online
    user.status = 'online';
    await user.save();

    res.json({
      token: signToken(user),
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .populate('servers', 'name icon')
      .select('-password -twoFactorSecret');
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', auth, async (req, res) => {
  try {
    res.json({ token: signToken(req.user) });
  } catch (error) {
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// POST /api/auth/logout-all - Revoke every token issued so far (e.g. after a leak).
// Returns a fresh token so the calling device stays signed in.
router.post('/logout-all', auth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.userId,
      { $inc: { tokenVersion: 1 } },
      { new: true }
    ).select('+tokenVersion');
    res.json({ token: signToken(user) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to sign out other sessions' });
  }
});

module.exports = router;
