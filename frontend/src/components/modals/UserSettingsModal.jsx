import { useState } from 'react';
import { X, Camera, Loader2, LogOut, Trash2, AlertTriangle } from 'lucide-react';
import useUIStore from '../../store/uiStore';
import useAuthStore from '../../store/authStore';
import api from '../../services/api';
import toast from 'react-hot-toast';

export default function UserSettingsModal() {
  const { toggleUserSettings } = useUIStore();
  const { user, updateProfile, logout } = useAuthStore();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [customStatus, setCustomStatus] = useState(user?.customStatus || '');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    const result = await updateProfile({ displayName, bio, customStatus });
    setLoading(false);
    if (result.success) toast.success('Profile updated!');
    else toast.error(result.error || 'Update failed');
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      const { data } = await api.post('/upload/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      await updateProfile({ avatar: data.url });
      toast.success('Avatar updated!');
    } catch (err) {
      toast.error('Avatar upload failed');
    }
    setUploading(false);
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== user?.username) return;
    setDeleting(true);
    try {
      await api.delete('/users/account');
      toast.success('Account deleted');
      logout();
      toggleUserSettings();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete account');
    }
    setDeleting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={toggleUserSettings}>
      <div className="glass rounded-2xl w-full max-w-md shadow-2xl border border-beacon-border animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-beacon-border">
          <h2 className="text-lg font-bold text-text-primary">User Settings</h2>
          <button onClick={toggleUserSettings} className="text-text-muted hover:text-text-primary transition-colors"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-beacon-accent to-purple-500 flex items-center justify-center text-white text-2xl font-bold overflow-hidden">
                {user?.avatar ? (
                  <img src={user.avatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  user?.username?.[0]?.toUpperCase()
                )}
              </div>
              <label className="absolute inset-0 rounded-full flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                {uploading ? <Loader2 size={20} className="animate-spin text-white" /> : <Camera size={20} className="text-white" />}
                <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
              </label>
            </div>
            <div>
              <p className="font-semibold text-text-primary">{user?.username}</p>
              <p className="text-sm text-text-muted">{user?.email}</p>
            </div>
          </div>

          {/* Fields */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Display Name</label>
            <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
              className="input-field w-full" maxLength={32} />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Bio</label>
            <textarea value={bio} onChange={e => setBio(e.target.value)}
              className="input-field w-full resize-none" rows={3} maxLength={190} />
            <p className="text-xs text-text-muted mt-1">{bio.length}/190</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Custom Status</label>
            <input type="text" value={customStatus} onChange={e => setCustomStatus(e.target.value)}
              className="input-field w-full" placeholder="What's on your mind?" maxLength={128} />
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={handleSave} disabled={loading} className="btn-primary flex-1 flex items-center justify-center gap-2">
              {loading ? <Loader2 size={18} className="animate-spin" /> : null}
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
            <button onClick={() => { logout(); toggleUserSettings(); }} className="btn-danger flex items-center gap-2">
              <LogOut size={18} /> Logout
            </button>
          </div>

          {/* Delete Account */}
          <div className="border-t border-beacon-border pt-4">
            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-red-400 border border-red-500/30 hover:bg-red-500/10 hover:border-red-500/60 transition-all"
              >
                <Trash2 size={16} /> Delete Account
              </button>
            ) : (
              <div className="space-y-3 bg-red-500/5 border border-red-500/20 rounded-xl p-4">
                <div className="flex items-center gap-2 text-red-400">
                  <AlertTriangle size={16} />
                  <p className="text-sm font-semibold">This action is permanent and cannot be undone.</p>
                </div>
                <p className="text-xs text-text-muted">
                  Type your username <span className="text-text-primary font-mono font-semibold">{user?.username}</span> to confirm.
                </p>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={e => setDeleteConfirmText(e.target.value)}
                  className="input-field w-full"
                  placeholder={user?.username}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleteConfirmText !== user?.username || deleting}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-all"
                  >
                    {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    {deleting ? 'Deleting...' : 'Delete My Account'}
                  </button>
                  <button
                    onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); }}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-text-muted hover:text-text-primary border border-beacon-border hover:bg-white/5 transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
