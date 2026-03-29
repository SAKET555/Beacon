import { useState } from 'react';
import { X, Loader2, Hash, Megaphone } from 'lucide-react';
import useUIStore from '../../store/uiStore';
import useChannelStore from '../../store/channelStore';
import toast from 'react-hot-toast';

export default function CreateChannelModal({ serverId }) {
  const { toggleCreateChannel } = useUIStore();
  const { createChannel } = useChannelStore();
  const [name, setName] = useState('');
  const [type, setType] = useState('text');
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return toast.error('Channel name is required');
    setLoading(true);
    const result = await createChannel(serverId, name.trim().toLowerCase().replace(/\s+/g, '-'), type, topic.trim());
    setLoading(false);
    if (result.success) {
      toast.success('Channel created!');
      toggleCreateChannel();
    } else {
      toast.error(result.error || 'Failed to create channel');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={toggleCreateChannel}>
      <div className="glass rounded-2xl w-full max-w-md shadow-2xl border border-beacon-border animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-beacon-border">
          <h2 className="text-lg font-bold text-text-primary">Create Channel</h2>
          <button onClick={toggleCreateChannel} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">Channel Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setType('text')}
                className={`p-3 rounded-xl border transition-all flex items-center gap-2 ${type === 'text' ? 'border-beacon-accent bg-beacon-accent/10 text-beacon-accent' : 'border-beacon-border text-text-secondary hover:border-beacon-border-light'}`}>
                <Hash size={18} /> Text
              </button>
              <button type="button" onClick={() => setType('announcement')}
                className={`p-3 rounded-xl border transition-all flex items-center gap-2 ${type === 'announcement' ? 'border-beacon-accent bg-beacon-accent/10 text-beacon-accent' : 'border-beacon-border text-text-secondary hover:border-beacon-border-light'}`}>
                <Megaphone size={18} /> Announcement
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Channel Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="input-field w-full" placeholder="new-channel" maxLength={64} />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Topic (optional)</label>
            <input type="text" value={topic} onChange={e => setTopic(e.target.value)}
              className="input-field w-full" placeholder="What's this channel about?" maxLength={256} />
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
            {loading ? <Loader2 size={18} className="animate-spin" /> : null}
            {loading ? 'Creating...' : 'Create Channel'}
          </button>
        </form>
      </div>
    </div>
  );
}
