import { useState } from 'react';
import { X, Camera, Loader2 } from 'lucide-react';
import useUIStore from '../../store/uiStore';
import useServerStore from '../../store/serverStore';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { getInitials } from '../../utils/helpers';

export default function ServerSettingsModal({ server }) {
  const { toggleServerSettings } = useUIStore();
  const { updateServer } = useServerStore();
  const [uploading, setUploading] = useState(false);

  const handleIconUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('icon', file);
      const { data } = await api.post('/upload/server-icon', formData);
      const result = await updateServer(server._id, { icon: data.url });
      if (result.success) toast.success('Server icon updated!');
      else toast.error(result.error || 'Failed to update server icon');
    } catch (err) {
      toast.error('Server icon upload failed');
    }
    setUploading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={toggleServerSettings}>
      <div className="glass rounded-2xl w-full max-w-md shadow-2xl border border-beacon-border animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-beacon-border">
          <h2 className="text-lg font-bold text-text-primary">Server Settings</h2>
          <button onClick={toggleServerSettings} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-beacon-accent to-emerald-400 flex items-center justify-center text-white text-2xl font-bold overflow-hidden">
                {server?.icon ? (
                  <img src={server.icon} alt={server?.name} className="w-full h-full object-cover" />
                ) : (
                  getInitials(server?.name || 'Server')
                )}
              </div>
              <label className="absolute inset-0 rounded-2xl flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                {uploading ? <Loader2 size={20} className="animate-spin text-white" /> : <Camera size={20} className="text-white" />}
                <input type="file" accept="image/*" onChange={handleIconUpload} className="hidden" />
              </label>
            </div>
            <div>
              <p className="font-semibold text-text-primary">{server?.name}</p>
              <p className="text-sm text-text-muted">Server icon</p>
            </div>
          </div>

          <p className="text-xs text-text-muted">
            Uploading a server icon saves it permanently for all members.
          </p>
        </div>
      </div>
    </div>
  );
}
