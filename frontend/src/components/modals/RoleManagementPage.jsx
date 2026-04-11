import { useMemo, useState } from 'react';
import { Plus, Trash2, Paintbrush, Save } from 'lucide-react';
import toast from 'react-hot-toast';

const ROLE_COLORS = ['#ef4444', '#f59e0b', '#84cc16', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280'];

export default function RoleManagementPage({ roles, members, onCreateRole, onUpdateRole, onDeleteRole, onUpdateMemberRoles, canManageRoles }) {
  const [newRoleName, setNewRoleName] = useState('');
  const [savingRoleId, setSavingRoleId] = useState('');

  const sortedRoles = useMemo(
    () => [...(roles || [])].sort((a, b) => (b.position || 0) - (a.position || 0)),
    [roles]
  );

  const memberOptions = useMemo(() =>
    (members || []).map(m => ({
      id: m.user?._id,
      name: m.user?.displayName || m.user?.username || 'Unknown',
      roleIds: m.roleIds || []
    })), [members]);

  const handleCreate = async () => {
    const name = newRoleName.trim();
    if (!name) return;
    const result = await onCreateRole(name);
    if (result?.success) {
      setNewRoleName('');
      toast.success('Role created');
    } else {
      toast.error(result?.error || 'Failed to create role');
    }
  };

  const handleRoleColor = async (roleId, color) => {
    setSavingRoleId(roleId);
    const result = await onUpdateRole(roleId, { color });
    setSavingRoleId('');
    if (!result?.success) toast.error(result?.error || 'Failed to update role');
  };

  const handleDelete = async (roleId) => {
    const result = await onDeleteRole(roleId);
    if (result?.success) toast.success('Role deleted');
    else toast.error(result?.error || 'Failed to delete role');
  };

  const handleMemberRoleToggle = async (memberId, roleId, checked, currentRoleIds) => {
    const nextRoleIds = checked
      ? [...new Set([...(currentRoleIds || []), roleId])]
      : (currentRoleIds || []).filter(id => id !== roleId);

    const result = await onUpdateMemberRoles(memberId, nextRoleIds);
    if (!result?.success) toast.error(result?.error || 'Failed to update member roles');
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-beacon-border p-4 bg-beacon-hover/60">
        <h3 className="font-semibold text-text-primary mb-2">Create Role</h3>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            placeholder="Role name"
            className="input-field flex-1"
            disabled={!canManageRoles}
          />
          <button onClick={handleCreate} disabled={!canManageRoles || !newRoleName.trim()} className="btn-primary inline-flex items-center gap-2">
            <Plus size={16} /> Add Role
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-beacon-border p-4 bg-beacon-hover/60 space-y-4">
        <h3 className="font-semibold text-text-primary">Roles</h3>
        {sortedRoles.map(role => (
          <div key={role.id} className="border border-beacon-border rounded-lg p-3 bg-beacon-bg/40">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: role.color || '#6b7280' }} />
                <p className="text-sm font-medium text-text-primary truncate">{role.name}</p>
                {role.isSystem && <span className="text-[10px] px-2 py-0.5 rounded-full bg-beacon-border text-text-muted">System</span>}
              </div>
              {!role.isSystem && canManageRoles && (
                <button onClick={() => handleDelete(role.id)} className="text-red-400 hover:text-red-300">
                  <Trash2 size={16} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Paintbrush size={14} className="text-text-muted" />
              {ROLE_COLORS.map(color => (
                <button
                  key={color}
                  onClick={() => handleRoleColor(role.id, color)}
                  disabled={!canManageRoles || savingRoleId === role.id}
                  className="w-6 h-6 rounded-full border border-white/20 disabled:opacity-40"
                  style={{ backgroundColor: color }}
                />
              ))}
              {savingRoleId === role.id && <Save size={14} className="text-text-muted animate-pulse" />}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-beacon-border p-4 bg-beacon-hover/60">
        <h3 className="font-semibold text-text-primary mb-3">Assign Roles To Members</h3>
        <div className="space-y-3 max-h-[260px] overflow-y-auto pr-1">
          {memberOptions.map(member => (
            <div key={member.id} className="border border-beacon-border rounded-lg p-3 bg-beacon-bg/40">
              <p className="text-sm font-medium text-text-primary mb-2">{member.name}</p>
              <div className="flex flex-wrap gap-2">
                {sortedRoles.map(role => (
                  <label key={`${member.id}-${role.id}`} className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={(member.roleIds || []).includes(role.id)}
                      onChange={(e) => handleMemberRoleToggle(member.id, role.id, e.target.checked, member.roleIds)}
                      disabled={!canManageRoles || role.name.toLowerCase() === 'owner'}
                    />
                    <span>{role.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
