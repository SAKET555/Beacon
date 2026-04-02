const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Channel = require('../models/Channel');
const Server = require('../models/Server');
const Message = require('../models/Message');

const router = express.Router();

// GET /api/users/:id - Get user profile
router.get('/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -twoFactorSecret -blockedUsers');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// PATCH /api/users/profile - Update own profile
router.patch('/profile', auth, async (req, res) => {
  try {
    const allowed = ['displayName', 'bio', 'avatar', 'customStatus'];
    const updates = {};
    allowed.forEach(field => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    const user = await User.findByIdAndUpdate(req.userId, updates, { new: true })
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

    // Broadcast status change via Socket.IO
    const io = req.app.get('io');
    io.emit('presence:changed', { userId: req.userId, status });

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

    const user = await User.findById(req.userId);
    const isBlocked = user.blockedUsers.includes(targetId);

    if (isBlocked) {
      user.blockedUsers = user.blockedUsers.filter(id => id.toString() !== targetId);
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
    const { mentions, replies, reactions, sounds } = req.body;
    const prefs = {};
    if (mentions !== undefined) prefs['notificationPreferences.mentions'] = mentions;
    if (replies !== undefined) prefs['notificationPreferences.replies'] = replies;
    if (reactions !== undefined) prefs['notificationPreferences.reactions'] = reactions;
    if (sounds !== undefined) prefs['notificationPreferences.sounds'] = sounds;

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

    const targetUser = await User.findById(targetId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
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
    const query = req.params.query;
    const users = await User.find({
      $or: [
        { username: { $regex: query, $options: 'i' } },
        { displayName: { $regex: query, $options: 'i' } }
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
    const message = await Message.findById(req.params.messageId);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const user = await User.findById(req.userId);
    const existingIndex = user.starredMessages.findIndex(
      id => id.toString() === message._id.toString()
    );

    let starred = false;
    if (existingIndex > -1) {
      user.starredMessages.splice(existingIndex, 1);
      starred = false;
    } else {
      user.starredMessages.push(message._id);
      starred = true;
    }

    await user.save();
    res.json({ starred });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update starred messages' });
  }
});

// GET /api/users/starred - Get starred messages
router.get('/starred', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .populate({
        path: 'starredMessages',
        populate: { path: 'author', select: 'username displayName avatar' }
      });

    res.json({ messages: user?.starredMessages || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch starred messages' });
  }
});

// DELETE /api/users/account - Delete own account
router.delete('/account', auth, async (req, res) => {
  try {
    const userId = req.userId;

    // Remove user from all servers they're a member of
    await Server.updateMany(
      { members: { $elemMatch: { user: userId } } },
      { $pull: { members: { user: userId } } }
    );

    // Remove DM channels they participated in
    await Channel.deleteMany({ type: 'dm', participants: userId });

    // Delete the user document
    await User.findByIdAndDelete(userId);

    // Notify others of disconnection
    const io = req.app.get('io');
    io.emit('presence:changed', { userId, status: 'offline' });

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Account deletion error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

module.exports = router;
