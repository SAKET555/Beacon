const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Channel = require('../models/Channel');
const Server = require('../models/Server');
const Notification = require('../models/Notification');
const PushSubscription = require('../models/PushSubscription');
const { useIdParams, escapeRegex, cleanString, cleanMediaUrl } = require('../utils/http');
const { sameId, denyAccess, getMessageAccess } = require('../utils/access');
const { broadcastPresence } = require('../utils/realtime');

const router = express.Router();
useIdParams(router, 'id', 'messageId');

const PROFILE_LIMITS = { displayName: 32, bio: 190, customStatus: 128 };

// NOTE: static routes must stay above GET /:id, otherwise /:id swallows them.

// PATCH /api/users/profile - Update own profile
router.patch('/profile', auth, async (req, res) => {
  try {
    const updates = {};
    for (const [field, maxLength] of Object.entries(PROFILE_LIMITS)) {
      if (req.body[field] === undefined) continue;
      const value = cleanString(req.body[field], maxLength);
      if (value === null) return res.status(400).json({ error: `Invalid ${field}` });
      updates[field] = value;
    }
    if (req.body.avatar !== undefined) {
      const avatar = cleanMediaUrl(req.body.avatar);
      if (avatar === null) return res.status(400).json({ error: 'Avatar must be an https URL' });
      updates.avatar = avatar;
    }

    const user = await User.findByIdAndUpdate(req.userId, updates, { new: true, runValidators: true })
      .select('-password -twoFactorSecret');
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// PATCH /api/users/status - Update status
router.patch('/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['online', 'away', 'dnd', 'offline'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      { status },
      { new: true }
    ).select('-password -twoFactorSecret');

    // Broadcast status change to people who share a server or DM with this user
    await broadcastPresence(req.app.get('io'), req.userId, status);

    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// POST /api/users/block/:id - Block a user
router.post('/block/:id', auth, async (req, res) => {
  try {
    const targetId = req.params.id;
    if (targetId === req.userId.toString()) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }
    if (!(await User.exists({ _id: targetId }))) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = await User.findById(req.userId);
    const isBlocked = user.blockedUsers.some(id => sameId(id, targetId));

    if (isBlocked) {
      user.blockedUsers = user.blockedUsers.filter(id => !sameId(id, targetId));
    } else {
      user.blockedUsers.push(targetId);
    }
    await user.save();

    res.json({ blocked: !isBlocked, blockedUsers: user.blockedUsers });
  } catch (error) {
    res.status(500).json({ error: 'Failed to block user' });
  }
});

// PATCH /api/users/notifications/preferences - Update notification preferences
router.patch('/notifications/preferences', auth, async (req, res) => {
  try {
    const prefs = {};
    ['mentions', 'replies', 'reactions', 'sounds'].forEach(key => {
      if (typeof req.body[key] === 'boolean') prefs[`notificationPreferences.${key}`] = req.body[key];
    });

    const user = await User.findByIdAndUpdate(req.userId, prefs, { new: true })
      .select('-password -twoFactorSecret');
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// POST /api/users/dm/:id - Create or get DM channel
router.post('/dm/:id', auth, async (req, res) => {
  try {
    const targetId = req.params.id;
    if (targetId === req.userId.toString()) {
      return res.status(400).json({ error: 'Cannot DM yourself' });
    }

    const targetUser = await User.findById(targetId).select('blockedUsers');
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (targetUser.blockedUsers.some(id => sameId(id, req.userId))) {
      return res.status(403).json({ error: 'You cannot message this user' });
    }

    // Check if DM channel already exists
    let dmChannel = await Channel.findOne({
      type: 'dm',
      participants: { $all: [req.userId, targetId], $size: 2 }
    });

    if (!dmChannel) {
      dmChannel = new Channel({
        name: `dm-${req.userId}-${targetId}`,
        type: 'dm',
        participants: [req.userId, targetId]
      });
      await dmChannel.save();

      // Add to both users' dmChannels
      await User.updateMany(
        { _id: { $in: [req.userId, targetId] } },
        { $addToSet: { dmChannels: dmChannel._id } }
      );
    }

    await dmChannel.populate('participants', 'username displayName avatar status');

    res.json({ channel: dmChannel });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create DM channel' });
  }
});

// GET /api/users/dm/channels - Get all DM channels
router.get('/dm/channels', auth, async (req, res) => {
  try {
    const channels = await Channel.find({
      type: 'dm',
      participants: req.userId
    })
      .populate('participants', 'username displayName avatar status')
      .populate('lastMessage')
      .sort({ updatedAt: -1 });

    res.json({ channels });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch DM channels' });
  }
});

// GET /api/users/search/:query - Search users
router.get('/search/:query', auth, async (req, res) => {
  try {
    const query = String(req.params.query || '').trim();
    if (!query || query.length > 32) {
      return res.status(400).json({ error: 'Search must be 1-32 characters' });
    }
    // Escaped so user input can't inject regex syntax (or a ReDoS pattern)
    const pattern = new RegExp(escapeRegex(query), 'i');
    const users = await User.find({
      $or: [
        { username: pattern },
        { displayName: pattern }
      ],
      _id: { $ne: req.userId }
    })
      .select('username displayName avatar status')
      .limit(20);

    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// POST /api/users/star/:messageId - Toggle star on a message
router.post('/star/:messageId', auth, async (req, res) => {
  try {
    const access = await getMessageAccess(req.params.messageId, req.userId);
    if (access.error) return denyAccess(res, access);
    const { message } = access;

    const user = await User.findById(req.userId);
    const existingIndex = user.starredMessages.findIndex(id => sameId(id, message._id));

    let starred = false;
    if (existingIndex > -1) {
      user.starredMessages.splice(existingIndex, 1);
    } else {
      if (user.starredMessages.length >= 500) {
        return res.status(400).json({ error: 'Starred message limit reached (500)' });
      }
      user.starredMessages.push(message._id);
      starred = true;
    }

    await user.save();
    res.json({ starred });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update starred messages' });
  }
});

// GET /api/users/starred - Get starred messages the user can still see
router.get('/starred', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .populate({
        path: 'starredMessages',
        populate: { path: 'author', select: 'username displayName avatar' }
      });

    // Hide stars from channels the user has since left or been kicked from
    const serverIds = await Server.find({ 'members.user': req.userId }).distinct('_id');
    const channelIds = await Channel.find({
      $or: [{ server: { $in: serverIds } }, { participants: req.userId }]
    }).distinct('_id');
    const visible = new Set(channelIds.map(String));

    const messages = (user?.starredMessages || [])
      .filter(m => m && !m.isDeleted && visible.has(String(m.channel)));

    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch starred messages' });
  }
});

// DELETE /api/users/account - Delete own account
router.delete('/account', auth, async (req, res) => {
  try {
    const userId = req.userId;

    // Deleting an owner would leave their servers with no owner
    const ownedServers = await Server.countDocuments({ owner: userId });
    if (ownedServers > 0) {
      return res.status(400).json({
        error: 'You own servers. Delete them or transfer ownership before deleting your account.'
      });
    }

    const io = req.app.get('io');
    await broadcastPresence(io, userId, 'offline');

    // Remove user from all servers they're a member of
    await Server.updateMany(
      { members: { $elemMatch: { user: userId } } },
      { $pull: { members: { user: userId } } }
    );

    // Remove DM channels they participated in, plus their personal data
    await Channel.deleteMany({ type: 'dm', participants: userId });
    await Notification.deleteMany({ user: userId });
    await PushSubscription.deleteMany({ user: userId });

    // Delete the user document
    await User.findByIdAndDelete(userId);

    io.in(`user:${userId}`).disconnectSockets(true);

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Account deletion error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// GET /api/users/:id - Get user profile (email only visible to the user themselves)
router.get('/:id', auth, async (req, res) => {
  try {
    const isSelf = req.params.id === req.userId.toString();
    const user = await User.findById(req.params.id)
      .select(isSelf
        ? '-password -twoFactorSecret'
        : 'username displayName avatar bio status customStatus createdAt');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

module.exports = router;
