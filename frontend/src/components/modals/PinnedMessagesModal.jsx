import { useEffect } from 'react';
import { X, Pin } from 'lucide-react';
import useUIStore from '../../store/uiStore';
import useChannelStore from '../../store/channelStore';
import MessageItem from '../MessageItem';

export default function PinnedMessagesModal({ channel, user, server }) {
  const { togglePinnedMessages } = useUIStore();
  const { pinnedMessages, fetchPins } = useChannelStore();

  useEffect(() => {
    if (channel?._id) fetchPins(channel._id);
  }, [channel?._id]);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={togglePinnedMessages}>
      <div className="glass rounded-2xl w-full max-w-2xl shadow-2xl border border-beacon-border animate-slide-up max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-beacon-border shrink-0">
          <div className="flex items-center gap-2">
            <Pin size={18} className="text-beacon-accent" />
            <h2 className="text-lg font-bold text-text-primary">Pinned Messages</h2>
          </div>
          <button onClick={togglePinnedMessages} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {pinnedMessages.length === 0 ? (
            <p className="text-center text-text-muted py-8">No pinned messages</p>
          ) : (
            <div className="space-y-3">
              {pinnedMessages.map(msg => (
                <div key={msg._id} className="p-2 rounded-xl bg-beacon-hover/40 border border-beacon-border">
                  <MessageItem message={msg} user={user} channel={channel} server={server} isLast={false} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
