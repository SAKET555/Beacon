import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Plus, Smile, Bold, Italic, Strikethrough, Code, X, Paperclip, Image } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import EmojiPicker from 'emoji-picker-react';
import useMessageStore from '../store/messageStore';
import useUIStore from '../store/uiStore';
import { getSocket } from '../services/socket';
import api from '../services/api';
import toast from 'react-hot-toast';
import { formatFileSize, isImageFile } from '../utils/helpers';

export default function MessageInput({ channel, user }) {
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [showEmoji, setShowEmoji] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showFormatting, setShowFormatting] = useState(false);
  const { sendMessage } = useMessageStore();
  const { replyingTo, setReplyingTo, editingMessage, setEditingMessage } = useUIStore();
  const { editMessage } = useMessageStore();
  const textareaRef = useRef(null);
  const typingTimeout = useRef(null);

  // Load draft from localStorage
  useEffect(() => {
    if (channel?._id) {
      const draft = localStorage.getItem(`draft_${channel._id}`);
      if (draft) setContent(draft);
    }
  }, [channel?._id]);

  // Save draft
  useEffect(() => {
    if (channel?._id && content) {
      localStorage.setItem(`draft_${channel._id}`, content);
    } else if (channel?._id) {
      localStorage.removeItem(`draft_${channel._id}`);
    }
  }, [content, channel?._id]);

  // Set content for editing
  useEffect(() => {
    if (editingMessage) {
      setContent(editingMessage.content);
      textareaRef.current?.focus();
    }
  }, [editingMessage]);

  const handleTyping = useCallback(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('typing:start', { channelId: channel?._id });
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      socket.emit('typing:stop', { channelId: channel?._id });
    }, 2000);
  }, [channel?._id]);

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed && attachments.length === 0) return;
    if (trimmed.length > 2000) return toast.error('Message exceeds 2000 character limit');

    // Stop typing indicator
    const socket = getSocket();
    if (socket) socket.emit('typing:stop', { channelId: channel?._id });

    if (editingMessage) {
      const result = await editMessage(editingMessage._id, trimmed);
      if (result.success) {
        setEditingMessage(null);
        setContent('');
      } else {
        toast.error(result.error || 'Edit failed');
      }
      return;
    }

    // Parse @mentions
    const mentionRegex = /@(\w+)/g;
    const mentionedNames = [...trimmed.matchAll(mentionRegex)].map(m => m[1]);

    const result = await sendMessage(
      channel._id, trimmed, attachments,
      replyingTo?._id || null, []
    );

    if (result.success) {
      setContent('');
      setAttachments([]);
      setReplyingTo(null);
      localStorage.removeItem(`draft_${channel._id}`);
    } else {
      toast.error(result.error || 'Failed to send');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const onDrop = useCallback(async (acceptedFiles) => {
    setUploading(true);
    for (const file of acceptedFiles) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        const { data } = await api.post('/upload', formData);
        setAttachments(prev => [...prev, data]);
      } catch (err) {
        toast.error(`Failed to upload ${file.name}`);
      }
    }
    setUploading(false);
  }, []);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop, noClick: true, noKeyboard: true,
    maxSize: 10 * 1024 * 1024,
    accept: { 'image/*': [], 'video/*': [], 'audio/*': [], 'application/pdf': [], 'text/*': [] }
  });

  const removeAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const insertFormatting = (prefix, suffix) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = content.substring(start, end);
    const newContent = content.substring(0, start) + prefix + selected + suffix + content.substring(end);
    setContent(newContent);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    }, 0);
  };

  const charCount = content.length;

  return (
    <div {...getRootProps()} className="px-4 pb-4 relative">
      {/* Drag overlay */}
      {isDragActive && (
        <div className="absolute inset-0 bg-beacon-accent/20 border-2 border-dashed border-beacon-accent rounded-xl z-10 flex items-center justify-center">
          <p className="text-beacon-accent font-semibold">Drop files here!</p>
        </div>
      )}

      {/* Reply / Edit bar */}
      {(replyingTo || editingMessage) && (
        <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-beacon-hover rounded-t-xl border-l-2 border-beacon-accent animate-slide-up">
          <span className="text-xs text-text-muted">
            {editingMessage ? 'Editing message' : `Replying to ${replyingTo?.author?.username || 'user'}`}
          </span>
          <span className="flex-1 text-xs text-text-secondary truncate">
            {(editingMessage || replyingTo)?.content?.substring(0, 60)}
          </span>
          <button onClick={() => { setReplyingTo(null); setEditingMessage(null); setContent(''); }}
            className="text-text-muted hover:text-text-primary">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {attachments.map((att, i) => (
            <div key={i} className="relative group bg-beacon-hover rounded-xl p-2 flex items-center gap-2">
              {isImageFile(att.type) ? (
                <img src={att.url} alt="" className="w-16 h-16 rounded-lg object-cover" />
              ) : (
                <div className="w-16 h-16 rounded-lg bg-beacon-bg flex items-center justify-center">
                  <Paperclip size={20} className="text-text-muted" />
                </div>
              )}
              <div className="min-w-0 max-w-[120px]">
                <p className="text-xs text-text-primary truncate">{att.name}</p>
                <p className="text-xs text-text-muted">{formatFileSize(att.size)}</p>
              </div>
              <button onClick={() => removeAttachment(i)}
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="bg-beacon-hover border border-beacon-border rounded-xl focus-within:border-beacon-accent/50 transition-colors">
        {/* Formatting toolbar */}
        {showFormatting && (
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-beacon-border">
            <button onClick={() => insertFormatting('**', '**')} className="p-1 text-text-muted hover:text-text-primary rounded transition-colors" title="Bold"><Bold size={16}/></button>
            <button onClick={() => insertFormatting('*', '*')} className="p-1 text-text-muted hover:text-text-primary rounded transition-colors" title="Italic"><Italic size={16}/></button>
            <button onClick={() => insertFormatting('~~', '~~')} className="p-1 text-text-muted hover:text-text-primary rounded transition-colors" title="Strikethrough"><Strikethrough size={16}/></button>
            <button onClick={() => insertFormatting('`', '`')} className="p-1 text-text-muted hover:text-text-primary rounded transition-colors" title="Code"><Code size={16}/></button>
            <button onClick={() => insertFormatting('\n```\n', '\n```\n')} className="p-1 text-text-muted hover:text-text-primary rounded text-xs font-mono transition-colors" title="Code Block">{'{ }'}</button>
          </div>
        )}

        <div className="flex items-center gap-2 px-3 py-2">
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={open} className="p-1.5 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-beacon-bg">
              <Plus size={20} />
            </button>
            <input {...getInputProps()} />
          </div>

          <textarea
            ref={textareaRef} value={content}
            onChange={(e) => { setContent(e.target.value); handleTyping(); }}
            onKeyDown={handleKeyDown}
            placeholder={`Message #${channel?.name || 'channel'}`}
            rows={1}
            className="flex-1 bg-transparent text-text-primary placeholder-text-muted resize-none focus:outline-none text-sm leading-5 max-h-40 overflow-y-auto py-1.5"
            style={{ minHeight: '32px', height: 'auto' }}
            onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
          />

          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => setShowFormatting(!showFormatting)}
              className={`p-1.5 transition-colors rounded-lg hover:bg-beacon-bg ${showFormatting ? 'text-beacon-accent' : 'text-text-muted hover:text-text-primary'}`}>
              <Bold size={18} />
            </button>
            <div className="relative">
              <button onClick={() => setShowEmoji(!showEmoji)}
                className="p-1.5 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-beacon-bg">
                <Smile size={18} />
              </button>
              {showEmoji && (
                <div className="absolute bottom-10 right-0 z-50">
                  <EmojiPicker onEmojiClick={(e) => { setContent(prev => prev + e.emoji); setShowEmoji(false); }}
                    theme="dark" width={320} height={400} />
                </div>
              )}
            </div>
            <button onClick={handleSubmit} disabled={uploading || (!content.trim() && attachments.length === 0)}
              className="p-1.5 text-beacon-accent hover:text-beacon-accent-hover transition-colors rounded-lg hover:bg-beacon-bg disabled:opacity-30 disabled:cursor-not-allowed">
              <Send size={18} />
            </button>
          </div>
        </div>

        {/* Character count */}
        {charCount > 1800 && (
          <div className={`px-3 pb-1 text-xs text-right ${charCount > 2000 ? 'text-red-400' : 'text-text-muted'}`}>
            {charCount}/2000
          </div>
        )}
      </div>
    </div>
  );
}
