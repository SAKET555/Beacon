const express = require('express');
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const { buildLinkPreviews } = require('../utils/linkPreview');
const { sendPushToUser } = require('../utils/push');
const { hasServerPermission } = require('../utils/permissions');
const { useIdParams, isId, parsePaging, parseDate } = require('../utils/http');
const { sanitizeAttachments } = require('../utils/sanitize');
const { sameId, denyAccess, getChannelAccess, getMessageAccess } = require('../utils/access');

const router = express.Router();
useIdParams(router, 'channelId', 'id', 'messageId');

const MAX_SCHEDULE_MS = 365 * 24 * 60 * 60 * 1000;

// GET /api/messages/:channelId - Get messages with pagination
router.get('/:channelId', auth, async (req, res) => {
  try {
    const access = await getChannelAccess(req.params.channelId, req.userId);
    if (access.error) return denyAccess(res, access);

    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 50, maxLimit: 100 });
    const query = {
      channel: access.channel._id,
      isScheduled: false
    };

    if (req.query.before) {
      const before = parseDate(req.query.before);
      if (!before) return res.status(400).json({ error: 'Invalid before date' });
      query.createdAt = { $lt: before };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
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
      hasMore: total > page * limit
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST /api/messages/:channelId - Send a message
router.post('/:channelId', auth, [
  body('content').optional().isString().isLength({ max: 2000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const access = await getChannelAccess(req.params.channelId, req.userId, 'sendMessages');
    if (access.error) return denyAccess(res, access);
    const { channel, server, member } = access;

    // Check locked channel
    if (channel.settings.locked && server && !hasServerPermission(server, member, 'manageMessages')) {
      return res.status(403).json({ error: 'Channel is locked' });
    }

    const content = req.body.content || '';
    const attachments = sanitizeAttachments(req.body.attachments);
    const { replyTo, scheduledFor } = req.body;

    if (!content && attachments.length === 0) {
      return res.status(400).json({ error: 'Message must have content or attachments' });
    }
    if (attachments.length > 0 && server && !hasServerPermission(server, member, 'attachFiles')) {
      return res.status(403).json({ error: 'You cannot attach files in this server' });
    }

    // Check spam filter
    if (server && server.settings.spamFilter && server.settings.filteredWords.length > 0) {
      const lowered = content.toLowerCase();
      const hasFilteredWord = server.settings.filteredWords.some(word =>
        lowered.includes(word.toLowerCase())
      );
      if (hasFilteredWord) {
        return res.status(400).json({ error: 'Message contains filtered words' });
      }
    }

    // Mentions may only target people who can actually see this channel
    const allowedUsers = new Set(
      server
        ? server.members.map(m => m.user.toString())
        : channel.participants.map(p => p.toString())
    );
    const mentions = [...new Set(Array.isArray(req.body.mentions) ? req.body.mentions : [])]
      .filter(id => isId(id) && allowedUsers.has(id) && id !== req.userId.toString())
      .slice(0, 20);

    // A reply must point at a message in the same channel
    let parentMsg = null;
    if (replyTo !== undefined && replyTo !== null) {
      if (!isId(replyTo)) return res.status(400).json({ error: 'Invalid reply target' });
      parentMsg = await Message.findById(replyTo);
      if (!parentMsg || !sameId(parentMsg.channel, channel._id)) {
        return res.status(400).json({ error: 'Invalid reply target' });
      }
    }

    let scheduledDate = null;
    if (scheduledFor) {
      scheduledDate = parseDate(scheduledFor);
      if (!scheduledDate) {
        return res.status(400).json({ error: 'Invalid schedule time' });
      }
      if (scheduledDate.getTime() < Date.now() + 1000) {
        return res.status(400).json({ error: 'Scheduled time must be in the future' });
      }
      if (scheduledDate.getTime() > Date.now() + MAX_SCHEDULE_MS) {
        return res.status(400).json({ error: 'Messages can be scheduled at most one year ahead' });
      }
    }

    const linkPreviews = await buildLinkPreviews(content);

    const message = new Message({
      content,
      author: req.userId,
      channel: channel._id,
      server: channel.server || null,
      attachments,
      linkPreviews,
      replyTo: parentMsg ? parentMsg._id : null,
      mentions,
      scheduledFor: scheduledDate,
      isScheduled: !!scheduledDate
    });
    await message.save();

    // Update thread count if replying
    if (parentMsg) {
      await Message.findByIdAndUpdate(parentMsg._id, { $inc: { threadCount: 1 } });
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
      if (mentions.length > 0) {
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
      if (parentMsg && !sameId(parentMsg.author, req.userId)) {
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

    res.status(201).json({ message });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// PATCH /api/messages/:id - Edit a message
router.patch('/:id', auth, async (req, res) => {
  try {
    const access = await getMessageAccess(req.params.id, req.userId);
    if (access.error) return denyAccess(res, access);
    const { message } = access;

    if (!sameId(message.author, req.userId)) {
      return res.status(403).json({ error: 'Can only edit own messages' });
    }
    if (message.isDeleted) {
      return res.status(400).json({ error: 'Message was deleted' });
    }

    const { content } = req.body;
    if (typeof content !== 'string' || !content || content.length > 2000) {
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
    const access = await getMessageAccess(req.params.id, req.userId);
    if (access.error) return denyAccess(res, access);
    const { message, server, member } = access;

    // Authors can delete their own messages, moderators can delete any in their server
    const isAuthor = sameId(message.author, req.userId);
    const isModerator = !!server && hasServerPermission(server, member, 'manageMessages');
    if (!isAuthor && !isModerator) {
      return res.status(403).json({ error: 'Cannot delete this message' });
    }

    message.isDeleted = true;
    message.content = '';
    message.attachments = [];
    message.linkPreviews = [];
    message.editHistory = [];
    await message.save();

    if (!isAuthor && server) {
      await AuditLog.create({
        server: server._id,
        action: 'message_delete',
        user: req.userId,
        target: message.author.toString(),
        targetId: message._id
      });
    }

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
    if (typeof emoji !== 'string' || !emoji.trim() || emoji.length > 32) {
      return res.status(400).json({ error: 'Emoji required' });
    }

    const access = await getMessageAccess(req.params.id, req.userId);
    if (access.error) return denyAccess(res, access);
    const { message } = access;

    if (message.isDeleted) {
      return res.status(400).json({ error: 'Message was deleted' });
    }

    const existingReaction = message.reactions.find(r => r.emoji === emoji);
    let added = false;

    if (existingReaction) {
      const userIndex = existingReaction.users.findIndex(u => sameId(u, req.userId));
      if (userIndex > -1) {
        existingReaction.users.splice(userIndex, 1);
        if (existingReaction.users.length === 0) {
          message.reactions = message.reactions.filter(r => r.emoji !== emoji);
        }
      } else {
        existingReaction.users.push(req.userId);
        added = true;
      }
    } else {
      if (message.reactions.length >= 20) {
        return res.status(400).json({ error: 'Too many different reactions on this message' });
      }
      message.reactions.push({ emoji, users: [req.userId] });
      added = true;
    }

    await message.save();

    const io = req.app.get('io');
    io.to(`channel:${message.channel}`).emit('message:reacted', {
      messageId: message._id,
      reactions: message.reactions,
      userId: req.userId,
      emoji
    });

    // Notification for reaction (only when adding, not when removing)
    if (added && !sameId(message.author, req.userId)) {
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
    const access = await getChannelAccess(req.params.channelId, req.userId);
    if (access.error) return denyAccess(res, access);

    const { q, author, has, before, after } = req.query;
    const { limit } = parsePaging(req.query, { defaultLimit: 25, maxLimit: 50 });
    const query = {
      channel: access.channel._id,
      isDeleted: false,
      isScheduled: false
    };

    if (q !== undefined) {
      if (typeof q !== 'string' || q.length > 200) {
        return res.status(400).json({ error: 'Invalid search query' });
      }
      if (q.trim()) query.$text = { $search: q };
    }
    if (author !== undefined) {
      if (!isId(author)) return res.status(400).json({ error: 'Invalid author' });
      query.author = author;
    }
    if (has === 'attachment') {
      query['attachments.0'] = { $exists: true };
    }
    if (has === 'link') {
      query.content = { $regex: /https?:\/\//i };
    }
    if (before !== undefined) {
      const date = parseDate(before);
      if (!date) return res.status(400).json({ error: 'Invalid before date' });
      query.createdAt = { ...query.createdAt, $lt: date };
    }
    if (after !== undefined) {
      const date = parseDate(after);
      if (!date) return res.status(400).json({ error: 'Invalid after date' });
      query.createdAt = { ...query.createdAt, $gt: date };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('author', 'username displayName avatar');

    res.json({ messages, total: messages.length });
  } catch (error) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET /api/messages/thread/:messageId - Get thread messages
router.get('/thread/:messageId', auth, async (req, res) => {
  try {
    const access = await getMessageAccess(req.params.messageId, req.userId);
    if (access.error) return denyAccess(res, access);

    const messages = await Message.find({
      $or: [
        { _id: access.message._id },
        { replyTo: access.message._id }
      ],
      isScheduled: false
    })
      .sort({ createdAt: 1 })
      .limit(500)
      .populate('author', 'username displayName avatar status');

    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch thread' });
  }
});

module.exports = router;
