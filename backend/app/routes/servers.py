import re
import secrets
import time

from bson import ObjectId
from fastapi import APIRouter, Request

from .. import db
from ..access import find_member, server_access
from ..http import ApiError, ValidationFailed, read_json, require_id, respond, route
from ..models import new_audit_log, new_channel, new_member, new_server
from ..permissions import (DEFAULT_PERMISSIONS, PERMISSION_KEYS, can_grant, clean_permissions,
                           ensure_server_roles, has_permission, is_owner_role, member_permissions)
from ..populate import populate
from ..realtime import emit, evict_from_server
from ..security import current_user
from ..validation import clean_media_url, clean_string, is_hex_color, sanitize_server_settings

router = APIRouter()

MEMBER_FIELDS = 'username displayName avatar status'


async def _save(server, *fields):
    """Writes the given top-level fields back (Mongoose's server.save())."""
    update = {field: server[field] for field in fields}
    update['updatedAt'] = server['updatedAt'] = db.now()
    await db.servers().update_one({'_id': server['_id']}, {'$set': update})


async def _audit(server_id, action, user_id, target='', target_id=None, details=None):
    await db.audit_logs().insert_one(new_audit_log(server_id, action, user_id, target, target_id, details))


async def _load(server_id):
    require_id(server_id)
    server = await db.servers().find_one({'_id': ObjectId(server_id)})
    if not server:
        raise ApiError(404, 'Server not found')
    return server


def _actor(server, user_id, permission):
    member = find_member(server, user_id)
    if not member or not has_permission(server, member, permission):
        raise ApiError(403, 'Insufficient permissions')
    return member


def _sorted_roles(server):
    return sorted(server.get('roles') or [], key=lambda r: r.get('position') or 0, reverse=True)


@router.get('')
@router.get('/')
@route('Failed to fetch servers')
async def list_servers(request: Request):
    user = await current_user(request)
    servers = await db.servers().find(
        {'members.user': user['_id']},
        {'name': 1, 'icon': 1, 'description': 1, 'members': 1, 'inviteCode': 1}).to_list(500)
    return respond({'servers': servers})


@router.post('')
@router.post('/')
@route('Failed to create server')
async def create_server(request: Request):
    user = await current_user(request)
    body = await read_json(request)
    name, description = body.get('name'), body.get('description')
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 64:
        raise ValidationFailed([{'type': 'field', 'value': name, 'msg': 'Server name must be 1-64 characters',
                                 'path': 'name', 'location': 'body'}])
    if description is not None and (not isinstance(description, str) or len(description) > 256):
        raise ValidationFailed([{'type': 'field', 'value': description, 'msg': 'Description is too long',
                                 'path': 'description', 'location': 'body'}])
    icon = clean_media_url(body.get('icon')) if body.get('icon') else ''
    if icon is None:
        raise ApiError(400, 'Icon must be an https URL')

    server = new_server(name.strip(), description or '', icon, user['_id'])
    ensure_server_roles(server)
    general = new_channel('general', 'text', server['_id'], 'General discussion')
    announcements = new_channel('announcements', 'announcement', server['_id'], 'Server announcements')
    server['channels'] = [general['_id'], announcements['_id']]
    server['settings']['defaultChannel'] = general['_id']

    await db.servers().insert_one(server)
    await db.channels().insert_many([general, announcements])
    await db.users().update_one({'_id': user['_id']}, {'$addToSet': {'servers': server['_id']}})

    await populate(server, 'members.user', db.users(), MEMBER_FIELDS)
    return respond({'server': server}, 201)


@router.post('/join/invite/{code}')
@route('Failed to join server')
async def join_by_invite(request: Request, code: str):
    user = await current_user(request)
    code = code.strip().upper()
    if not re.fullmatch(r'[A-Z0-9]{4,32}', code):
        raise ApiError(404, 'Invalid invite code')
    server = await db.servers().find_one({'inviteCode': code})
    if not server or not server.get('settings', {}).get('allowInvites', True):
        raise ApiError(404, 'Invalid invite code')
    return await _add_member(request, server, user)


