const express = require('express');
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');
const Server = require('../models/Server');
const Channel = require('../models/Channel');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { DEFAULT_PERMISSIONS, ensureServerRoles, getMemberPermissions, hasServerPermission } = require('../utils/permissions');

const router = express.Router();

// GET /api/servers - Get user's servers
router.get('/', auth, async (req, res) => {
  try {
    const servers = await Server.find({
      'members.user': req.userId
    }).select('name icon description members inviteCode');

    res.json({ servers });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch servers' });
  }
});

// POST /api/servers - Create a server
router.post('/', auth, [
  body('name').isLength({ min: 1, max: 64 }).trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, description, icon } = req.body;

    const server = new Server({
      name,
      description: description || '',
      icon: icon || '',
      owner: req.userId,
      members: [{ user: req.userId, role: 'owner' }]
    });
    ensureServerRoles(server);
    await server.save();

    // Create default general channel
    const generalChannel = new Channel({
      name: 'general',
      type: 'text',
      server: server._id,
      topic: 'General discussion'
    });
    await generalChannel.save();

    // Create announcements channel
    const announcementsChannel = new Channel({
      name: 'announcements',
      type: 'announcement',
      server: server._id,
      topic: 'Server announcements'
    });
    await announcementsChannel.save();

    server.channels = [generalChannel._id, announcementsChannel._id];
    server.settings.defaultChannel = generalChannel._id;
    await server.save();

    // Add server to user's servers list
    await User.findByIdAndUpdate(req.userId, {
      $addToSet: { servers: server._id }
    });

    await server.populate('members.user', 'username displayName avatar status');

    res.status(201).json({ server });
  } catch (error) {
    console.error('Create server error:', error);
    res.status(500).json({ error: 'Failed to create server' });
  }
});

// GET /api/servers/:id - Get server details
router.get('/:id', auth, async (req, res) => {
  try {
    const server = await Server.findById(req.params.id)
      .populate('members.user', 'username displayName avatar status')
      .populate('channels', 'name type topic');

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const isMember = server.members.some(
      m => m.user._id.toString() === req.userId.toString()
    );
    if (!isMember && !server.settings.isPublic) {
      return res.status(403).json({ error: 'Not a member of this server' });
    }

    const changed = ensureServerRoles(server);
    if (changed) await server.save();

    res.json({ server });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch server' });
  }
});

// PATCH /api/servers/:id - Update server
router.patch('/:id', auth, async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    ensureServerRoles(server);
    const member = server.members.find(m => m.user.toString() === req.userId.toString());
    if (!member || !hasServerPermission(server, member, 'manageServer')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const allowed = ['name', 'description', 'icon', 'banner'];
    allowed.forEach(field => {
      if (req.body[field] !== undefined) server[field] = req.body[field];
    });

    if (req.body.settings) {
      Object.assign(server.settings, req.body.settings);
    }

    await server.save();

    // Log audit
    await AuditLog.create({
      server: server._id,
      action: 'server_update',
      user: req.userId,
      target: 'Server',
      details: { updated: Object.keys(req.body) }
    });

    res.json({ server });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update server' });
  }
});

// DELETE /api/servers/:id - Delete server
router.delete('/:id', auth, async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }
    if (server.owner.toString() !== req.userId.toString()) {
      return res.status(403).json({ error: 'Only the owner can delete the server' });
    }

    // Remove server from all members
    await User.updateMany(
      { servers: server._id },
      { $pull: { servers: server._id } }
    );

    // Delete all channels
    await Channel.deleteMany({ server: server._id });

    await Server.findByIdAndDelete(server._id);

    res.json({ message: 'Server deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete server' });
  }
});

