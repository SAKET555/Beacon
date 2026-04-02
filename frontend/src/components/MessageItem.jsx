import { useState } from 'react';
import { MoreHorizontal, Reply, Pin, Pencil, Trash2, Copy, Smile } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import useMessageStore from '../store/messageStore';
import useChannelStore from '../store/channelStore';
import useUIStore from '../store/uiStore';
import { formatTimestamp, isImageFile, isVideoFile, formatFileSize } from '../utils/helpers';
import toast from 'react-hot-toast';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '🔥', '👀'];

export default function MessageItem({ message, user, channel, server }) {
  const [showActions, setShowActions] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const { reactToMessage, deleteMessage } = useMessageStore();
  const { togglePin } = useChannelStore();
  const { setReplyingTo, setEditingMessage, setFilePreview } = useUIStore();

  if (message.isDeleted) {
    return (
      <div className="py-1 px-2 my-0.5 rounded-lg opacity-50">
        <p className="text-sm text-text-muted italic">This message was deleted</p>
      </div>
    );
  }

  const isOwn = message.author?._id === user?._id;

  const handleReaction = async (emoji) => {
    await reactToMessage(message._id, emoji);
    setShowReactionPicker(false);
  };

  const handleDelete = async () => {
    if (confirm('Delete this message?')) {
      await deleteMessage(message._id);
    }
  };

  const handlePin = async () => {
    const result = await togglePin(channel._id, message._id);
    if (result.success) {
      toast.success(result.pinned ? 'Message pinned!' : 'Message unpinned');
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/app?message=${message._id}`);
    toast.success('Message link copied!');
  };

  return (
    <div className="group relative py-1 px-2 my-0.5 rounded-lg message-hover"
      onMouseEnter={() => setShowActions(true)} onMouseLeave={() => { setShowActions(false); setShowReactionPicker(false); }}>

      {/* Reply reference */}
      {message.replyTo && (
        <div className="flex items-center gap-2 mb-1 pl-12 text-xs text-text-muted">
          <Reply size={12} className="rotate-180" />
          <span className="font-medium text-text-secondary">{message.replyTo?.author?.username}</span>
          <span className="truncate max-w-xs">{message.replyTo?.content?.substring(0, 60)}</span>
        </div>
      )}

      <div className="flex gap-3">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full shrink-0 bg-gradient-to-br from-beacon-accent to-emerald-400 flex items-center justify-center text-white text-sm font-bold overflow-hidden">
          {message.author?.avatar ? (
            <img src={message.author.avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            message.author?.username?.[0]?.toUpperCase() || '?'
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-sm text-text-primary hover:underline cursor-pointer">
              {message.author?.displayName || message.author?.username}
            </span>
            <span className="text-xs text-text-muted">{formatTimestamp(message.createdAt)}</span>
            {message.isEdited && (
              <span className="text-xs text-text-muted">(edited)</span>
            )}
            {message.isPinned && (
              <Pin size={12} className="text-status-away" />
            )}
          </div>

          {/* Content */}
          {message.content && (
            <div className="markdown-content text-sm text-text-primary mt-0.5">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </div>
          )}

          {/* Attachments */}
          {message.attachments?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {message.attachments.map((att, i) => (
                <div key={i}>
                  {isImageFile(att.type) ? (
                    <img src={att.url} alt={att.name}
                      className="max-w-sm max-h-72 rounded-xl cursor-pointer hover:opacity-90 transition-opacity border border-beacon-border"
                      onClick={() => setFilePreview(att)} />
                  ) : isVideoFile(att.type) ? (
                    <video src={att.url} controls className="max-w-sm max-h-72 rounded-xl border border-beacon-border" />
                  ) : (
                    <a href={att.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 bg-beacon-bg rounded-xl border border-beacon-border hover:border-beacon-accent/50 transition-colors max-w-sm">
                      <div className="w-10 h-10 rounded-lg bg-beacon-accent/20 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-beacon-accent">{att.name?.split('.').pop()?.toUpperCase()}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-beacon-accent truncate">{att.name}</p>
                        <p className="text-xs text-text-muted">{formatFileSize(att.size)}</p>
                      </div>
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Reactions */}
          {message.reactions?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {message.reactions.map((reaction, i) => {
                const hasReacted = reaction.users?.includes(user?._id);
                return (
                  <button key={i} onClick={() => handleReaction(reaction.emoji)}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                      hasReacted
                        ? 'bg-beacon-accent/20 border-beacon-accent/50 text-beacon-accent'
                        : 'bg-beacon-bg border-beacon-border text-text-secondary hover:border-beacon-accent/30'
                    }`}>
                    <span>{reaction.emoji}</span>
                    <span>{reaction.users?.length}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Actions toolbar */}
      {showActions && (
        <div className="absolute -top-3 right-2 flex items-center glass rounded-lg p-0.5 shadow-lg border border-beacon-border animate-fade-in">
          {/* Quick reactions */}
          <div className="flex items-center">
            {QUICK_REACTIONS.slice(0, 3).map(emoji => (
              <button key={emoji} onClick={() => handleReaction(emoji)}
                className="p-1.5 hover:bg-beacon-hover rounded transition-colors text-sm">
                {emoji}
              </button>
            ))}
            <button onClick={() => setShowReactionPicker(!showReactionPicker)}
              className="p-1.5 hover:bg-beacon-hover rounded transition-colors text-text-muted">
              <Smile size={16} />
            </button>
          </div>
          <div className="w-px h-5 bg-beacon-border mx-0.5" />
          <button onClick={() => setReplyingTo(message)}
            className="p-1.5 hover:bg-beacon-hover rounded transition-colors text-text-muted hover:text-text-primary" title="Reply">
            <Reply size={16} />
          </button>
          {isOwn && (
            <button onClick={() => setEditingMessage(message)}
              className="p-1.5 hover:bg-beacon-hover rounded transition-colors text-text-muted hover:text-text-primary" title="Edit">
              <Pencil size={16} />
            </button>
          )}
          <button onClick={handlePin}
            className="p-1.5 hover:bg-beacon-hover rounded transition-colors text-text-muted hover:text-text-primary" title="Pin">
            <Pin size={16} />
          </button>
          <button onClick={handleCopyLink}
            className="p-1.5 hover:bg-beacon-hover rounded transition-colors text-text-muted hover:text-text-primary" title="Copy Link">
            <Copy size={16} />
          </button>
          {isOwn && (
            <button onClick={handleDelete}
              className="p-1.5 hover:bg-beacon-hover rounded transition-colors text-red-400 hover:text-red-300" title="Delete">
              <Trash2 size={16} />
            </button>
          )}
        </div>
      )}

      {/* Reaction picker */}
      {showReactionPicker && (
        <div className="absolute -top-12 right-2 glass rounded-xl p-2 shadow-xl border border-beacon-border animate-fade-in z-50">
          <div className="flex gap-1">
            {QUICK_REACTIONS.map(emoji => (
              <button key={emoji} onClick={() => handleReaction(emoji)}
                className="p-2 hover:bg-beacon-hover rounded-lg transition-colors text-lg hover:scale-110">
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
