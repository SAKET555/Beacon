import { useEffect, useRef, useState, useCallback } from 'react';
import { Hash, Users, Pin, Search, Star, Phone, Video } from 'lucide-react';
import useMessageStore from '../store/messageStore';
import useChannelStore from '../store/channelStore';
import useUIStore from '../store/uiStore';
import { getSocket } from '../services/socket';
import MessageItem from './MessageItem';
import MessageInput from './MessageInput';
import { shouldShowDivider, formatDateDivider } from '../utils/helpers';

export default function ChatArea({ channel, server, user, onlineUsers }) {
  const { messages, hasMore, loading, fetchMessages, clearMessages } = useMessageStore();
  const { markAsRead, fetchReadState, readBy } = useChannelStore();
  const { toggleMemberPanel, toggleSearchModal, togglePinnedMessages, toggleStarredMessages, openCall } = useUIStore();
  const messagesEndRef = useRef(null);
  const containerRef = useRef(null);
  const [page, setPage] = useState(1);
  const [autoScroll, setAutoScroll] = useState(true);
  const [typingUsers, setTypingUsers] = useState([]);

  useEffect(() => {
    if (channel?._id) {
      clearMessages();
      setPage(1);
      setAutoScroll(true);
      fetchMessages(channel._id, 1);
      markAsRead(channel._id);
      fetchReadState(channel._id);
    }
  }, [channel?._id]);

  useEffect(() => {
    if (autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      if (channel?._id) markAsRead(channel._id);
    }
  }, [messages]);

  // Socket typing listeners
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleTyping = ({ userId, username, channelId, isTyping }) => {
      if (channelId !== channel?._id || userId === user?._id) return;
      setTypingUsers(prev => {
        if (isTyping) {
          if (prev.find(u => u.userId === userId)) return prev;
          return [...prev, { userId, username }];
        }
        return prev.filter(u => u.userId !== userId);
      });
    };

    socket.on('typing:update', handleTyping);
    return () => socket.off('typing:update', handleTyping);
  }, [channel?._id, user?._id]);

  // Clear typing after 3s timeout
  useEffect(() => {
    if (typingUsers.length === 0) return;
    const timer = setTimeout(() => setTypingUsers([]), 3000);
    return () => clearTimeout(timer);
  }, [typingUsers]);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 100);
    if (scrollTop < 50 && hasMore && !loading) {
      setPage(p => p + 1);
      fetchMessages(channel._id, page + 1);
    }
  }, [hasMore, loading, page, channel?._id]);

  return (
    <div className="flex-1 flex flex-col bg-beacon-chat min-w-0">
      {/* Channel header */}
      <div className="min-h-[48px] px-3 sm:px-4 py-2 sm:py-0 flex items-center justify-between border-b border-beacon-border bg-beacon-chat/80 backdrop-blur-sm">
        <div className="flex items-center gap-2 min-w-0">
          <Hash size={20} className="text-text-muted shrink-0" />
          <h3 className="font-semibold text-text-primary truncate">{channel?.name}</h3>
          {channel?.topic && (
            <>
              <div className="w-px h-4 bg-beacon-border mx-1 shrink-0" />
              <p className="text-sm text-text-muted truncate">{channel.topic}</p>
            </>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 overflow-x-auto max-w-[60%] sm:max-w-none">
          <button onClick={() => openCall(channel?._id, 'audio')}
            className="p-1.5 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-beacon-hover">
            <Phone size={18} />
          </button>
          <button onClick={() => openCall(channel?._id, 'video')}
            className="p-1.5 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-beacon-hover">
            <Video size={18} />
          </button>
          <button onClick={togglePinnedMessages}
            className="p-1.5 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-beacon-hover">
            <Pin size={18} />
          </button>
          <button onClick={toggleStarredMessages}
            className="p-1.5 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-beacon-hover">
            <Star size={18} />
          </button>
          <button onClick={toggleSearchModal}
            className="p-1.5 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-beacon-hover">
            <Search size={18} />
          </button>
          <button onClick={toggleMemberPanel}
            className="p-1.5 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-beacon-hover">
            <Users size={18} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={containerRef} onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-2">
        {loading && page === 1 && (
          <div className="space-y-4 py-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex gap-3 animate-pulse">
                <div className="w-10 h-10 rounded-full skeleton shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 skeleton w-32" />
                  <div className="h-3 skeleton w-3/4" />
                  <div className="h-3 skeleton w-1/2" />
                </div>
              </div>
            ))}
          </div>
        )}

        {hasMore && !loading && (
          <div className="text-center py-2">
            <div className="text-xs text-text-muted">Loading more messages...</div>
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-2xl bg-beacon-hover flex items-center justify-center mb-4">
              <Hash size={32} className="text-text-muted" />
            </div>
            <h3 className="text-xl font-bold text-text-primary mb-1">Welcome to #{channel?.name}!</h3>
            <p className="text-text-muted text-sm">This is the beginning of the channel. Send the first message!</p>
          </div>
        )}

        {messages.map((message, index) => (
          <div key={message._id}>
            {shouldShowDivider(message.createdAt, messages[index - 1]?.createdAt) && (
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-beacon-border" />
                <span className="text-xs text-text-muted font-medium">{formatDateDivider(message.createdAt)}</span>
                <div className="flex-1 h-px bg-beacon-border" />
              </div>
            )}
            <MessageItem
              message={message}
              user={user}
              channel={channel}
              server={server}
              readBy={readBy}
              isLast={index === messages.length - 1}
            />
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Typing indicator */}
      {typingUsers.length > 0 && (
        <div className="px-4 py-1 text-xs text-text-muted animate-pulse-soft">
          <span className="font-medium text-text-secondary">
            {typingUsers.map(u => u.username).join(', ')}
          </span>
          {typingUsers.length === 1 ? ' is' : ' are'} typing...
        </div>
      )}

      {/* Message input */}
      <MessageInput channel={channel} user={user} />
    </div>
  );
}
