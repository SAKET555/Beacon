const express = require('express');
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const Message = require('../models/Message');
const Channel = require('../models/Channel');
const Notification = require('../models/Notification');
const { buildLinkPreviews } = require('../utils/linkPreview');
const { sendPushToUser } = require('../utils/push');
const Server = require('../models/Server');
const { ensureServerRoles, hasServerPermission } = require('../utils/permissions');

const router = express.Router();

// GET /api/messages/:channelId - Get messages with pagination
router.get('/:channelId', auth, async (req, res) => {
  try {
    const { page = 1, limit = 50, before } = req.query;
    const query = {
      channel: req.params.channelId,
      isScheduled: false
    };

    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .populate('author', 'username displayName avatar status')
      .populate('mentions', 'username displayName')
      .populate({
        path: 'replyTo',
        populate: { path: 'author', select: 'username displayName avatar' }
      });

    const total = await Message.countDocuments(query);

    res.json({
      messages: messages.reverse(),
      total,
      hasMore: total > parseInt(page) * parseInt(limit)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST /api/messages/:channelId - Send a message
router.post('/:channelId', auth, [
  body('content').optional().isLength({ max: 2000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const channel = await Channel.findById(req.params.channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Check locked channel
    if (channel.settings.locked) {
      if (channel.server) {
        const server = await Server.findById(channel.server);
        ensureServerRoles(server);
        const member = server.members.find(m => m.user.toString() === req.userId.toString());
        if (!member || !hasServerPermission(server, member, 'manageMessages')) {
          return res.status(403).json({ error: 'Channel is locked' });
        }
      }
    }

    // Check spam filter
    if (channel.server) {
      const server = await Server.findById(channel.server);
      if (server.settings.spamFilter && server.settings.filteredWords.length > 0) {
        const content = (req.body.content || '').toLowerCase();
        const hasFilteredWord = server.settings.filteredWords.some(word =>
          content.includes(word.toLowerCase())
        );
        if (hasFilteredWord) {
          return res.status(400).json({ error: 'Message contains filtered words' });
        }
      }
    }

    const { content, attachments, replyTo, mentions, scheduledFor } = req.body;

    if (!content && (!attachments || attachments.length === 0)) {
      return res.status(400).json({ error: 'Message must have content or attachments' });
    }

    const scheduledDate = scheduledFor ? new Date(scheduledFor) : null;
    if (scheduledDate && Number.isNaN(scheduledDate.getTime())) {
      return res.status(400).json({ error: 'Invalid schedule time' });
    }
    if (scheduledDate && scheduledDate.getTime() < Date.now() + 1000) {
      return res.status(400).json({ error: 'Scheduled time must be in the future' });
    }

    const linkPreviews = await buildLinkPreviews(content || '');

    const message = new Message({
      content: content || '',
      author: req.userId,
      channel: channel._id,
      server: channel.server || null,
      attachments: attachments || [],
      linkPreviews,
      replyTo: replyTo || null,
      mentions: mentions || [],
      scheduledFor: scheduledDate || null,
      isScheduled: !!scheduledDate
    });
    await message.save();

    // Update thread count if replying
    if (replyTo) {
      await Message.findByIdAndUpdate(replyTo, { $inc: { threadCount: 1 } });
    }

    // Update channel's lastMessage only for immediate messages
    if (!message.isScheduled) {
      channel.lastMessage = message._id;
      await channel.save();
    }

    // Populate for response
    await message.populate('author', 'username displayName avatar status');
    await message.populate('mentions', 'username displayName');
    if (message.replyTo) {
      await message.populate({
        path: 'replyTo',
        populate: { path: 'author', select: 'username displayName avatar' }
      });
    }

    // If not scheduled, emit via socket
    if (!message.isScheduled) {
      const io = req.app.get('io');
      io.to(`channel:${channel._id}`).emit('message:new', { message });

      // Create notifications for mentions
      if (mentions && mentions.length > 0) {
        const notifications = mentions.map(userId => ({
          user: userId,
          type: 'mention',
          title: `${req.user.username} mentioned you`,
          body: content ? content.substring(0, 100) : 'in a message',
          message: message._id,
          channel: channel._id,
          server: channel.server,
          sender: req.userId
        }));
        const created = await Notification.insertMany(notifications);
        created.forEach(notif => {
          io.to(`user:${notif.user}`).emit('notification:new', { notification: notif });
          sendPushToUser(notif.user, {
            title: notif.title,
            body: notif.body,
            data: { messageId: message._id, channelId: channel._id, serverId: channel.server }
          });
        });
      }

      // Create notification for reply
      if (replyTo) {
        const parentMsg = await Message.findById(replyTo);
        if (parentMsg && parentMsg.author.toString() !== req.userId.toString()) {
          const notif = await Notification.create({
            user: parentMsg.author,
            type: 'reply',
            title: `${req.user.username} replied to your message`,
            body: content ? content.substring(0, 100) : 'with an attachment',
            message: message._id,
            channel: channel._id,
            server: channel.server,
            sender: req.userId
          });
          io.to(`user:${parentMsg.author}`).emit('notification:new', { notification: notif });
          sendPushToUser(parentMsg.author, {
            title: notif.title,
            body: notif.body,
            data: { messageId: message._id, channelId: channel._id, serverId: channel.server }
          });
        }
      }
    }

    res.status(201).json({ message });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// PATCH /api/messages/:id - Edit a message
router.patch('/:id', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (message.author.toString() !== req.userId.toString()) {
      return res.status(403).json({ error: 'Can only edit own messages' });
    }

    const { content } = req.body;
    if (!content || content.length > 2000) {
      return res.status(400).json({ error: 'Invalid content' });
    }

    // Store edit history
    message.editHistory.push({
      content: message.content,
      editedAt: new Date()
    });
    message.content = content;
    message.isEdited = true;
    await message.save();

    await message.populate('author', 'username displayName avatar status');

    const io = req.app.get('io');
    io.to(`channel:${message.channel}`).emit('message:edited', { message });

    res.json({ message });
  } catch (error) {
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// DELETE /api/messages/:id - Delete a message
router.delete('/:id', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Authors can delete their own messages, admins can delete any
    let canDelete = message.author.toString() === req.userId.toString();
    if (!canDelete && message.server) {
      const server = await Server.findById(message.server);
      ensureServerRoles(server);
      const member = server.members.find(m => m.user.toString() === req.userId.toString());
      canDelete = !!member && hasServerPermission(server, member, 'manageMessages');
    }

    if (!canDelete) {
      return res.status(403).json({ error: 'Cannot delete this message' });
    }

    message.isDeleted = true;
    message.content = '';
    message.attachments = [];
    await message.save();

    const io = req.app.get('io');
    io.to(`channel:${message.channel}`).emit('message:deleted', {
      messageId: message._id,
      channelId: message.channel
    });

    res.json({ message: 'Message deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// POST /api/messages/:id/react - Toggle reaction
router.post('/:id/react', auth, async (req, res) => {
  try {
    const { emoji } = req.body;
    if (!emoji) {
      return res.status(400).json({ error: 'Emoji required' });
    }

    const message = await Message.findById(req.params.id);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const existingReaction = message.reactions.find(r => r.emoji === emoji);

    if (existingReaction) {
      const userIndex = existingReaction.users.indexOf(req.userId);
      if (userIndex > -1) {
        existingReaction.users.splice(userIndex, 1);
        if (existingReaction.users.length === 0) {
          message.reactions = message.reactions.filter(r => r.emoji !== emoji);
        }
      } else {
        existingReaction.users.push(req.userId);
      }
    } else {
      message.reactions.push({ emoji, users: [req.userId] });
    }

    await message.save();
    await message.populate('author', 'username displayName avatar status');

    const io = req.app.get('io');
    io.to(`channel:${message.channel}`).emit('message:reacted', {
      messageId: message._id,
      reactions: message.reactions,
      userId: req.userId,
      emoji
    });

    // Notification for reaction
    if (message.author.toString() !== req.userId.toString()) {
      const notif = await Notification.create({
        user: message.author,
        type: 'reaction',
        title: `${req.user.username} reacted ${emoji}`,
        body: message.content ? message.content.substring(0, 50) : 'to your message',
        message: message._id,
        channel: message.channel,
        server: message.server,
        sender: req.userId
      });
      io.to(`user:${message.author}`).emit('notification:new', { notification: notif });
    }

    res.json({ reactions: message.reactions });
  } catch (error) {
    res.status(500).json({ error: 'Failed to react' });
  }
});

// GET /api/messages/search/:channelId - Search messages
router.get('/search/:channelId', auth, async (req, res) => {
  try {
    const { q, author, has, before, after, limit = 25 } = req.query;
    const query = {
      channel: req.params.channelId,
      isDeleted: false,
      isScheduled: false
    };

    if (q) {
      query.$text = { $search: q };
    }
    if (author) {
      query.author = author;
    }
    if (has === 'attachment') {
      query['attachments.0'] = { $exists: true };
    }
    if (has === 'link') {
      query.content = { $regex: /https?:\/\//, $options: 'i' };
    }
    if (before) {
      query.createdAt = { ...query.createdAt, $lt: new Date(before) };
    }
    if (after) {
      query.createdAt = { ...query.createdAt, $gt: new Date(after) };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .populate('author', 'username displayName avatar');

    res.json({ messages, total: messages.length });
  } catch (error) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET /api/messages/thread/:messageId - Get thread messages
router.get('/thread/:messageId', auth, async (req, res) => {
  try {
    const messages = await Message.find({
      $or: [
        { _id: req.params.messageId },
        { replyTo: req.params.messageId }
      ],
      isScheduled: false
    })
      .sort({ createdAt: 1 })
      .populate('author', 'username displayName avatar status');

    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch thread' });
  }
});

module.exports = router;
