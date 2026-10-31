"""Role-based permissions (same data model as before)."""
import time

DEFAULT_PERMISSIONS = {
    'viewChannels': True,
    'manageServer': False,
    'manageRoles': False,
    'manageChannels': False,
    'manageMessages': False,
    'kickMembers': False,
    'banMembers': False,
    'createInvites': True,
    'sendMessages': True,
    'attachFiles': True,
    'mentionEveryone': False,
    'connectVoice': True,
    'speakVoice': True,
    'videoVoice': True,
    'muteMembers': False,
    'deafenMembers': False,
    'moveMembers': False,
}
PERMISSION_KEYS = list(DEFAULT_PERMISSIONS)

SYSTEM_ROLE_PRESETS = {
    'owner': {key: True for key in DEFAULT_PERMISSIONS},
    'admin': {**DEFAULT_PERMISSIONS, **{k: True for k in (
        'manageServer', 'manageRoles', 'manageChannels', 'manageMessages', 'kickMembers',
        'banMembers', 'mentionEveryone', 'muteMembers', 'deafenMembers', 'moveMembers')}},
    'moderator': {**DEFAULT_PERMISSIONS, **{k: True for k in (
        'manageMessages', 'kickMembers', 'muteMembers', 'deafenMembers', 'moveMembers')}},
    'member': dict(DEFAULT_PERMISSIONS),
}


def build_default_roles():
    stamp = int(time.time() * 1000)
    spec = [('owner', 'Owner', '#f59e0b', 100), ('admin', 'Admin', '#ef4444', 80),
            ('moderator', 'Moderator', '#3b82f6', 60), ('member', 'Member', '#6b7280', 10)]
    return [{'id': f'{key}-{stamp}', 'name': name, 'color': color, 'position': position,
             'isSystem': True, 'permissions': dict(SYSTEM_ROLE_PRESETS[key])}
            for key, name, color, position in spec]


def _find_role(roles, name):
    return next((r for r in roles or [] if r.get('name', '').lower() == name), None)


def ensure_server_roles(server):
    """Creates default roles and assigns members without roles. Returns True if changed."""
    changed = False
    if not server.get('roles'):
        server['roles'] = build_default_roles()
        changed = True

    by_legacy = {name: _find_role(server['roles'], name) for name in ('owner', 'admin', 'moderator', 'member')}
    for member in server.get('members', []):
        if not member.get('roleIds'):
            role = by_legacy.get(member.get('role')) or by_legacy['member']
            member['roleIds'] = [role['id']] if role else []
            changed = True
    return changed


def member_permissions(server, member):
    merged = dict(DEFAULT_PERMISSIONS)
    if not member:
        return merged
    ids = set(member.get('roleIds') or [])
    roles = sorted((r for r in server.get('roles') or [] if r.get('id') in ids),
                   key=lambda r: r.get('position') or 0, reverse=True)
    for role in roles:
        for key, value in (role.get('permissions') or {}).items():
            merged[key] = bool(value)
    if member.get('role') == 'owner':
        merged = {key: True for key in merged}
    return merged


def has_permission(server, member, permission):
    return bool(member_permissions(server, member).get(permission))


def clean_permissions(value):
    """Keeps only known permission keys, coerced to booleans."""
    if not isinstance(value, dict):
        return {}
    return {key: bool(value[key]) for key in PERMISSION_KEYS if key in value}


def can_grant(server, actor, permissions):
    """Non-owners may only hand out permissions they hold themselves."""
    if actor.get('role') == 'owner':
        return True
    held = member_permissions(server, actor)
    return all(not value or held.get(key) for key, value in (permissions or {}).items())


def is_owner_role(role):
    return bool(role.get('isSystem')) and role.get('name', '').lower() == 'owner'
