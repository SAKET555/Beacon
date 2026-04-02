import { useEffect, useState } from 'react';
import { X, MessageSquare, Send } from 'lucide-react';
import useUIStore from '../../store/uiStore';
import useMessageStore from '../../store/messageStore';
import MessageItem from '../MessageItem';
import toast from 'react-hot-toast';

export default function ThreadModal({ channel, user, server }) {
  const { threadParent, closeThread } = useUIStore();
  const { fetchThread, threadMessages, sendMessage, clearThread } = useMessageStore();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (threadParent?._id) {
      fetchThread(threadParent._id);
    }
    return () => clearThread();
  }, [threadParent?._id]);

  const handleSend = async () => {
    if (!content.trim() || !channel?._id) return;
    setLoading(true);
    const result = await sendMessage(channel._id, content.trim(), [], threadParent._id, []);
    setLoading(false);
    if (result.success) {
      setContent('');
      fetchThread(threadParent._id);
    } else {
      toast.error(result.error || 'Failed to reply');
    }
  };

  if (!threadParent) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={closeThread}>
      <div className="glass rounded-2xl w-full max-w-2xl shadow-2xl border border-beacon-border animate-slide-up max-h-[75vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-beacon-border shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare size={18} className="text-beacon-accent" />
            <h2 className="text-lg font-bold text-text-primary">Thread</h2>
          </div>
          <button onClick={closeThread} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {threadMessages.map(msg => (
            <div key={msg._id} className="p-2 rounded-xl bg-beacon-hover/40 border border-beacon-border">
              <MessageItem message={msg} user={user} channel={channel} server={server} readOnly />
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-beacon-border">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Reply in thread..."
              className="input-field flex-1"
            />
            <button
              onClick={handleSend}
              disabled={loading || !content.trim()}
              className="btn-primary px-3"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