// POST /api/servers/:id/join - Join a server
router.post('/:id/join', auth, async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const isMember = server.members.some(
      m => m.user.toString() === req.userId.toString()
    );
    if (isMember) {
      return res.status(400).json({ error: 'Already a member' });
    }

    server.members.push({ user: req.userId, role: 'member' });
    await server.save();

    await User.findByIdAndUpdate(req.userId, {
      $addToSet: { servers: server._id }
    });

    await server.populate('members.user', 'username displayName avatar status');

    // Notify via socket
    const io = req.app.get('io');
    io.to(`server:${server._id}`).emit('server:member_joined', {
      serverId: server._id,
      userId: req.userId
    });

    res.json({ server });
  } catch (error) {
    res.status(500).json({ error: 'Failed to join server' });
  }
});

// POST /api/servers/join/invite/:code - Join by invite code
router.post('/join/invite/:code', auth, async (req, res) => {
  try {
    const server = await Server.findOne({ inviteCode: req.params.code });
    if (!server) {
      return res.status(404).json({ error: 'Invalid invite code' });
    }

    const isMember = server.members.some(
      m => m.user.toString() === req.userId.toString()
    );
    if (isMember) {
      return res.status(400).json({ error: 'Already a member' });
    }

    server.members.push({ user: req.userId, role: 'member' });
    await server.save();

    await User.findByIdAndUpdate(req.userId, {
      $addToSet: { servers: server._id }
    });

    await server.populate('members.user', 'username displayName avatar status');

    res.json({ server });
  } catch (error) {
    res.status(500).json({ error: 'Failed to join server' });
  }
});

// POST /api/servers/:id/leave - Leave a server
router.post('/:id/leave', auth, async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    if (server.owner.toString() === req.userId.toString()) {
      return res.status(400).json({ error: 'Owner cannot leave. Transfer ownership or delete the server.' });
    }

    server.members = server.members.filter(
      m => m.user.toString() !== req.userId.toString()
    );
    await server.save();

    await User.findByIdAndUpdate(req.userId, {
      $pull: { servers: server._id }
    });

    const io = req.app.get('io');
    io.to(`server:${server._id}`).emit('server:member_left', {
      serverId: server._id,
      userId: req.userId
    });

    res.json({ message: 'Left server' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to leave server' });
  }
});

