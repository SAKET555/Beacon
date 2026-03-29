import { useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import useUIStore from '../../store/uiStore';
import toast from 'react-hot-toast';

export default function InviteModal({ server }) {
  const { toggleInviteModal } = useUIStore();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(server.inviteCode);
    setCopied(true);
    toast.success('Invite code copied!');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={toggleInviteModal}>
      <div className="glass rounded-2xl w-full max-w-md shadow-2xl border border-beacon-border animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-beacon-border">
          <h2 className="text-lg font-bold text-text-primary">Invite People</h2>
          <button onClick={toggleInviteModal} className="text-text-muted hover:text-text-primary transition-colors"><X size={20} /></button>
        </div>
        <div className="p-5">
          <p className="text-sm text-text-secondary mb-4">Share this invite code with friends to let them join <span className="font-semibold text-text-primary">{server.name}</span></p>
          <div className="flex gap-2">
            <div className="flex-1 input-field flex items-center font-mono text-lg tracking-widest text-beacon-accent">
              {server.inviteCode}
            </div>
            <button onClick={handleCopy} className={`px-4 rounded-xl flex items-center gap-2 transition-all ${copied ? 'bg-status-online text-white' : 'btn-primary'}`}>
              {copied ? <Check size={18} /> : <Copy size={18} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
