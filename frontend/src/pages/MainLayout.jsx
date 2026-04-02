import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../services/socket';
import useAuthStore from '../store/authStore';
import useServerStore from '../store/serverStore';
import useChannelStore from '../store/channelStore';
import useMessageStore from '../store/messageStore';
import useNotificationStore from '../store/notificationStore';
import useUIStore from '../store/uiStore';
import ServerSidebar from '../components/ServerSidebar';
import ChannelSidebar from '../components/ChannelSidebar';
import ChatArea from '../components/ChatArea';
import MembersPanel from '../components/MembersPanel';
import CreateServerModal from '../components/modals/CreateServerModal';
import CreateChannelModal from '../components/modals/CreateChannelModal';
import InviteModal from '../components/modals/InviteModal';
import SearchModal from '../components/modals/SearchModal';
import UserSettingsModal from '../components/modals/UserSettingsModal';
import ServerSettingsModal from '../components/modals/ServerSettingsModal';
import PinnedMessagesModal from '../components/modals/PinnedMessagesModal';
import StarredMessagesModal from '../components/modals/StarredMessagesModal';
import ThreadModal from '../components/modals/ThreadModal';
import FilePreviewModal from '../components/modals/FilePreviewModal';
import CallModal from '../components/modals/CallModal';
import { registerPush } from '../services/push';
import { Menu } from 'lucide-react';

