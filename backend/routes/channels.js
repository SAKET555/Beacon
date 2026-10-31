const express = require('express');
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const Channel = require('../models/Channel');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { hasServerPermission } = require('../utils/permissions');
const { useIdParams, cleanString } = require('../utils/http');
const { sanitizeChannelSettings } = require('../utils/sanitize');
const { sameId, denyAccess, getServerAccess, getChannelAccess } = require('../utils/access');

const router = express.Router();
useIdParams(router, 'serverId', 'id', 'messageId');

const CHANNEL_NAME = /^[a-zA-Z0-9-_]+$/;
const SERVER_CHANNEL_TYPES = ['text', 'announcement'];

// GET /api/channels/:serverId - Get channels for a server
router.get('/:serverId', auth, async (req, res) => {
  try {
    const access = await getServerAccess(req.params.serverId, req.userId);
    if (access.error) return denyAccess(res, access);

    const channels = await Channel.find({ server: access.server._id })
      .select('-readBy')
      .sort({ type: 1, name: 1 });
    res.json({ channels });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

// POST /api/channels/:serverId - Create a channel
router.post('/:serverId', auth, [
  body('name').isString().trim().isLength({ min: 1, max: 64 })
    .matches(CHANNEL_NAME).withMessage('Channel name can only contain letters, numbers, hyphens, and underscores'),
  body('type').optional().isIn(SERVER_CHANNEL_TYPES),
  body('topic').optional().isString().isLength({ max: 256 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const access = await getServerAccess(req.params.serverId, req.userId, 'manageChannels');
    if (access.error) return denyAccess(res, access);
    const { server } = access;

    const { name, type, topic } = req.body;

    const existingChannel = await Channel.findOne({
      server: server._id,
      name: name.toLowerCase()
    });
    if (existingChannel) {
      return res.status(400).json({ error: 'Channel name already exists' });
    }

    const channel = new Channel({
      name: name.toLowerCase(),
      type: type || 'text',
      server: server._id,
      topic: topic || ''
    });
    await channel.save();

    server.channels.push(channel._id);
    await server.save();

    await AuditLog.create({
      server: server._id,
      action: 'channel_create',
      user: req.userId,
      target: channel.name,
      targetId: channel._id
    });

    const io = req.app.get('io');
    io.to(`server:${server._id}`).emit('channel:created', { channel });

    res.status(201).json({ channel });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create channel' });
  }
});

// GET /api/channels/:id/details - Get channel details
router.get('/:id/details', auth, async (req, res) => {
  try {
    const access = await getChannelAccess(req.params.id, req.userId);
    if (access.error) return denyAccess(res, access);

    await access.channel.populate('pinnedMessages');
    res.json({ channel: access.channel });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch channel' });
  }
});

// PATCH /api/channels/:id - Update channel
router.patch('/:id', auth, async (req, res) => {
  try {
    const access = await getChannelAccess(req.params.id, req.userId, 'manageChannels');
    if (access.error) return denyAccess(res, access);
    const { channel } = access;

    if (!channel.server) {
      return res.status(403).json({ error: 'Direct message channels cannot be modified' });
    }

    if (req.body.name !== undefined) {
      const name = cleanString(req.body.name, 64);
      if (!name || !CHANNEL_NAME.test(name)) {
        return res.status(400).json({ error: 'Invalid channel name' });
      }
      const duplicate = await Channel.findOne({
        server: channel.server,
        name: name.toLowerCase(),
        _id: { $ne: channel._id }
      });
      if (duplicate) {
        return res.status(400).json({ error: 'Channel name already exists' });
      }
      channel.name = name.toLowerCase();
    }

    if (req.body.topic !== undefined) {
      const topic = cleanString(req.body.topic, 256);
      if (topic === null) return res.status(400).json({ error: 'Invalid topic' });
      channel.topic = topic;
    }

    if (req.body.type !== undefined) {
      if (!SERVER_CHANNEL_TYPES.includes(req.body.type)) {
        return res.status(400).json({ error: 'Invalid channel type' });
      }
      channel.type = req.body.type;
    }

    Object.assign(channel.settings, sanitizeChannelSettings(req.body.settings));

    await channel.save();

    await AuditLog.create({
      server: channel.server,
      action: 'channel_update',
      user: req.userId,
      target: channel.name,
      targetId: channel._id
    });

    res.json({ channel });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update channel' });
  }
});

// DELETE /api/channels/:id - Delete channel
router.delete('/:id', auth, async (req, res) => {
  try {
    const access = await getChannelAccess(req.params.id, req.userId, 'manageChannels');
    if (access.error) return denyAccess(res, access);
    const { channel, server } = access;

    if (!server) {
      return res.status(403).json({ error: 'Direct message channels cannot be deleted' });
    }

    server.channels = server.channels.filter(c => !sameId(c, channel._id));
    if (server.settings.defaultChannel && sameId(server.settings.defaultChannel, channel._id)) {
      server.settings.defaultChannel = server.channels[0] || null;
    }
    await server.save();

    await AuditLog.create({
      server: channel.server,
      action: 'channel_delete',
      user: req.userId,
      target: channel.name,
      targetId: channel._id
    });

    // Delete all messages and notifications in channel
    await Message.deleteMany({ channel: channel._id });
    await Notification.deleteMany({ channel: channel._id });
    await Channel.findByIdAndDelete(channel._id);

    const io = req.app.get('io');
    io.to(`server:${channel.server}`).emit('channel:deleted', { channelId: channel._id });
    io.in(`channel:${channel._id}`).socketsLeave(`channel:${channel._id}`);

    res.json({ message: 'Channel deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete channel' });
  }
});

// POST /api/channels/:id/pin/:messageId - Toggle pin message
router.post('/:id/pin/:messageId', auth, async (req, res) => {
  try {
    const access = await getChannelAccess(req.params.id, req.userId);
    if (access.error) return denyAccess(res, access);
    const { channel, server, member } = access;

    // In servers pinning is a moderation action; in DMs either participant may pin
    if (server && !hasServerPermission(server, member, 'manageMessages')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const message = await Message.findById(req.params.messageId);
    if (!message || !sameId(message.channel, channel._id)) {
      return res.status(404).json({ error: 'Message not found in this channel' });
    }

    const isPinned = channel.pinnedMessages.some(id => sameId(id, message._id));

    if (isPinned) {
      channel.pinnedMessages = channel.pinnedMessages.filter(id => !sameId(id, message._id));
      message.isPinned = false;
    } else {
      if (channel.pinnedMessages.length >= 50) {
        return res.status(400).json({ error: 'This channel has reached the pin limit (50)' });
      }
      channel.pinnedMessages.push(message._id);
      message.isPinned = true;
    }

    await channel.save();
    await message.save();

    if (server) {
      await AuditLog.create({
        server: server._id,
        action: 'message_pin',
        user: req.userId,
        target: isPinned ? 'unpin' : 'pin',
        targetId: message._id
      });
    }

    const io = req.app.get('io');
    io.to(`channel:${channel._id}`).emit('message:pinned', {
      messageId: message._id,
      isPinned: !isPinned
    });

    res.json({ pinned: !isPinned, pinnedMessages: channel.pinnedMessages });
  } catch (error) {
    res.status(500).json({ error: 'Failed to pin message' });
  }
});

// GET /api/channels/:id/pins - Get pinned messages
router.get('/:id/pins', auth, async (req, res) => {
  try {
    const access = await getChannelAccess(req.params.id, req.userId);
    if (access.error) return denyAccess(res, access);

    await access.channel.populate({
      path: 'pinnedMessages',
      populate: { path: 'author', select: 'username displayName avatar' }
    });

    res.json({ pinnedMessages: access.channel.pinnedMessages });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pinned messages' });
  }
});

// POST /api/channels/:id/read - Mark channel as read
router.post('/:id/read', auth, async (req, res) => {
  try {
    const access = await getChannelAccess(req.params.id, req.userId);
    if (access.error) return denyAccess(res, access);

    const lastRead = new Date();
    // Atomic update avoids lost writes when several clients mark read at once
    const updated = await Channel.updateOne(
      { _id: access.channel._id, 'readBy.user': req.userId },
      { $set: { 'readBy.$.lastRead': lastRead } }
    );
    if (updated.matchedCount === 0) {
      await Channel.updateOne(
        { _id: access.channel._id },
        { $push: { readBy: { user: req.userId, lastRead } } }
      );
    }

    const io = req.app.get('io');
    const user = await User.findById(req.userId).select('username displayName avatar');
    io.to(`channel:${access.channel._id}`).emit('channel:read', {
      channelId: access.channel._id,
      userId: req.userId,
      user,
      lastRead
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// GET /api/channels/:id/readers - Get read receipts for a channel
router.get('/:id/readers', auth, async (req, res) => {
  try {
    const access = await getChannelAccess(req.params.id, req.userId);
    if (access.error) return denyAccess(res, access);

    await access.channel.populate('readBy.user', 'username displayName avatar');
    res.json({ readBy: access.channel.readBy || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch read receipts' });
  }
});

module.exports = router;
