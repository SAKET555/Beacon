import { useState } from 'react';
import { X, Loader2, Link } from 'lucide-react';
import useUIStore from '../../store/uiStore';
import useServerStore from '../../store/serverStore';
import toast from 'react-hot-toast';

export default function CreateServerModal() {
  const { toggleCreateServer } = useUIStore();
  const { createServer, joinByInvite } = useServerStore();
  const [tab, setTab] = useState('create');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return toast.error('Server name is required');
    setLoading(true);
    const result = await createServer(name.trim(), description.trim());
    setLoading(false);
    if (result.success) {
      toast.success('Server created!');
      toggleCreateServer();
    } else {
      toast.error(result.error || 'Failed to create server');
    }
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!inviteCode.trim()) return toast.error('Invite code is required');
    setLoading(true);
    const result = await joinByInvite(inviteCode.trim());
    setLoading(false);
    if (result.success) {
      toast.success('Joined server!');
      toggleCreateServer();
    } else {
      toast.error(result.error || 'Invalid invite code');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={toggleCreateServer}>
      <div className="glass rounded-2xl w-full max-w-md shadow-2xl border border-beacon-border animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-beacon-border">
          <h2 className="text-lg font-bold text-text-primary">Add a Server</h2>
          <button onClick={toggleCreateServer} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-beacon-border">
          <button onClick={() => setTab('create')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${tab === 'create' ? 'text-beacon-accent border-b-2 border-beacon-accent' : 'text-text-muted hover:text-text-primary'}`}>
            Create Server
          </button>
          <button onClick={() => setTab('join')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${tab === 'join' ? 'text-beacon-accent border-b-2 border-beacon-accent' : 'text-text-muted hover:text-text-primary'}`}>
            Join Server
          </button>
        </div>

        <div className="p-5">
          {tab === 'create' ? (
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">Server Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  className="input-field w-full" placeholder="My Awesome Server" maxLength={64} />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">Description (optional)</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)}
                  className="input-field w-full resize-none" rows={3} placeholder="What's your server about?" maxLength={256} />
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
                {loading ? <Loader2 size={18} className="animate-spin" /> : null}
                {loading ? 'Creating...' : 'Create Server'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleJoin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">Invite Code</label>
                <div className="relative">
                  <Link size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input type="text" value={inviteCode} onChange={e => setInviteCode(e.target.value)}
                    className="input-field w-full pl-9" placeholder="Enter invite code" />
                </div>
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
                {loading ? <Loader2 size={18} className="animate-spin" /> : null}
                {loading ? 'Joining...' : 'Join Server'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
