const jwt = require('jsonwebtoken');
const User = require('../models/User');

const onlineUsers = new Map(); // userId -> Set of socketIds

const setupSocket = (io) => {
  // Auth middleware for socket
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication required'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password -twoFactorSecret');
      if (!user) return next(new Error('User not found'));
      socket.userId = user._id.toString();
      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;
    console.log(`⚡ User connected: ${socket.user.username} (${userId})`);

    // Track online status
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socket.id);

    // Update user status
    await User.findByIdAndUpdate(userId, { status: 'online' });

    // Join personal room for DMs/notifications
    socket.join(`user:${userId}`);

    // Broadcast online status
    io.emit('presence:changed', { userId, status: 'online' });

    // Join server rooms
    socket.on('server:join', ({ serverId }) => {
      socket.join(`server:${serverId}`);
    });

    // Join channel room
    socket.on('channel:join', ({ channelId }) => {
      socket.join(`channel:${channelId}`);
    });

    socket.on('channel:leave', ({ channelId }) => {
      socket.leave(`channel:${channelId}`);
    });

    // Call signaling
    socket.on('call:join', ({ channelId }) => {
      const room = `call:${channelId}`;
      socket.join(room);
      socket.to(room).emit('call:user-joined', {
        userId,
        user: {
          username: socket.user.username,
          displayName: socket.user.displayName,
          avatar: socket.user.avatar
        }
      });
      socket.data.callRoom = room;
    });

    socket.on('call:offer', ({ channelId, targetUserId, sdp }) => {
      const room = `call:${channelId}`;
      socket.to(room).emit('call:offer', { userId, sdp, targetUserId });
    });

    socket.on('call:answer', ({ channelId, targetUserId, sdp }) => {
      const room = `call:${channelId}`;
      socket.to(room).emit('call:answer', { userId, sdp, targetUserId });
    });

    socket.on('call:ice', ({ channelId, targetUserId, candidate }) => {
      const room = `call:${channelId}`;
      socket.to(room).emit('call:ice', { userId, candidate, targetUserId });
    });

    socket.on('call:state', ({ channelId, state }) => {
      const room = `call:${channelId}`;
      socket.to(room).emit('call:state', { userId, state });
    });

    socket.on('call:leave', ({ channelId }) => {
      const room = `call:${channelId}`;
      socket.leave(room);
      socket.to(room).emit('call:user-left', { userId });
      if (socket.data.callRoom === room) socket.data.callRoom = null;
    });

    // Typing indicators
    socket.on('typing:start', ({ channelId }) => {
      socket.to(`channel:${channelId}`).emit('typing:update', {
        userId, username: socket.user.username, channelId, isTyping: true
      });
    });

    socket.on('typing:stop', ({ channelId }) => {
      socket.to(`channel:${channelId}`).emit('typing:update', {
        userId, username: socket.user.username, channelId, isTyping: false
      });
    });

    // Status update
    socket.on('presence:update', async ({ status }) => {
      if (['online', 'away', 'dnd', 'offline'].includes(status)) {
        await User.findByIdAndUpdate(userId, { status });
        io.emit('presence:changed', { userId, status });
      }
    });

    // Get online users
    socket.on('presence:get', (callback) => {
      const online = {};
      onlineUsers.forEach((sockets, uid) => {
        if (sockets.size > 0) online[uid] = 'online';
      });
      if (typeof callback === 'function') callback(online);
    });

    // Disconnect
    socket.on('disconnect', async () => {
      console.log(`💤 User disconnected: ${socket.user.username}`);
      if (socket.data.callRoom) {
        socket.to(socket.data.callRoom).emit('call:user-left', { userId });
      }
      const userSockets = onlineUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          onlineUsers.delete(userId);
          await User.findByIdAndUpdate(userId, { status: 'offline' });
          io.emit('presence:changed', { userId, status: 'offline' });
        }
      }
    });
  });
};

module.exports = { setupSocket, onlineUsers };
