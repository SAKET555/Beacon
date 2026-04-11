const express = require('express');
const auth = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');
const Server = require('../models/Server');
const User = require('../models/User');
const Message = require('../models/Message');
const Channel = require('../models/Channel');
const AuditLog = require('../models/AuditLog');
const { ensureServerRoles, hasServerPermission } = require('../utils/permissions');

const router = express.Router();

// GET /api/admin/:serverId/stats
router.get('/:serverId/stats', auth, async (req, res) => {
  try {
    const server = await Server.findById(req.params.serverId);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    ensureServerRoles(server);
    const member = server.members.find(m => m.user.toString() === req.userId.toString());
    if (!member || !hasServerPermission(server, member, 'manageServer')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const totalMembers = server.members.length;
    const totalChannels = server.channels.length;
    const totalMessages = await Message.countDocuments({ server: server._id });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const messagesToday = await Message.countDocuments({ server: server._id, createdAt: { $gte: today } });
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const messagesThisWeek = await Message.countDocuments({ server: server._id, createdAt: { $gte: weekAgo } });
    res.json({ stats: { totalMembers, totalChannels, totalMessages, messagesToday, messagesThisWeek } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/admin/:serverId/members
router.get('/:serverId/members', auth, async (req, res) => {
  try {
    const server = await Server.findById(req.params.serverId)
      .populate('members.user', 'username displayName avatar status email createdAt');
    if (!server) return res.status(404).json({ error: 'Server not found' });
    res.json({ members: server.members });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// PATCH /api/admin/:serverId/members/:userId/role
router.patch('/:serverId/members/:userId/role', auth, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'moderator', 'member'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const server = await Server.findById(req.params.serverId);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    ensureServerRoles(server);
    const requester = server.members.find(m => m.user.toString() === req.userId.toString());
    if (!requester || !hasServerPermission(server, requester, 'manageRoles')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const target = server.members.find(m => m.user.toString() === req.params.userId);
    if (!target) return res.status(404).json({ error: 'Member not found' });
    if (target.role === 'owner') return res.status(400).json({ error: 'Cannot change owner role' });
    target.role = role;
    await server.save();
    await AuditLog.create({
      server: server._id, action: 'member_role_update', user: req.userId,
      target: req.params.userId, details: { newRole: role }
    });
    res.json({ member: target });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// DELETE /api/admin/:serverId/members/:userId - Kick member
router.delete('/:serverId/members/:userId', auth, async (req, res) => {
  try {
    const server = await Server.findById(req.params.serverId);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    ensureServerRoles(server);
    const requester = server.members.find(m => m.user.toString() === req.userId.toString());
    if (!requester || !hasServerPermission(server, requester, 'kickMembers')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const target = server.members.find(m => m.user.toString() === req.params.userId);
    if (!target) return res.status(404).json({ error: 'Member not found' });
    if (target.role === 'owner') return res.status(400).json({ error: 'Cannot kick owner' });
    server.members = server.members.filter(m => m.user.toString() !== req.params.userId);
    await server.save();
    await User.findByIdAndUpdate(req.params.userId, { $pull: { servers: server._id } });
    await AuditLog.create({
      server: server._id, action: 'member_kick', user: req.userId, target: req.params.userId
    });
    const io = req.app.get('io');
    io.to(`user:${req.params.userId}`).emit('server:kicked', { serverId: server._id });
    res.json({ message: 'Member kicked' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to kick member' });
  }
});

// GET /api/admin/:serverId/audit-log
router.get('/:serverId/audit-log', auth, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const logs = await AuditLog.find({ server: req.params.serverId })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .populate('user', 'username displayName avatar');
    const total = await AuditLog.countDocuments({ server: req.params.serverId });
    res.json({ logs, total, hasMore: total > parseInt(page) * parseInt(limit) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// PATCH /api/admin/:serverId/settings
router.patch('/:serverId/settings', auth, async (req, res) => {
  try {
    const server = await Server.findById(req.params.serverId);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    ensureServerRoles(server);
    const member = server.members.find(m => m.user.toString() === req.userId.toString());
    if (!member || !hasServerPermission(server, member, 'manageServer')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    if (req.body.settings) Object.assign(server.settings, req.body.settings);
    await server.save();
    await AuditLog.create({
      server: server._id, action: 'settings_update', user: req.userId,
      details: { updated: Object.keys(req.body.settings || {}) }
    });
    res.json({ settings: server.settings });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

module.exports = router;