async def _add_member(request, server, user):
    if find_member(server, user['_id']):
        raise ApiError(400, 'Already a member')
    if server.get('bans') and any(db.same_id(b.get('user'), user['_id']) for b in server['bans']):
        raise ApiError(403, 'You are banned from this server')

    server['members'].append(new_member(user['_id']))
    ensure_server_roles(server)  # assigns the default Member role to the newcomer
    await _save(server, 'members', 'roles')
    await db.users().update_one({'_id': user['_id']}, {'$addToSet': {'servers': server['_id']}})

    await populate(server, 'members.user', db.users(), MEMBER_FIELDS)
    await emit('server:member_joined', {'serverId': server['_id'], 'userId': user['_id']},
               f"server:{server['_id']}")
    return respond({'server': server})


@router.get('/{id}')
@route('Failed to fetch server')
async def get_server(request: Request, id: str):
    user = await current_user(request)
    server = await _load(id)
    is_member = bool(find_member(server, user['_id']))
    if not is_member and not server.get('settings', {}).get('isPublic', True):
        raise ApiError(403, 'Not a member of this server')
    if ensure_server_roles(server):
        await _save(server, 'roles', 'members')
    await populate(server, 'members.user', db.users(), MEMBER_FIELDS)
    await populate(server, 'channels', db.channels(), 'name type topic')
    return respond({'server': server})


@router.patch('/{id}')
@route('Failed to update server')
async def update_server(request: Request, id: str):
    user = await current_user(request)
    server = await _load(id)
    ensure_server_roles(server)
    _actor(server, user['_id'], 'manageServer')
    body = await read_json(request)

    if 'name' in body:
        name = clean_string(body['name'], 64)
        if not name:
            raise ApiError(400, 'Invalid server name')
        server['name'] = name
    if 'description' in body:
        description = clean_string(body['description'], 256)
        if description is None:
            raise ApiError(400, 'Invalid description')
        server['description'] = description
    for field in ('icon', 'banner'):
        if field in body:
            url = clean_media_url(body[field])
            if url is None:
                raise ApiError(400, f'{field} must be an https URL')
            server[field] = url

    settings = sanitize_server_settings(body.get('settings'))
    if 'defaultChannel' in settings:
        if not any(db.same_id(c, settings['defaultChannel']) for c in server.get('channels', [])):
            raise ApiError(400, 'Default channel must belong to this server')
        settings['defaultChannel'] = ObjectId(settings['defaultChannel'])
    server.setdefault('settings', {}).update(settings)

    await _save(server, 'name', 'description', 'icon', 'banner', 'settings', 'roles', 'members')
    await _audit(server['_id'], 'server_update', user['_id'], 'Server', details={'updated': list(body)})
    return respond({'server': server})


@router.delete('/{id}')
@route('Failed to delete server')
async def delete_server(request: Request, id: str):
    user = await current_user(request)
    server = await _load(id)
    if not db.same_id(server['owner'], user['_id']):
        raise ApiError(403, 'Only the owner can delete the server')

    await db.users().update_many({'servers': server['_id']}, {'$pull': {'servers': server['_id']}})
    for collection in (db.messages(), db.notifications(), db.audit_logs(), db.channels(), db.call_logs(), db.polls()):
        await collection.delete_many({'server': server['_id']})
    await db.servers().delete_one({'_id': server['_id']})

    await emit('server:deleted', {'serverId': server['_id']}, f"server:{server['_id']}")
    for member in server.get('members', []):
        await evict_from_server(member['user'], server)
    return respond({'message': 'Server deleted'})


@router.post('/{id}/join')
@route('Failed to join server')
async def join_server(request: Request, id: str):
    user = await current_user(request)
    server = await _load(id)
    if find_member(server, user['_id']):
        raise ApiError(400, 'Already a member')
    # Joining by id is only for public servers; private ones need an invite code
    if not server.get('settings', {}).get('isPublic', True):
        raise ApiError(403, 'This server is private. Ask for an invite code.')
    return await _add_member(request, server, user)


@router.post('/{id}/leave')
@route('Failed to leave server')
async def leave_server(request: Request, id: str):
    user = await current_user(request)
    server = await _load(id)
    if db.same_id(server['owner'], user['_id']):
        raise ApiError(400, 'Owner cannot leave. Transfer ownership or delete the server.')

    server['members'] = [m for m in server['members'] if not db.same_id(m['user'], user['_id'])]
    await _save(server, 'members')
    await db.users().update_one({'_id': user['_id']}, {'$pull': {'servers': server['_id']}})
    await evict_from_server(user['_id'], server)
    await emit('server:member_left', {'serverId': server['_id'], 'userId': user['_id']}, f"server:{server['_id']}")
    return respond({'message': 'Left server'})


