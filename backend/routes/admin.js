const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Message = require('../models/Message');
const AuditLog = require('../models/AuditLog');
const { hasServerPermission } = require('../utils/permissions');
const { useIdParams, parsePaging } = require('../utils/http');
const { sanitizeServerSettings } = require('../utils/sanitize');
const { sameId, denyAccess, getServerAccess } = require('../utils/access');
const { evictFromServer } = require('../utils/realtime');

const router = express.Router();
useIdParams(router, 'serverId', 'userId');

const STAFF_PERMISSIONS = ['manageServer', 'manageRoles', 'kickMembers'];

// GET /api/admin/:serverId/stats
router.get('/:serverId/stats', auth, async (req, res) => {
  try {
    const access = await getServerAccess(req.params.serverId, req.userId, 'manageServer');
    if (access.error) return denyAccess(res, access);
    const { server } = access;

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

// GET /api/admin/:serverId/members - staff only, never exposes email addresses
router.get('/:serverId/members', auth, async (req, res) => {
  try {
    const access = await getServerAccess(req.params.serverId, req.userId);
    if (access.error) return denyAccess(res, access);
    const { server, member } = access;

    if (!STAFF_PERMISSIONS.some(p => hasServerPermission(server, member, p))) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    await server.populate('members.user', 'username displayName avatar status createdAt');
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

    const access = await getServerAccess(req.params.serverId, req.userId, 'manageRoles');
    if (access.error) return denyAccess(res, access);
    const { server, member: requester } = access;

    const target = server.members.find(m => sameId(m.user, req.params.userId));
    if (!target) return res.status(404).json({ error: 'Member not found' });
    if (target.role === 'owner') return res.status(400).json({ error: 'Cannot change owner role' });
    // Only the owner may promote someone to admin or change another admin
    if (requester.role !== 'owner' && (role === 'admin' || target.role === 'admin')) {
      return res.status(403).json({ error: 'Only the owner can manage admins' });
    }

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
    const access = await getServerAccess(req.params.serverId, req.userId, 'kickMembers');
    if (access.error) return denyAccess(res, access);
    const { server, member: requester } = access;

    const target = server.members.find(m => sameId(m.user, req.params.userId));
    if (!target) return res.status(404).json({ error: 'Member not found' });
    if (target.role === 'owner') return res.status(400).json({ error: 'Cannot kick owner' });
    if (sameId(target.user, req.userId)) return res.status(400).json({ error: 'Use leave server instead' });
    if (requester.role !== 'owner' && target.role === 'admin') {
      return res.status(403).json({ error: 'Only the owner can kick admins' });
    }

    server.members = server.members.filter(m => !sameId(m.user, req.params.userId));
    await server.save();
    await User.findByIdAndUpdate(req.params.userId, { $pull: { servers: server._id } });
    await AuditLog.create({
      server: server._id, action: 'member_kick', user: req.userId, target: req.params.userId
    });

    const io = req.app.get('io');
    io.to(`user:${req.params.userId}`).emit('server:kicked', { serverId: server._id });
    evictFromServer(io, req.params.userId, server);
    res.json({ message: 'Member kicked' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to kick member' });
  }
});

// GET /api/admin/:serverId/audit-log
router.get('/:serverId/audit-log', auth, async (req, res) => {
  try {
    const access = await getServerAccess(req.params.serverId, req.userId, 'manageServer');
    if (access.error) return denyAccess(res, access);

    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 50, maxLimit: 100 });
    const logs = await AuditLog.find({ server: access.server._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .populate('user', 'username displayName avatar');
    const total = await AuditLog.countDocuments({ server: access.server._id });
    res.json({ logs, total, hasMore: total > page * limit });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// PATCH /api/admin/:serverId/settings
router.patch('/:serverId/settings', auth, async (req, res) => {
  try {
    const access = await getServerAccess(req.params.serverId, req.userId, 'manageServer');
    if (access.error) return denyAccess(res, access);
    const { server } = access;

    const settings = sanitizeServerSettings(req.body.settings);
    if (settings.defaultChannel && !server.channels.some(c => sameId(c, settings.defaultChannel))) {
      return res.status(400).json({ error: 'Default channel must belong to this server' });
    }
    Object.assign(server.settings, settings);
    await server.save();
    await AuditLog.create({
      server: server._id, action: 'settings_update', user: req.userId,
      details: { updated: Object.keys(settings) }
    });
    res.json({ settings: server.settings });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

module.exports = router;
