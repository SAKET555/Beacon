const User = require('../models/User');
const Server = require('../models/Server');
const { authenticateToken } = require('../utils/token');
const { isId } = require('../utils/http');
const { getServerAccess, getChannelAccess } = require('../utils/access');
const { broadcastPresence } = require('../utils/realtime');

const onlineUsers = new Map(); // userId -> Set of socketIds

// Wraps a handler so a bad payload or a thrown error can't crash the process.
const safe = (handler) => async (payload, ...rest) => {
  try {
    await handler(payload && typeof payload === 'object' ? payload : {}, ...rest);
  } catch (error) {
    console.error('Socket handler error:', error.message);
  }
};

const setupSocket = (io) => {
  // Auth middleware for socket
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required'));
      const user = await authenticateToken(token);
      socket.userId = user._id.toString();
      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication failed'));
    }
  });

  // Synchronous on purpose: every socket.on below must be registered in the same
  // tick as the connection, or events the client emits right away are dropped.
  io.on('connection', (socket) => {
    const userId = socket.userId;
    console.log(`⚡ User connected: ${socket.user.username} (${userId})`);

    // Track online status
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socket.id);

    // Join personal room for DMs/notifications
    socket.join(`user:${userId}`);

    // Async setup runs in the background (not awaited, see note above)
    (async () => {
      try {
        // Join rooms for every server the user really belongs to (presence + server events)
        const servers = await Server.find({ 'members.user': userId }).select('_id');
        servers.forEach(s => socket.join(`server:${s._id}`));

        await User.findByIdAndUpdate(userId, { status: 'online' });
        await broadcastPresence(io, userId, 'online');
      } catch (error) {
        console.error('Socket connection setup failed:', error.message);
      }
    })();

    // Join server rooms (membership checked)
    socket.on('server:join', safe(async ({ serverId }) => {
      if (!isId(serverId)) return;
      const access = await getServerAccess(serverId, userId);
      if (!access.error) socket.join(`server:${serverId}`);
    }));

    // Join channel room (membership / DM participation checked)
    socket.on('channel:join', safe(async ({ channelId }) => {
      if (!isId(channelId)) return;
      const access = await getChannelAccess(channelId, userId);
      if (!access.error) socket.join(`channel:${channelId}`);
    }));

    socket.on('channel:leave', safe(({ channelId }) => {
      if (isId(channelId)) socket.leave(`channel:${channelId}`);
    }));

    // Call signaling: only sockets that passed call:join may signal into a call room
    const inCall = (channelId) => isId(channelId) && socket.data.callRoom === `call:${channelId}`;

    socket.on('call:join', safe(async ({ channelId }) => {
      if (!isId(channelId)) return;
      // DM channels skip the permission check; server channels need connectVoice
      const access = await getChannelAccess(channelId, userId, 'connectVoice');
      if (access.error) return;

      const room = `call:${channelId}`;
      if (socket.data.callRoom && socket.data.callRoom !== room) {
        socket.to(socket.data.callRoom).emit('call:user-left', { userId });
        socket.leave(socket.data.callRoom);
      }
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
    }));

    socket.on('call:offer', safe(({ channelId, targetUserId, sdp }) => {
      if (!inCall(channelId)) return;
      socket.to(`call:${channelId}`).emit('call:offer', { userId, sdp, targetUserId });
    }));

    socket.on('call:answer', safe(({ channelId, targetUserId, sdp }) => {
      if (!inCall(channelId)) return;
      socket.to(`call:${channelId}`).emit('call:answer', { userId, sdp, targetUserId });
    }));

    socket.on('call:ice', safe(({ channelId, targetUserId, candidate }) => {
      if (!inCall(channelId)) return;
      socket.to(`call:${channelId}`).emit('call:ice', { userId, candidate, targetUserId });
    }));

    socket.on('call:state', safe(({ channelId, state }) => {
      if (!inCall(channelId)) return;
      socket.to(`call:${channelId}`).emit('call:state', { userId, state });
    }));

    socket.on('call:leave', safe(({ channelId }) => {
      if (!inCall(channelId)) return;
      const room = `call:${channelId}`;
      socket.leave(room);
      socket.to(room).emit('call:user-left', { userId });
      socket.data.callRoom = null;
    }));

    // Typing indicators: only for channels this socket has joined
    const emitTyping = (channelId, isTyping) => {
      const room = `channel:${channelId}`;
      if (!isId(channelId) || !socket.rooms.has(room)) return;
      socket.to(room).emit('typing:update', {
        userId, username: socket.user.username, channelId, isTyping
      });
    };

    socket.on('typing:start', safe(({ channelId }) => emitTyping(channelId, true)));
    socket.on('typing:stop', safe(({ channelId }) => emitTyping(channelId, false)));

    // Status update
    socket.on('presence:update', safe(async ({ status }) => {
      if (['online', 'away', 'dnd', 'offline'].includes(status)) {
        await User.findByIdAndUpdate(userId, { status });
        await broadcastPresence(io, userId, status);
      }
    }));

    // Get online users
    socket.on('presence:get', (callback) => {
      const online = {};
      onlineUsers.forEach((sockets, uid) => {
        if (sockets.size > 0) online[uid] = 'online';
      });
      if (typeof callback === 'function') callback(online);
    });

    // Disconnect
    socket.on('disconnect', safe(async () => {
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
          await broadcastPresence(io, userId, 'offline');
        }
      }
    }));
  });
};

module.exports = { setupSocket, onlineUsers };