@router.post('/{id}/transfer-ownership')
@route('Failed to transfer ownership')
async def transfer_ownership(request: Request, id: str):
    """New: the owner can hand the server to another member."""
    user = await current_user(request)
    server = await _load(id)
    if not db.same_id(server['owner'], user['_id']):
        raise ApiError(403, 'Only the owner can transfer ownership')
    target_id = (await read_json(request)).get('userId')
    require_id(target_id)
    target = find_member(server, target_id)
    if not target or db.same_id(target['user'], user['_id']):
        raise ApiError(400, 'Pick another member of this server')

    ensure_server_roles(server)
    roles = {r['name'].lower(): r['id'] for r in server['roles'] if r.get('isSystem')}
    old_owner = find_member(server, user['_id'])
    old_owner['role'] = 'admin'
    old_owner['roleIds'] = [roles['admin']] if 'admin' in roles else []
    target['role'] = 'owner'
    target['roleIds'] = [roles['owner']] if 'owner' in roles else []
    server['owner'] = target['user']
    await _save(server, 'owner', 'members')
    await _audit(server['_id'], 'server_update', user['_id'], 'Ownership', target['user'],
                 {'transferredTo': str(target['user'])})
    await emit('server:updated', {'serverId': server['_id']}, f"server:{server['_id']}")
    return respond({'server': server})


@router.post('/{id}/invite/regenerate')
@route('Failed to regenerate invite')
async def regenerate_invite(request: Request, id: str):
    """New: invalidates the old invite code (e.g. after it leaked)."""
    user = await current_user(request)
    server = await _load(id)
    ensure_server_roles(server)
    _actor(server, user['_id'], 'manageServer')
    server['inviteCode'] = secrets.token_hex(5).upper()
    await _save(server, 'inviteCode')
    await _audit(server['_id'], 'invite_create', user['_id'], 'Invite regenerated')
    return respond({'inviteCode': server['inviteCode']})


@router.get('/{id}/members')
@route('Failed to fetch members')
async def list_members(request: Request, id: str):
    user = await current_user(request)
    server = await _load(id)
    if not find_member(server, user['_id']):
        raise ApiError(403, 'Not a member of this server')
    if ensure_server_roles(server):
        await _save(server, 'roles', 'members')
    await populate(server, 'members.user', db.users(), MEMBER_FIELDS + ' customStatus')
    return respond({'members': server['members']})


@router.get('/{id}/roles')
@route('Failed to fetch roles')
async def list_roles(request: Request, id: str):
    user = await current_user(request)
    server = await _load(id)
    if ensure_server_roles(server):
        await _save(server, 'roles', 'members')
    member = find_member(server, user['_id'])
    if not member:
        raise ApiError(403, 'Not a member of this server')
    return respond({'roles': _sorted_roles(server), 'permissions': member_permissions(server, member),
                    'permissionKeys': PERMISSION_KEYS})


@router.post('/{id}/roles')
@route('Failed to create role')
async def create_role(request: Request, id: str):
    user = await current_user(request)
    server = await _load(id)
    ensure_server_roles(server)
    _actor(server, user['_id'], 'manageRoles')
    body = await read_json(request)

    name = clean_string(body.get('name'), 32)
    if not name:
        raise ApiError(400, 'Role name is required (max 32 characters)')
    if 'color' in body and not is_hex_color(body['color']):
        raise ApiError(400, 'Color must be a hex value like #8b5cf6')
    if len(server['roles']) >= 100:
        raise ApiError(400, 'Role limit reached')
    if any(r['name'].lower() == name.lower() for r in server['roles']):
        raise ApiError(400, 'Role name already exists')

    role = {
        'id': f'role-{int(time.time() * 1000)}-{secrets.token_hex(3)}',
        'name': name,
        'color': body.get('color') or '#8b5cf6',
        'position': max([r.get('position') or 0 for r in server['roles']] + [0]) + 1,
        'isSystem': False,
        'permissions': dict(DEFAULT_PERMISSIONS),
    }
    server['roles'].append(role)
    await _save(server, 'roles', 'members')
    await _audit(server['_id'], 'role_create', user['_id'], role['name'], details={'roleId': role['id']})
    return respond({'role': role, 'roles': server['roles']}, 201)


