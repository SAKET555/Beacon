const User = require('../models/User');
const Channel = require('../models/Channel');

// Presence is only sent to people who share a server or DM with the user,
// instead of every connected socket.
const broadcastPresence = async (io, userId, status) => {
  try {
    const user = await User.findById(userId).select('servers');
    const dmChannels = await Channel.find({ type: 'dm', participants: userId }).select('participants');

    const rooms = new Set([`user:${userId}`]);
    (user?.servers || []).forEach(id => rooms.add(`server:${id}`));
    dmChannels.forEach(dm => dm.participants.forEach(p => rooms.add(`user:${p}`)));

    io.to([...rooms]).emit('presence:changed', { userId, status });
  } catch (error) {
    console.error('Presence broadcast failed:', error.message);
  }
};

// Removes all of a user's live sockets from a server's rooms (kick / leave).
const evictFromServer = (io, userId, server) => {
  const rooms = [`server:${server._id}`];
  (server.channels || []).forEach(channelId => {
    rooms.push(`channel:${channelId}`, `call:${channelId}`);
  });
  io.in(`user:${userId}`).socketsLeave(rooms);
};

module.exports = { broadcastPresence, evictFromServer };
