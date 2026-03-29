const Server = require('../models/Server');

const roleCheck = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      const serverId = req.params.serverId || req.body.serverId;
      if (!serverId) {
        return res.status(400).json({ error: 'Server ID required' });
      }

      const server = await Server.findById(serverId);
      if (!server) {
        return res.status(404).json({ error: 'Server not found' });
      }

      const member = server.members.find(
        m => m.user.toString() === req.userId.toString()
      );

      if (!member) {
        return res.status(403).json({ error: 'Not a member of this server' });
      }

      if (!allowedRoles.includes(member.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      req.server = server;
      req.memberRole = member.role;
      next();
    } catch (error) {
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
};

module.exports = roleCheck;
