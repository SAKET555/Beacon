import { Crown, Shield, ShieldCheck, User } from 'lucide-react';
import { getStatusColor } from '../utils/helpers';

const roleIcons = {
  owner: <Crown size={14} className="text-yellow-400" />,
  admin: <ShieldCheck size={14} className="text-red-400" />,
  moderator: <Shield size={14} className="text-blue-400" />,
  member: null
};

const rolePriority = { owner: 0, admin: 1, moderator: 2, member: 3 };

export default function MembersPanel({ server, onlineUsers }) {
  const members = server?.members || [];

  const sorted = [...members].sort((a, b) => {
    const aOnline = onlineUsers[a.user?._id] && onlineUsers[a.user?._id] !== 'offline';
    const bOnline = onlineUsers[b.user?._id] && onlineUsers[b.user?._id] !== 'offline';
    if (aOnline && !bOnline) return -1;
    if (!aOnline && bOnline) return 1;
    return (rolePriority[a.role] || 3) - (rolePriority[b.role] || 3);
  });

  const onlineMembers = sorted.filter(m => {
    const status = onlineUsers[m.user?._id];
    return status && status !== 'offline';
  });
  const offlineMembers = sorted.filter(m => {
    const status = onlineUsers[m.user?._id];
    return !status || status === 'offline';
  });

  const MemberItem = ({ member }) => {
    const status = onlineUsers[member.user?._id] || 'offline';
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-beacon-hover transition-colors cursor-pointer group">
        <div className="relative">
          <div className={`w-8 h-8 rounded-full bg-gradient-to-br from-beacon-accent to-purple-500 flex items-center justify-center text-white text-xs font-bold overflow-hidden ${status === 'offline' ? 'opacity-50' : ''}`}>
            {member.user?.avatar ? (
              <img src={member.user.avatar} alt="" className="w-full h-full object-cover" />
            ) : (
              member.user?.username?.[0]?.toUpperCase() || '?'
            )}
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-beacon-chat"
            style={{ backgroundColor: getStatusColor(status) }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className={`text-sm font-medium truncate ${status === 'offline' ? 'text-text-muted' : 'text-text-primary'}`}>
              {member.user?.displayName || member.user?.username}
            </span>
            {roleIcons[member.role]}
          </div>
          {member.user?.customStatus && (
            <p className="text-xs text-text-muted truncate">{member.user.customStatus}</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-60 h-full bg-beacon-chat border-l border-beacon-border overflow-y-auto hidden xl:block">
      <div className="p-3 space-y-4">
        {onlineMembers.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider px-2 mb-1">
              Online — {onlineMembers.length}
            </h4>
            {onlineMembers.map(m => <MemberItem key={m.user?._id} member={m} />)}
          </div>
        )}
        {offlineMembers.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider px-2 mb-1">
              Offline — {offlineMembers.length}
            </h4>
            {offlineMembers.map(m => <MemberItem key={m.user?._id} member={m} />)}
          </div>
        )}
      </div>
    </div>
  );
}
