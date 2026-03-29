const express = require('express');
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const Channel = require('../models/Channel');
const Server = require('../models/Server');
const Message = require('../models/Message');
const AuditLog = require('../models/AuditLog');

const router = express.Router();

// GET /api/channels/:serverId - Get channels for a server
router.get('/:serverId', auth, async (req, res) => {
  try {
    const channels = await Channel.find({ server: req.params.serverId })
      .sort({ type: 1, name: 1 });
    res.json({ channels });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

// POST /api/channels/:serverId - Create a channel
router.post('/:serverId', auth, [
  body('name').isLength({ min: 1, max: 64 }).trim()
    .matches(/^[a-zA-Z0-9-_]+$/).withMessage('Channel name can only contain letters, numbers, hyphens, and underscores')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const server = await Server.findById(req.params.serverId);
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const member = server.members.find(m => m.user.toString() === req.userId.toString());
    if (!member || !['owner', 'admin', 'moderator'].includes(member.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

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
    const channel = await Channel.findById(req.params.id)
      .populate('pinnedMessages');
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    res.json({ channel });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch channel' });
  }
});

// PATCH /api/channels/:id - Update channel
router.patch('/:id', auth, async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    if (channel.server) {
      const server = await Server.findById(channel.server);
      const member = server.members.find(m => m.user.toString() === req.userId.toString());
      if (!member || !['owner', 'admin', 'moderator'].includes(member.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
    }

    const allowed = ['name', 'topic', 'type'];
    allowed.forEach(field => {
      if (req.body[field] !== undefined) channel[field] = req.body[field];
    });

    if (req.body.settings) {
      Object.assign(channel.settings, req.body.settings);
    }

    await channel.save();

    if (channel.server) {
      await AuditLog.create({
        server: channel.server,
        action: 'channel_update',
        user: req.userId,
        target: channel.name,
        targetId: channel._id
      });
    }

    res.json({ channel });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update channel' });
  }
});

// DELETE /api/channels/:id - Delete channel
router.delete('/:id', auth, async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    if (channel.server) {
      const server = await Server.findById(channel.server);
      const member = server.members.find(m => m.user.toString() === req.userId.toString());
      if (!member || !['owner', 'admin'].includes(member.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      server.channels = server.channels.filter(c => c.toString() !== channel._id.toString());
      await server.save();

      await AuditLog.create({
        server: channel.server,
        action: 'channel_delete',
        user: req.userId,
        target: channel.name,
        targetId: channel._id
      });
    }

    // Delete all messages in channel
    await Message.deleteMany({ channel: channel._id });
    await Channel.findByIdAndDelete(channel._id);

    const io = req.app.get('io');
    if (channel.server) {
      io.to(`server:${channel.server}`).emit('channel:deleted', { channelId: channel._id });
    }

    res.json({ message: 'Channel deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete channel' });
  }
});

// POST /api/channels/:id/pin/:messageId - Toggle pin message
router.post('/:id/pin/:messageId', auth, async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    const message = await Message.findById(req.params.messageId);

    if (!channel || !message) {
      return res.status(404).json({ error: 'Channel or message not found' });
    }

    const isPinned = channel.pinnedMessages.includes(message._id);

    if (isPinned) {
      channel.pinnedMessages = channel.pinnedMessages.filter(
        id => id.toString() !== message._id.toString()
      );
      message.isPinned = false;
    } else {
      channel.pinnedMessages.push(message._id);
      message.isPinned = true;
    }

    await channel.save();
    await message.save();

    if (channel.server) {
      await AuditLog.create({
        server: channel.server,
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
    const channel = await Channel.findById(req.params.id)
      .populate({
        path: 'pinnedMessages',
        populate: { path: 'author', select: 'username displayName avatar' }
      });

    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    res.json({ pinnedMessages: channel.pinnedMessages });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pinned messages' });
  }
});

// POST /api/channels/:id/read - Mark channel as read
router.post('/:id/read', auth, async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const readEntry = channel.readBy.find(
      r => r.user.toString() === req.userId.toString()
    );

    if (readEntry) {
      readEntry.lastRead = new Date();
    } else {
      channel.readBy.push({ user: req.userId, lastRead: new Date() });
    }

    await channel.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

module.exports = router;
