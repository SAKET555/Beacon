import { Hash, Megaphone, Plus, Settings, ChevronDown, UserPlus, Bell, Search, Pin, LogOut } from 'lucide-react';
import useUIStore from '../store/uiStore';
import useAuthStore from '../store/authStore';
import useNotificationStore from '../store/notificationStore';
import { getStatusColor } from '../utils/helpers';
import { useState } from 'react';

export default function ChannelSidebar({ server, channels, currentChannel, onSelectChannel, user }) {
  const { toggleCreateChannel, toggleInviteModal, toggleSearchModal,
    toggleNotifications, toggleUserSettings } = useUIStore();
  const { logout, updateStatus } = useAuthStore();
  const { unreadCount } = useNotificationStore();
  const [showServerMenu, setShowServerMenu] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);

  const textChannels = channels.filter(c => c.type === 'text');
  const announcementChannels = channels.filter(c => c.type === 'announcement');

  const isAdminOrOwner = server?.members?.some(
    m => m.user?._id === user?._id && ['owner', 'admin'].includes(m.role)
  );

  return (
    <div className="w-60 h-full bg-beacon-sidebar flex flex-col border-r border-beacon-border">
      {/* Server header */}
      <div className="relative">
        <button onClick={() => setShowServerMenu(!showServerMenu)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-beacon-hover transition-colors border-b border-beacon-border">
          <h2 className="font-semibold text-text-primary truncate">{server?.name}</h2>
          <ChevronDown size={16} className={`text-text-muted transition-transform ${showServerMenu ? 'rotate-180' : ''}`} />
        </button>

        {/* Server dropdown */}
        {showServerMenu && (
          <div className="absolute top-full left-2 right-2 mt-1 glass rounded-xl p-1.5 z-50 shadow-xl border border-beacon-border animate-fade-in">
            <button onClick={() => { toggleInviteModal(); setShowServerMenu(false); }}
              className="sidebar-item w-full text-sm">
              <UserPlus size={16} /> Invite People
            </button>
            {isAdminOrOwner && (
              <button onClick={() => { toggleCreateChannel(); setShowServerMenu(false); }}
                className="sidebar-item w-full text-sm">
                <Plus size={16} /> Create Channel
              </button>
            )}
            <button onClick={() => { toggleSearchModal(); setShowServerMenu(false); }}
              className="sidebar-item w-full text-sm">
              <Search size={16} /> Search Messages
            </button>
            <div className="h-px bg-beacon-border my-1" />
            <button onClick={() => { setShowServerMenu(false); }}
              className="sidebar-item w-full text-sm text-red-400 hover:text-red-300">
              <LogOut size={16} /> Leave Server
            </button>
          </div>
        )}
      </div>

      {/* Channels list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
        {/* Text channels */}
        {textChannels.length > 0 && (
          <div>
            <div className="flex items-center justify-between px-1 mb-1">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Text Channels</span>
              {isAdminOrOwner && (
                <button onClick={toggleCreateChannel} className="text-text-muted hover:text-text-primary transition-colors">
                  <Plus size={14} />
                </button>
              )}
            </div>
            {textChannels.map(channel => (
              <button key={channel._id} onClick={() => onSelectChannel(channel)}
                className={`sidebar-item w-full text-sm ${currentChannel?._id === channel._id ? 'active' : ''}`}>
                <Hash size={18} className="shrink-0" />
                <span className="truncate">{channel.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Announcement channels */}
        {announcementChannels.length > 0 && (
          <div>
            <div className="flex items-center justify-between px-1 mb-1">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Announcements</span>
            </div>
            {announcementChannels.map(channel => (
              <button key={channel._id} onClick={() => onSelectChannel(channel)}
                className={`sidebar-item w-full text-sm ${currentChannel?._id === channel._id ? 'active' : ''}`}>
                <Megaphone size={18} className="shrink-0" />
                <span className="truncate">{channel.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* User panel */}
      <div className="p-2 border-t border-beacon-border bg-beacon-sidebar">
        <div className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-beacon-hover transition-colors">
          <div className="relative cursor-pointer" onClick={() => setShowStatusMenu(!showStatusMenu)}>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-beacon-accent to-emerald-400 flex items-center justify-center text-white text-xs font-bold">
              {user?.avatar ? (
                <img src={user.avatar} alt="" className="w-full h-full rounded-full object-cover" />
              ) : (
                user?.username?.[0]?.toUpperCase()
              )}
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-beacon-sidebar"
              style={{ backgroundColor: getStatusColor(user?.status) }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{user?.displayName || user?.username}</p>
            <p className="text-xs text-text-muted truncate">{user?.customStatus || user?.status}</p>
          </div>
          <div className="flex gap-1">
            <button onClick={toggleNotifications}
              className="relative p-1.5 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-beacon-hover">
              <Bell size={16} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 badge text-[10px] min-w-[16px] h-4">{unreadCount}</span>
              )}
            </button>
            <button onClick={toggleUserSettings}
              className="p-1.5 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-beacon-hover">
              <Settings size={16} />
            </button>
          </div>
        </div>

        {/* Status menu */}
        {showStatusMenu && (
          <div className="absolute bottom-16 left-2 glass rounded-xl p-1.5 z-50 shadow-xl border border-beacon-border animate-slide-up w-48">
            {['online', 'away', 'dnd', 'offline'].map(status => (
              <button key={status} onClick={() => { updateStatus(status); setShowStatusMenu(false); }}
                className="sidebar-item w-full text-sm capitalize">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getStatusColor(status) }} />
                {status === 'dnd' ? 'Do Not Disturb' : status}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