export default function MainLayout() {
  const { initSocket, user, setLocalStatus, updateStatus } = useAuthStore();
  const { fetchServers, servers, currentServer, setCurrentServer, fetchServer } = useServerStore();
  const { fetchChannels, channels, currentChannel, setCurrentChannel, addChannel, removeChannel, updateReadState } = useChannelStore();
  const { addMessage, updateMessage, removeMessage, updateReactions, updatePinned } = useMessageStore();
  const { addNotification } = useNotificationStore();
  const { showMemberPanel, showCreateServer, showCreateChannel, showInviteModal,
    showSearchModal, showUserSettings, showServerSettings, showPinnedMessages,
    showStarredMessages, threadParent, callRoom, callMode, mobileSidebarOpen, toggleMobileSidebar } = useUIStore();
  const [onlineUsers, setOnlineUsers] = useState({});
  const idleTimerRef = useRef(null);
  const lastStatusRef = useRef(user?.status || 'online');

  useEffect(() => {
    if (user?.status) lastStatusRef.current = user.status;
  }, [user?.status]);

  useEffect(() => {
    initSocket();
    fetchServers();
    if (user?._id) {
      registerPush();
    }

    const socket = getSocket();
    if (!socket) return;

    // Presence
    socket.emit('presence:get', (online) => setOnlineUsers(online));
    socket.on('presence:changed', ({ userId, status }) => {
      setOnlineUsers(prev => ({ ...prev, [userId]: status }));
      if (userId === user?._id) setLocalStatus(status);
    });

    // Messages
    socket.on('message:new', ({ message }) => addMessage(message));
    socket.on('message:edited', ({ message }) => updateMessage(message));
    socket.on('message:deleted', ({ messageId }) => removeMessage(messageId));
    socket.on('message:reacted', ({ messageId, reactions }) => updateReactions(messageId, reactions));
    socket.on('message:pinned', ({ messageId, isPinned }) => updatePinned(messageId, isPinned));

    // Channels
    socket.on('channel:created', ({ channel }) => addChannel(channel));
    socket.on('channel:deleted', ({ channelId }) => removeChannel(channelId));

    // Notifications
    socket.on('notification:new', ({ notification }) => addNotification(notification));

    socket.on('channel:read', ({ channelId, userId, user, lastRead }) => {
      if (currentChannel?._id !== channelId) return;
      updateReadState({ userId, user, lastRead });
    });

    // Server events
    socket.on('server:kicked', ({ serverId }) => {
      if (currentServer?._id === serverId) {
        setCurrentServer(null);
        setCurrentChannel(null);
      }
      fetchServers();
    });

    return () => {
      socket.off('presence:changed');
      socket.off('message:new');
      socket.off('message:edited');
      socket.off('message:deleted');
      socket.off('message:reacted');
      socket.off('message:pinned');
      socket.off('channel:created');
      socket.off('channel:deleted');
      socket.off('notification:new');
      socket.off('channel:read');
      socket.off('server:kicked');
    };
  }, [user?._id]);

  useEffect(() => {
    if (!user?._id) return;

    const setStatus = (status) => {
      if (lastStatusRef.current === 'dnd' && status !== 'dnd') return;
      if (lastStatusRef.current === status) return;
      lastStatusRef.current = status;
      setLocalStatus(status);
      const socket = getSocket();
      if (socket?.connected) {
        socket.emit('presence:update', { status });
      } else {
        updateStatus(status);
      }
    };

    const resetIdleTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        if (!document.hidden) setStatus('away');
      }, 5 * 60 * 1000);
    };

    const handleActivity = () => {
      if (!document.hidden) {
        setStatus('online');
        resetIdleTimer();
      }
    };

    const handleVisibility = () => {
      if (document.hidden) setStatus('away');
      else handleActivity();
    };

    setStatus('online');
    resetIdleTimer();

    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    activityEvents.forEach(evt => window.addEventListener(evt, handleActivity, { passive: true }));
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      activityEvents.forEach(evt => window.removeEventListener(evt, handleActivity));
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user?._id]);

  // When server changes, fetch channels
  useEffect(() => {
    if (currentServer) {
      fetchChannels(currentServer._id);
      const socket = getSocket();
      if (socket) socket.emit('server:join', { serverId: currentServer._id });
    }
  }, [currentServer?._id]);

  // Auto-select first channel
  useEffect(() => {
    if (channels.length > 0 && !currentChannel) {
      setCurrentChannel(channels[0]);
    }
  }, [channels]);

  // Join channel room
  useEffect(() => {
    if (currentChannel) {
      const socket = getSocket();
      if (socket) socket.emit('channel:join', { channelId: currentChannel._id });
      return () => {
        if (socket) socket.emit('channel:leave', { channelId: currentChannel._id });
      };
    }
  }, [currentChannel?._id]);

  const handleSelectServer = async (server) => {
    setCurrentChannel(null);
    const full = await fetchServer(server._id);
    if (full) setCurrentServer(full);
  };

  return (
    <div className="h-screen flex overflow-hidden bg-beacon-bg">
      {/* Mobile menu button */}
      <button onClick={toggleMobileSidebar}
        className="lg:hidden fixed top-3 left-3 z-50 p-2 rounded-xl bg-beacon-sidebar border border-beacon-border text-text-primary">
        <Menu size={20} />
      </button>

      {/* Server sidebar */}
      <div className={`${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 fixed lg:static inset-y-0 left-0 z-40 transition-transform duration-300`}>
        <ServerSidebar servers={servers} currentServer={currentServer}
          onSelect={handleSelectServer} onlineUsers={onlineUsers} />
      </div>

      {/* Channel sidebar */}
      {currentServer && (
        <div className={`${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 fixed lg:static inset-y-0 left-0 lg:left-[72px] z-30 transition-transform duration-300`}>
          <ChannelSidebar server={currentServer} channels={channels}
            currentChannel={currentChannel} onSelectChannel={setCurrentChannel}
            user={user} />
        </div>
      )}

      {/* Overlay for mobile */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={toggleMobileSidebar} />
      )}

      {/* Chat area */}
      <div className="flex-1 flex min-w-0">
        {currentChannel ? (
          <ChatArea channel={currentChannel} server={currentServer}
            user={user} onlineUsers={onlineUsers} />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-beacon-chat">
            <div className="text-center animate-fade-in">
              <div className="w-24 h-24 bg-gradient-to-br from-beacon-accent to-emerald-400 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-beacon-accent/30">
                <span className="text-4xl font-extrabold text-white">B</span>
              </div>
              <h2 className="text-2xl font-bold text-text-primary mb-2">Royal Beacon</h2>
              <p className="text-text-muted max-w-sm">
                {servers.length === 0
                  ? 'Create or join a server to get started!'
                  : 'Select a server and channel to start chatting'}
              </p>
            </div>
          </div>
        )}

        {/* Members panel */}
        {showMemberPanel && currentServer && currentChannel && (
          <MembersPanel server={currentServer} onlineUsers={onlineUsers} />
        )}
      </div>

      {/* Modals */}
      {showCreateServer && <CreateServerModal />}
      {showCreateChannel && currentServer && <CreateChannelModal serverId={currentServer._id} />}
      {showInviteModal && currentServer && <InviteModal server={currentServer} />}
      {showSearchModal && currentChannel && <SearchModal channelId={currentChannel._id} />}
      {showUserSettings && <UserSettingsModal />}
      {showServerSettings && currentServer && <ServerSettingsModal server={currentServer} />}
      {showPinnedMessages && currentChannel && (
        <PinnedMessagesModal channel={currentChannel} user={user} server={currentServer} />
      )}
      {showStarredMessages && <StarredMessagesModal user={user} />}
      {threadParent && currentChannel && (
        <ThreadModal channel={currentChannel} user={user} server={currentServer} />
      )}
      {callRoom && currentChannel && (
        <CallModal channel={currentChannel} user={user} mode={callMode} />
      )}
      <FilePreviewModal />
    </div>
  );
}