@router.patch('/{id}/roles/{roleId}')
@route('Failed to update role')
async def update_role(request: Request, id: str, roleId: str):
    user = await current_user(request)
    server = await _load(id)
    ensure_server_roles(server)
    member = _actor(server, user['_id'], 'manageRoles')
    role = next((r for r in server['roles'] if r['id'] == roleId), None)
    if not role:
        raise ApiError(404, 'Role not found')
    if is_owner_role(role) and member.get('role') != 'owner':
        raise ApiError(403, 'Only the owner can edit the Owner role')

    body = await read_json(request)
    permissions = clean_permissions(body.get('permissions'))
    if not can_grant(server, member, permissions):
        raise ApiError(403, 'You cannot grant permissions you do not have')
    if 'color' in body and not is_hex_color(body['color']):
        raise ApiError(400, 'Color must be a hex value like #8b5cf6')

    if not role.get('isSystem') and 'name' in body:
        name = clean_string(body['name'], 32)
        if not name:
            raise ApiError(400, 'Role name cannot be empty')
        if any(r['id'] != role['id'] and r['name'].lower() == name.lower() for r in server['roles']):
            raise ApiError(400, 'Role name already exists')
        role['name'] = name
    if 'color' in body:
        role['color'] = body['color']
    if 'position' in body:
        try:
            role['position'] = min(max(int(body['position']), 0), 1000)
        except (TypeError, ValueError):
            role['position'] = 0
    if permissions:
        role['permissions'] = {**DEFAULT_PERMISSIONS, **clean_permissions(role.get('permissions')), **permissions}

    await _save(server, 'roles', 'members')
    await _audit(server['_id'], 'role_update', user['_id'], role['name'], details={'roleId': role['id']})
    return respond({'role': role, 'roles': server['roles']})


@router.delete('/{id}/roles/{roleId}')
@route('Failed to delete role')
async def delete_role(request: Request, id: str, roleId: str):
    user = await current_user(request)
    server = await _load(id)
    ensure_server_roles(server)
    _actor(server, user['_id'], 'manageRoles')
    role = next((r for r in server['roles'] if r['id'] == roleId), None)
    if not role:
        raise ApiError(404, 'Role not found')
    if role.get('isSystem'):
        raise ApiError(400, 'System roles cannot be deleted')

    server['roles'] = [r for r in server['roles'] if r['id'] != role['id']]
    for member in server['members']:
        member['roleIds'] = [rid for rid in member.get('roleIds') or [] if rid != role['id']]
    await _save(server, 'roles', 'members')
    await _audit(server['_id'], 'role_delete', user['_id'], role['name'], details={'roleId': role['id']})
    return respond({'roles': server['roles']})


@router.patch('/{id}/members/{memberId}/roles')
@route('Failed to update member roles')
async def set_member_roles(request: Request, id: str, memberId: str):
    user = await current_user(request)
    require_id(memberId)
    server = await _load(id)
    ensure_server_roles(server)
    actor = _actor(server, user['_id'], 'manageRoles')
    target = find_member(server, memberId)
    if not target:
        raise ApiError(404, 'Member not found')
    if target.get('role') == 'owner':
        raise ApiError(400, 'Cannot change owner roles')

    requested = (await read_json(request)).get('roleIds')
    requested = requested if isinstance(requested, list) else []
    roles_by_id = {r['id']: r for r in server['roles']}
    next_ids = list(dict.fromkeys(rid for rid in requested if isinstance(rid, str) and rid in roles_by_id))
    next_roles = [roles_by_id[rid] for rid in next_ids]

    # Non-owners can't hand out the Owner role or roles stronger than their own
    if actor.get('role') != 'owner':
        if any(is_owner_role(r) for r in next_roles):
            raise ApiError(403, 'Only the owner can assign the Owner role')
        if not all(can_grant(server, actor, r.get('permissions')) for r in next_roles):
            raise ApiError(403, 'You cannot assign a role with permissions you do not have')

    target['roleIds'] = next_ids
    names = {r['name'].lower() for r in next_roles}
    target['role'] = 'admin' if 'admin' in names else 'moderator' if 'moderator' in names else 'member'
    await _save(server, 'members')
    return respond({'member': target, 'members': server['members']})