// GET /api/servers/:id/members - Get server members
router.get('/:id/members', auth, async (req, res) => {
  try {
    const server = await Server.findById(req.params.id)
      .populate('members.user', 'username displayName avatar status customStatus');

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const changed = ensureServerRoles(server);
    if (changed) await server.save();

    res.json({ members: server.members });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// GET /api/servers/:id/roles - Get server roles and current user's permissions
router.get('/:id/roles', auth, async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const changed = ensureServerRoles(server);
    if (changed) await server.save();

    const member = server.members.find(m => m.user.toString() === req.userId.toString());
    if (!member) {
      return res.status(403).json({ error: 'Not a member of this server' });
    }

    const permissions = getMemberPermissions(server, member);

    res.json({
      roles: (server.roles || []).sort((a, b) => (b.position || 0) - (a.position || 0)),
      permissions,
      permissionKeys: Object.keys(DEFAULT_PERMISSIONS)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

// POST /api/servers/:id/roles - Create a custom role
router.post('/:id/roles', auth, async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    ensureServerRoles(server);
    const member = server.members.find(m => m.user.toString() === req.userId.toString());
    if (!member || !hasServerPermission(server, member, 'manageRoles')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const roleName = (req.body.name || '').trim();
    if (!roleName) {
      return res.status(400).json({ error: 'Role name is required' });
    }

    const duplicate = server.roles.some(r => r.name.toLowerCase() === roleName.toLowerCase());
    if (duplicate) {
      return res.status(400).json({ error: 'Role name already exists' });
    }

    const maxPosition = Math.max(...server.roles.map(r => r.position || 0), 0);
    const role = {
      id: `role-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: roleName,
      color: req.body.color || '#8b5cf6',
      position: maxPosition + 1,
      isSystem: false,
      permissions: { ...DEFAULT_PERMISSIONS }
    };

    server.roles.push(role);
    await server.save();

    await AuditLog.create({
      server: server._id,
      action: 'role_create',
      user: req.userId,
      target: role.name,
      details: { roleId: role.id }
    });

    res.status(201).json({ role, roles: server.roles });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create role' });
  }
});

// PATCH /api/servers/:id/roles/:roleId - Update role metadata/permissions
router.patch('/:id/roles/:roleId', auth, async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    ensureServerRoles(server);
    const member = server.members.find(m => m.user.toString() === req.userId.toString());
    if (!member || !hasServerPermission(server, member, 'manageRoles')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const role = server.roles.find(r => r.id === req.params.roleId);
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    if (!role.isSystem && req.body.name !== undefined) {
      const nextName = req.body.name.trim();
      if (!nextName) {
        return res.status(400).json({ error: 'Role name cannot be empty' });
      }
      const duplicate = server.roles.some(r => r.id !== role.id && r.name.toLowerCase() === nextName.toLowerCase());
      if (duplicate) {
        return res.status(400).json({ error: 'Role name already exists' });
      }
      role.name = nextName;
    }

    if (req.body.color !== undefined) role.color = req.body.color;
    if (req.body.position !== undefined) role.position = Number(req.body.position) || 0;

    if (req.body.permissions && typeof req.body.permissions === 'object') {
      role.permissions = {
        ...DEFAULT_PERMISSIONS,
        ...role.permissions,
        ...req.body.permissions
      };
    }

    await server.save();

    await AuditLog.create({
      server: server._id,
      action: 'role_update',
      user: req.userId,
      target: role.name,
      details: { roleId: role.id }
    });

    res.json({ role, roles: server.roles });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// DELETE /api/servers/:id/roles/:roleId - Delete custom role
router.delete('/:id/roles/:roleId', auth, async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    ensureServerRoles(server);
    const member = server.members.find(m => m.user.toString() === req.userId.toString());
    if (!member || !hasServerPermission(server, member, 'manageRoles')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const role = server.roles.find(r => r.id === req.params.roleId);
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    if (role.isSystem) {
      return res.status(400).json({ error: 'System roles cannot be deleted' });
    }

    server.roles = server.roles.filter(r => r.id !== role.id);
    server.members.forEach(m => {
      m.roleIds = (m.roleIds || []).filter(id => id !== role.id);
    });

    await server.save();

    await AuditLog.create({
      server: server._id,
      action: 'role_delete',
      user: req.userId,
      target: role.name,
      details: { roleId: role.id }
    });

    res.json({ roles: server.roles });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete role' });
  }
});

// PATCH /api/servers/:id/members/:memberId/roles - Replace a member's role assignments
router.patch('/:id/members/:memberId/roles', auth, async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    ensureServerRoles(server);
    const actor = server.members.find(m => m.user.toString() === req.userId.toString());
    if (!actor || !hasServerPermission(server, actor, 'manageRoles')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const target = server.members.find(m => m.user.toString() === req.params.memberId);
    if (!target) {
      return res.status(404).json({ error: 'Member not found' });
    }
    if (target.role === 'owner') {
      return res.status(400).json({ error: 'Cannot change owner roles' });
    }

    const roleIds = Array.isArray(req.body.roleIds) ? req.body.roleIds : [];
    const allowedRoleIds = new Set(server.roles.map(r => r.id));
    target.roleIds = [...new Set(roleIds)].filter(id => allowedRoleIds.has(id));

    // Keep legacy field in sync for old code paths.
    const roleNames = target.roleIds
      .map(id => server.roles.find(r => r.id === id)?.name?.toLowerCase())
      .filter(Boolean);
    if (roleNames.includes('admin')) target.role = 'admin';
    else if (roleNames.includes('moderator')) target.role = 'moderator';
    else target.role = 'member';

    await server.save();

    res.json({ member: target, members: server.members });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update member roles' });
  }
});

module.exports = router;
