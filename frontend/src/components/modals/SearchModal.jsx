import { useState } from 'react';
import { X, Search, Loader2 } from 'lucide-react';
import useUIStore from '../../store/uiStore';
import useMessageStore from '../../store/messageStore';
import { formatTimestamp } from '../../utils/helpers';

export default function SearchModal({ channelId }) {
  const { toggleSearchModal } = useUIStore();
  const { searchMessages, searchResults, clearSearch } = useMessageStore();
  const [query, setQuery] = useState('');
  const [hasFilter, setHasFilter] = useState('');
  const [before, setBefore] = useState('');
  const [after, setAfter] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    await searchMessages(channelId, {
      q: query.trim(),
      has: hasFilter || undefined,
      before: before ? new Date(before).toISOString() : undefined,
      after: after ? new Date(after).toISOString() : undefined
    });
    setLoading(false);
    // Save to recent searches
    const recent = JSON.parse(localStorage.getItem('beacon_recent_searches') || '[]');
    const updated = [query.trim(), ...recent.filter(s => s !== query.trim())].slice(0, 10);
    localStorage.setItem('beacon_recent_searches', JSON.stringify(updated));
  };

  const handleClose = () => {
    clearSearch();
    toggleSearchModal();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={handleClose}>
      <div className="glass rounded-2xl w-full max-w-lg shadow-2xl border border-beacon-border animate-slide-up max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-beacon-border shrink-0">
          <h2 className="text-lg font-bold text-text-primary">Search Messages</h2>
          <button onClick={handleClose} className="text-text-muted hover:text-text-primary transition-colors"><X size={20} /></button>
        </div>

        <form onSubmit={handleSearch} className="p-4 border-b border-beacon-border shrink-0">
          <div className="space-y-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input type="text" value={query} onChange={e => setQuery(e.target.value)}
                className="input-field w-full pl-9" placeholder="Search messages..." autoFocus />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <select value={hasFilter} onChange={e => setHasFilter(e.target.value)} className="input-field">
                <option value="">Has: Any</option>
                <option value="attachment">Has: Attachment</option>
                <option value="link">Has: Link</option>
              </select>
              <input type="date" value={after} onChange={e => setAfter(e.target.value)}
                className="input-field" placeholder="After" />
              <input type="date" value={before} onChange={e => setBefore(e.target.value)}
                className="input-field" placeholder="Before" />
            </div>
          </div>
        </form>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-beacon-accent" /></div>
          ) : searchResults.length > 0 ? (
            <div className="space-y-3">
              {searchResults.map(msg => (
                <div key={msg._id} className="p-3 rounded-xl bg-beacon-hover border border-beacon-border hover:border-beacon-accent/30 transition-colors cursor-pointer">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-text-primary">{msg.author?.username}</span>
                    <span className="text-xs text-text-muted">{formatTimestamp(msg.createdAt)}</span>
                  </div>
                  <p className="text-sm text-text-secondary line-clamp-2">{msg.content}</p>
                </div>
              ))}
            </div>
          ) : query && !loading ? (
            <p className="text-center text-text-muted py-8">No messages found</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
