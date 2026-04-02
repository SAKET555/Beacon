import { useEffect } from 'react';
import { X, Star } from 'lucide-react';
import useUIStore from '../../store/uiStore';
import useMessageStore from '../../store/messageStore';
import MessageItem from '../MessageItem';

export default function StarredMessagesModal({ user }) {
  const { toggleStarredMessages } = useUIStore();
  const { starredMessages, fetchStarred } = useMessageStore();

  useEffect(() => {
    fetchStarred();
  }, []);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={toggleStarredMessages}>
      <div className="glass rounded-2xl w-full max-w-2xl shadow-2xl border border-beacon-border animate-slide-up max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-beacon-border shrink-0">
          <div className="flex items-center gap-2">
            <Star size={18} className="text-beacon-accent" />
            <h2 className="text-lg font-bold text-text-primary">Starred Messages</h2>
          </div>
          <button onClick={toggleStarredMessages} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {starredMessages.length === 0 ? (
            <p className="text-center text-text-muted py-8">No starred messages</p>
          ) : (
            <div className="space-y-3">
              {starredMessages.map(msg => (
                <div key={msg._id} className="p-2 rounded-xl bg-beacon-hover/40 border border-beacon-border">
                  <MessageItem message={msg} user={user} isLast={false} readOnly />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
