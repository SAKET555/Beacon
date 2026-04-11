import { formatDistanceToNow, format, isToday, isYesterday } from 'date-fns';

export const formatTimestamp = (date) => {
  const d = new Date(date);
  if (isToday(d)) return format(d, 'h:mm a');
  if (isYesterday(d)) return `Yesterday ${format(d, 'h:mm a')}`;
  return format(d, 'MMM d, yyyy h:mm a');
};

export const formatRelative = (date) => {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
};

export const formatDateDivider = (date) => {
  const d = new Date(date);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'MMMM d, yyyy');
};

export const shouldShowDivider = (current, previous) => {
  if (!previous) return true;
  const a = new Date(current).toDateString();
  const b = new Date(previous).toDateString();
  return a !== b;
};

export const getInitials = (name) => {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
};

export const getStatusColor = (status) => {
  const colors = { online: '#22c55e', away: '#eab308', dnd: '#ef4444', offline: '#6b7280' };
  return colors[status] || colors.offline;
};

export const truncate = (str, len = 30) => {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
};

export const formatFileSize = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

export const isImageFile = (type) => type?.startsWith('image/');
export const isVideoFile = (type) => type?.startsWith('video/');
export const isAudioFile = (type) => type?.startsWith('audio/');

const DEFAULT_SERVER_PERMISSIONS = {
  viewChannels: true,
  manageServer: false,
  manageRoles: false,
  manageChannels: false,
  manageMessages: false,
  kickMembers: false,
  banMembers: false,
  createInvites: true,
  sendMessages: true,
  attachFiles: true,
  mentionEveryone: false,
  connectVoice: true,
  speakVoice: true,
  videoVoice: true,
  muteMembers: false,
  deafenMembers: false,
  moveMembers: false
};

export const getServerPermissionsForUser = (server, userId) => {
  const member = server?.members?.find(m => m.user?._id === userId || m.user?.toString?.() === userId);
  if (!member) return { ...DEFAULT_SERVER_PERMISSIONS };

  if (member.role === 'owner') {
    return Object.keys(DEFAULT_SERVER_PERMISSIONS).reduce((acc, key) => {
      acc[key] = true;
      return acc;
    }, {});
  }

  const roleIds = new Set(member.roleIds || []);
  const roles = (server?.roles || [])
    .filter(role => roleIds.has(role.id))
    .sort((a, b) => (b.position || 0) - (a.position || 0));

  const merged = { ...DEFAULT_SERVER_PERMISSIONS };
  roles.forEach(role => {
    Object.entries(role.permissions || {}).forEach(([key, value]) => {
      merged[key] = !!value;
    });
  });

  return merged;
};
