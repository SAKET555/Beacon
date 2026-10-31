import { useEffect, useState } from 'react';
import { Ban, Crown, RefreshCw, UserMinus, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import useAuthStore from '../../store/authStore';
import useServerStore from '../../store/serverStore';
import useChannelStore from '../../store/channelStore';

const SLOW_MODE_OPTIONS = [
  [0, 'Off'], [5, '5s'], [10, '10s'], [30, '30s'], [60, '1m'], [300, '5m'], [900, '15m'], [3600, '1h']
];

const errorOf = (error, fallback) => error.response?.data?.error || fallback;

function Section({ title, description, children }) {
  return (
    <div className="rounded-xl border border-beacon-border p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-text-primary">{title}</h3>
        {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export default function ModerationPage({ server, permissions = {} }) {
  const { user } = useAuthStore();
  const { serverMembers, fetchServerMembers, fetchServer, fetchServers } = useServerStore();
  const { channels } = useChannelStore();
  const [bans, setBans] = useState([]);
  const [transferTo, setTransferTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(server.settings || {});

  const isOwner = server.owner === user?._id || server.owner?._id === user?._id;
  const canKick = !!permissions.kickMembers;
  const canBan = !!permissions.banMembers;
  const canManageServer = !!permissions.manageServer;
  const canManageChannels = !!permissions.manageChannels;

  const loadBans = async () => {
    if (!canBan) return;
    try {
      const { data } = await api.get(`/admin/${server._id}/bans`);
      setBans(data.bans || []);
    } catch (error) {
      setBans([]);
    }
  };

  useEffect(() => {
    loadBans();
    setSettings(server.settings || {});
  }, [server._id, canBan]);

  const run = async (action, success) => {
    setBusy(true);
    try {
      await action();
      if (success) toast.success(success);
      await Promise.all([fetchServerMembers(server._id), loadBans(), fetchServer(server._id)]);
    } catch (error) {
      toast.error(errorOf(error, 'Something went wrong'));
    }
    setBusy(false);
  };

  const kick = (member) => {
    if (!confirm(`Kick ${member.user?.username} from ${server.name}?`)) return;
    run(() => api.delete(`/admin/${server._id}/members/${member.user._id}`), 'Member kicked');
  };

  const ban = (member) => {
    const reason = prompt(`Ban ${member.user?.username}? They won't be able to rejoin.\nReason (optional):`);
    if (reason === null) return;
    run(() => api.post(`/admin/${server._id}/bans/${member.user._id}`, { reason }), 'Member banned');
  };

  const unban = (entry) => run(() => api.delete(`/admin/${server._id}/bans/${entry.user?._id || entry.user}`), 'Member unbanned');

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    run(() => api.patch(`/servers/${server._id}`, { settings: { [key]: value } }), 'Settings saved');
  };

  const regenerateInvite = () => {
    if (!confirm('Reset the invite code? The old code will stop working immediately.')) return;
    run(() => api.post(`/servers/${server._id}/invite/regenerate`), 'New invite code created');
  };

  const setSlowMode = (channel, slowMode) => run(
    () => api.patch(`/channels/${channel._id}`, { settings: { slowMode } }),
    slowMode ? `Slow mode set for #${channel.name}` : `Slow mode off for #${channel.name}`
  );

  const transferOwnership = () => {
    const target = serverMembers.find(m => m.user?._id === transferTo);
    if (!target) return;
    if (!confirm(`Make ${target.user.username} the owner of ${server.name}? You will become an admin.`)) return;
    run(async () => {
      await api.post(`/servers/${server._id}/transfer-ownership`, { userId: transferTo });
      setTransferTo('');
      await fetchServers();
    }, 'Ownership transferred');
  };

  const manageable = serverMembers.filter(m => m.user?._id !== user?._id && m.role !== 'owner');

  if (!canKick && !canBan && !canManageServer && !canManageChannels && !isOwner) {
    return <p className="text-sm text-text-muted">You don't have moderation permissions in this server.</p>;
  }

  return (
    <div className="space-y-4">
      {(canKick || canBan) && (
        <Section title="Members" description="Kick removes someone (they can rejoin with an invite). Ban removes them for good.">
          {manageable.length === 0 && <p className="text-sm text-text-muted">No other members yet.</p>}
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {manageable.map(member => (
              <div key={member.user?._id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-beacon-hover">
                <div className="min-w-0">
                  <p className="text-sm text-text-primary truncate">{member.user?.displayName || member.user?.username}</p>
                  <p className="text-xs text-text-muted">@{member.user?.username} · {member.role}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  {canKick && (
                    <button disabled={busy} onClick={() => kick(member)} className="btn-secondary px-2 py-1 text-xs flex items-center gap-1">
                      <UserMinus size={14} /> Kick
                    </button>
                  )}
                  {canBan && (
                    <button disabled={busy} onClick={() => ban(member)} className="btn-danger px-2 py-1 text-xs flex items-center gap-1">
                      <Ban size={14} /> Ban
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {canBan && (
        <Section title={`Bans (${bans.length})`}>
          {bans.length === 0 && <p className="text-sm text-text-muted">Nobody is banned.</p>}
          {bans.map(entry => (
            <div key={entry.user?._id || entry.user} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-text-primary truncate">{entry.user?.username || 'Deleted user'}</p>
                {entry.reason && <p className="text-xs text-text-muted truncate">Reason: {entry.reason}</p>}
              </div>
              <button disabled={busy} onClick={() => unban(entry)} className="btn-secondary px-2 py-1 text-xs flex items-center gap-1">
                <Undo2 size={14} /> Unban
              </button>
            </div>
          ))}
        </Section>
      )}

      {canManageServer && (
        <Section title="Access" description="Control how people can join this server.">
          <label className="flex items-center justify-between text-sm text-text-primary">
            Public (anyone with the server link can join)
            <input type="checkbox" checked={settings.isPublic !== false} disabled={busy}
              onChange={e => updateSetting('isPublic', e.target.checked)} />
          </label>
          <label className="flex items-center justify-between text-sm text-text-primary">
            Allow joining with the invite code
            <input type="checkbox" checked={settings.allowInvites !== false} disabled={busy}
              onChange={e => updateSetting('allowInvites', e.target.checked)} />
          </label>
          <button disabled={busy} onClick={regenerateInvite} className="btn-secondary text-sm flex items-center gap-2">
            <RefreshCw size={14} /> Reset invite code
          </button>
        </Section>
      )}

      {canManageChannels && channels.length > 0 && (
        <Section title="Slow mode" description="Limit how often each member can post. Moderators are exempt.">
          {channels.map(channel => (
            <div key={channel._id} className="flex items-center justify-between text-sm">
              <span className="text-text-primary">#{channel.name}</span>
              <select className="input-field py-1 w-28" disabled={busy}
                value={channel.settings?.slowMode || 0}
                onChange={e => setSlowMode(channel, Number(e.target.value))}>
                {SLOW_MODE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          ))}
        </Section>
      )}

      {isOwner && (
        <Section title="Transfer ownership" description="Hand this server to another member. You'll keep admin rights.">
          <div className="flex gap-2">
            <select className="input-field flex-1" value={transferTo} onChange={e => setTransferTo(e.target.value)}>
              <option value="">Choose a member…</option>
              {manageable.map(m => (
                <option key={m.user?._id} value={m.user?._id}>{m.user?.displayName || m.user?.username}</option>
              ))}
            </select>
            <button disabled={!transferTo || busy} onClick={transferOwnership} className="btn-danger flex items-center gap-2">
              <Crown size={14} /> Transfer
            </button>
          </div>
        </Section>
      )}
    </div>
  );
}
