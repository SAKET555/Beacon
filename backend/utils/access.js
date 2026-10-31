const Server = require('../models/Server');
const Channel = require('../models/Channel');
const Message = require('../models/Message');
const { ensureServerRoles, hasServerPermission } = require('./permissions');

const sameId = (a, b) => a.toString() === b.toString();

const findMember = (server, userId) => server.members.find(m => sameId(m.user, userId));

// Each helper returns either { error, status } or the loaded documents.
// Callers: `const access = await getX(...); if (access.error) return denyAccess(res, access);`
const denyAccess = (res, access) => res.status(access.status).json({ error: access.error });

const getServerAccess = async (serverId, userId, permission) => {
  const server = await Server.findById(serverId);
  if (!server) return { status: 404, error: 'Server not found' };

  const member = findMember(server, userId);
  if (!member) return { status: 403, error: 'Not a member of this server' };

  ensureServerRoles(server);
  if (permission && !hasServerPermission(server, member, permission)) {
    return { status: 403, error: 'Insufficient permissions' };
  }
  return { server, member };
};

// Works for server channels (membership + viewChannels) and DMs (participants only).
const getChannelAccess = async (channelId, userId, permission) => {
  const channel = await Channel.findById(channelId);
  if (!channel) return { status: 404, error: 'Channel not found' };

  if (!channel.server) {
    if (!channel.participants.some(p => sameId(p, userId))) {
      return { status: 403, error: 'No access to this channel' };
    }
    return { channel, server: null, member: null };
  }

  const access = await getServerAccess(channel.server, userId);
  if (access.error) return access;

  const { server, member } = access;
  if (!hasServerPermission(server, member, 'viewChannels')) {
    return { status: 403, error: 'No access to this channel' };
  }
  if (permission && !hasServerPermission(server, member, permission)) {
    return { status: 403, error: 'Insufficient permissions' };
  }
  return { channel, server, member };
};

const getMessageAccess = async (messageId, userId, permission) => {
  const message = await Message.findById(messageId);
  if (!message) return { status: 404, error: 'Message not found' };

  const access = await getChannelAccess(message.channel, userId, permission);
  if (access.error) return access;
  return { message, ...access };
};

module.exports = {
  sameId,
  findMember,
  denyAccess,
  getServerAccess,
  getChannelAccess,
  getMessageAccess
};
