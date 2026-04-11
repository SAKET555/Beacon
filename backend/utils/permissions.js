const DEFAULT_PERMISSIONS = {
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

const SYSTEM_ROLE_PRESETS = {
  owner: {
    ...Object.keys(DEFAULT_PERMISSIONS).reduce((acc, key) => {
      acc[key] = true;
      return acc;
    }, {}),
    manageServer: true,
    manageRoles: true
  },
  admin: {
    ...DEFAULT_PERMISSIONS,
    manageServer: true,
    manageRoles: true,
    manageChannels: true,
    manageMessages: true,
    kickMembers: true,
    banMembers: true,
    mentionEveryone: true,
    muteMembers: true,
    deafenMembers: true,
    moveMembers: true
  },
  moderator: {
    ...DEFAULT_PERMISSIONS,
    manageMessages: true,
    kickMembers: true,
    muteMembers: true,
    deafenMembers: true,
    moveMembers: true
  },
  member: {
    ...DEFAULT_PERMISSIONS
  }
};

const buildDefaultRoles = () => {
  const now = Date.now();
  return [
    {
      id: `owner-${now}`,
      name: 'Owner',
      color: '#f59e0b',
      position: 100,
      isSystem: true,
      permissions: SYSTEM_ROLE_PRESETS.owner
    },
    {
      id: `admin-${now}`,
      name: 'Admin',
      color: '#ef4444',
      position: 80,
      isSystem: true,
      permissions: SYSTEM_ROLE_PRESETS.admin
    },
    {
      id: `moderator-${now}`,
      name: 'Moderator',
      color: '#3b82f6',
      position: 60,
      isSystem: true,
      permissions: SYSTEM_ROLE_PRESETS.moderator
    },
    {
      id: `member-${now}`,
      name: 'Member',
      color: '#6b7280',
      position: 10,
      isSystem: true,
      permissions: SYSTEM_ROLE_PRESETS.member
    }
  ];
};

const findRoleByName = (roles, name) =>
  (roles || []).find(r => r.name.toLowerCase() === name.toLowerCase());

const ensureServerRoles = (server) => {
  let changed = false;

  if (!Array.isArray(server.roles) || server.roles.length === 0) {
    server.roles = buildDefaultRoles();
    changed = true;
  }

  const ownerRole = findRoleByName(server.roles, 'owner');
  const adminRole = findRoleByName(server.roles, 'admin');
  const moderatorRole = findRoleByName(server.roles, 'moderator');
  const memberRole = findRoleByName(server.roles, 'member');

  server.members.forEach(member => {
    if (!Array.isArray(member.roleIds) || member.roleIds.length === 0) {
      const assigned = [];
      if (member.role === 'owner' && ownerRole) assigned.push(ownerRole.id);
      else if (member.role === 'admin' && adminRole) assigned.push(adminRole.id);
      else if (member.role === 'moderator' && moderatorRole) assigned.push(moderatorRole.id);
      else if (memberRole) assigned.push(memberRole.id);
      member.roleIds = assigned;
      changed = true;
    }
  });

  return changed;
};

const getMemberRoles = (server, member) => {
  if (!member) return [];
  const ids = new Set(member.roleIds || []);
  return (server.roles || []).filter(r => ids.has(r.id));
};

const getMemberPermissions = (server, member) => {
  const merged = { ...DEFAULT_PERMISSIONS };
  const roles = getMemberRoles(server, member)
    .sort((a, b) => (b.position || 0) - (a.position || 0));

  roles.forEach(role => {
    Object.entries(role.permissions || {}).forEach(([key, value]) => {
      merged[key] = !!value;
    });
  });

  if (member?.role === 'owner') {
    Object.keys(merged).forEach(key => {
      merged[key] = true;
    });
  }

  return merged;
};

const hasServerPermission = (server, member, permission) => {
  const permissions = getMemberPermissions(server, member);
  return !!permissions[permission];
};

module.exports = {
  DEFAULT_PERMISSIONS,
  ensureServerRoles,
  getMemberPermissions,
  hasServerPermission
};
