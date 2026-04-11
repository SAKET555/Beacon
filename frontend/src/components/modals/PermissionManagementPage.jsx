import { ShieldCheck } from 'lucide-react';

const LABELS = {
  viewChannels: 'View Channels',
  manageServer: 'Manage Server',
  manageRoles: 'Manage Roles',
  manageChannels: 'Manage Channels',
  manageMessages: 'Manage Messages',
  kickMembers: 'Kick Members',
  banMembers: 'Ban Members',
  createInvites: 'Create Invites',
  sendMessages: 'Send Messages',
  attachFiles: 'Attach Files',
  mentionEveryone: 'Mention Everyone',
  connectVoice: 'Connect Voice',
  speakVoice: 'Speak Voice',
  videoVoice: 'Video',
  muteMembers: 'Mute Members',
  deafenMembers: 'Deafen Members',
  moveMembers: 'Move Members'
};

export default function PermissionManagementPage({ roles, permissionKeys, canManageRoles, onUpdateRolePermissions }) {
  const orderedRoles = [...(roles || [])].sort((a, b) => (b.position || 0) - (a.position || 0));
  const keys = permissionKeys || Object.keys(LABELS);

  return (
    <div className="rounded-xl border border-beacon-border p-4 bg-beacon-hover/60">
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck size={18} className="text-beacon-accent" />
        <h3 className="font-semibold text-text-primary">Permission Toggles</h3>
      </div>

      <div className="space-y-4">
        {orderedRoles.map(role => (
          <div key={role.id} className="border border-beacon-border rounded-lg p-3 bg-beacon-bg/40">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: role.color || '#6b7280' }} />
              <p className="text-sm font-semibold text-text-primary">{role.name}</p>
              {role.isSystem && <span className="text-[10px] px-2 py-0.5 rounded-full bg-beacon-border text-text-muted">System</span>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {keys.map((key) => {
                const checked = !!role.permissions?.[key];
                return (
                  <label key={`${role.id}-${key}`} className="flex items-center justify-between gap-3 p-2 rounded-md border border-beacon-border">
                    <span className="text-xs text-text-secondary">{LABELS[key] || key}</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!canManageRoles || role.name.toLowerCase() === 'owner'}
                      onChange={(e) => onUpdateRolePermissions(role.id, { [key]: e.target.checked })}
                    />
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
