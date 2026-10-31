from datetime import datetime, timedelta

from bson import ObjectId
from fastapi import APIRouter, Request

from .. import db
from ..access import find_member, server_access
from ..http import ApiError, read_json, require_id, respond, route
from ..models import new_audit_log
from ..permissions import has_permission
from ..populate import populate
from ..realtime import emit, evict_from_server
from ..security import current_user
from ..validation import clean_string, parse_paging, sanitize_server_settings

router = APIRouter()

STAFF_PERMISSIONS = ('manageServer', 'manageRoles', 'kickMembers', 'banMembers')


async def _audit(server_id, action, user_id, target='', details=None):
    await db.audit_logs().insert_one(new_audit_log(server_id, action, user_id, target, details=details))


async def _remove_member(server, user_id, event):
    server['members'] = [m for m in server['members'] if not db.same_id(m['user'], user_id)]
    await db.servers().update_one({'_id': server['_id']},
                                  {'$set': {'members': server['members'], 'updatedAt': db.now()}})
    await db.users().update_one({'_id': ObjectId(str(user_id))}, {'$pull': {'servers': server['_id']}})
    await emit(event, {'serverId': server['_id']}, f'user:{user_id}')
    await evict_from_server(user_id, server)
    await emit('server:member_left', {'serverId': server['_id'], 'userId': str(user_id)},
               f"server:{server['_id']}")


def _check_target(server, requester, target_id, verb):
    target = find_member(server, target_id)
    if not target:
        raise ApiError(404, 'Member not found')
    if target.get('role') == 'owner':
        raise ApiError(400, f'Cannot {verb} owner')
    if db.same_id(target['user'], requester['user']):
        raise ApiError(400, f'You cannot {verb} yourself')
    if requester.get('role') != 'owner' and target.get('role') == 'admin':
        raise ApiError(403, f'Only the owner can {verb} admins')
    return target


@router.get('/{serverId}/stats')
@route('Failed to fetch stats')
async def stats(request: Request, serverId: str):
    user = await current_user(request)
    require_id(serverId)
    server, _ = await server_access(serverId, user['_id'], 'manageServer')
    today = db.now().replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = db.now() - timedelta(days=7)
    count = db.messages().count_documents
    return respond({'stats': {
        'totalMembers': len(server['members']),
        'totalChannels': len(server.get('channels', [])),
        'totalMessages': await count({'server': server['_id']}),
        'messagesToday': await count({'server': server['_id'], 'createdAt': {'$gte': today}}),
        'messagesThisWeek': await count({'server': server['_id'], 'createdAt': {'$gte': week_ago}}),
    }})


@router.get('/{serverId}/members')
@route('Failed to fetch members')
async def members(request: Request, serverId: str):
    """Staff only; never exposes email addresses."""
    user = await current_user(request)
    require_id(serverId)
    server, member = await server_access(serverId, user['_id'])
    if not any(has_permission(server, member, p) for p in STAFF_PERMISSIONS):
        raise ApiError(403, 'Insufficient permissions')
    await populate(server, 'members.user', db.users(), 'username displayName avatar status createdAt')
    return respond({'members': server['members']})


@router.patch('/{serverId}/members/{userId}/role')
@route('Failed to update role')
async def set_role(request: Request, serverId: str, userId: str):
    user = await current_user(request)
    require_id(serverId, userId)
    role = (await read_json(request)).get('role')
    if role not in ('admin', 'moderator', 'member'):
        raise ApiError(400, 'Invalid role')
    server, requester = await server_access(serverId, user['_id'], 'manageRoles')
    target = find_member(server, userId)
    if not target:
        raise ApiError(404, 'Member not found')
    if target.get('role') == 'owner':
        raise ApiError(400, 'Cannot change owner role')
    if requester.get('role') != 'owner' and (role == 'admin' or target.get('role') == 'admin'):
        raise ApiError(403, 'Only the owner can manage admins')

    target['role'] = role
    await db.servers().update_one({'_id': server['_id']}, {'$set': {'members': server['members']}})
    await _audit(server['_id'], 'member_role_update', user['_id'], userId, {'newRole': role})
    return respond({'member': target})


@router.delete('/{serverId}/members/{userId}')
@route('Failed to kick member')
async def kick(request: Request, serverId: str, userId: str):
    user = await current_user(request)
    require_id(serverId, userId)
    server, requester = await server_access(serverId, user['_id'], 'kickMembers')
    _check_target(server, requester, userId, 'kick')
    await _remove_member(server, userId, 'server:kicked')
    await _audit(server['_id'], 'member_kick', user['_id'], userId)
    return respond({'message': 'Member kicked'})


@router.post('/{serverId}/bans/{userId}')
@route('Failed to ban member')
async def ban(request: Request, serverId: str, userId: str):
    """New: banned users are removed and can't rejoin (even with the invite code)."""
    user = await current_user(request)
    require_id(serverId, userId)
    server, requester = await server_access(serverId, user['_id'], 'banMembers')
    if find_member(server, userId):
        _check_target(server, requester, userId, 'ban')
    elif db.same_id(server['owner'], userId):
        raise ApiError(400, 'Cannot ban owner')
    if any(db.same_id(b.get('user'), userId) for b in server.get('bans', [])):
        raise ApiError(400, 'User is already banned')

    reason = clean_string((await read_json(request)).get('reason'), 256) or ''
    entry = {'user': ObjectId(userId), 'reason': reason, 'bannedBy': user['_id'], 'bannedAt': db.now()}
    await db.servers().update_one({'_id': server['_id']}, {'$push': {'bans': entry}})
    if find_member(server, userId):
        await _remove_member(server, userId, 'server:kicked')
    await _audit(server['_id'], 'member_ban', user['_id'], userId, {'reason': reason})
    return respond({'message': 'Member banned'})


@router.get('/{serverId}/bans')
@route('Failed to fetch bans')
async def list_bans(request: Request, serverId: str):
    user = await current_user(request)
    require_id(serverId)
    server, _ = await server_access(serverId, user['_id'], 'banMembers')
    bans = server.get('bans', [])
    await populate(bans, 'user', db.users(), 'username displayName avatar')
    return respond({'bans': bans})


@router.delete('/{serverId}/bans/{userId}')
@route('Failed to unban member')
async def unban(request: Request, serverId: str, userId: str):
    user = await current_user(request)
    require_id(serverId, userId)
    server, _ = await server_access(serverId, user['_id'], 'banMembers')
    result = await db.servers().update_one({'_id': server['_id']},
                                           {'$pull': {'bans': {'user': ObjectId(userId)}}})
    if not result.modified_count:
        raise ApiError(404, 'User is not banned')
    await _audit(server['_id'], 'moderation_action', user['_id'], userId, {'action': 'unban'})
    return respond({'message': 'Member unbanned'})


@router.get('/{serverId}/audit-log')
@route('Failed to fetch audit log')
async def audit_log(request: Request, serverId: str):
    user = await current_user(request)
    require_id(serverId)
    server, _ = await server_access(serverId, user['_id'], 'manageServer')
    page, limit, skip = parse_paging(request.query_params, default_limit=50, max_limit=100)
    query = {'server': server['_id']}
    logs = await db.audit_logs().find(query).sort('createdAt', -1).skip(skip).limit(limit).to_list(limit)
    await populate(logs, 'user', db.users(), 'username displayName avatar')
    total = await db.audit_logs().count_documents(query)
    return respond({'logs': logs, 'total': total, 'hasMore': total > page * limit})


@router.patch('/{serverId}/settings')
@route('Failed to update settings')
async def update_settings(request: Request, serverId: str):
    user = await current_user(request)
    require_id(serverId)
    server, _ = await server_access(serverId, user['_id'], 'manageServer')
    settings = sanitize_server_settings((await read_json(request)).get('settings'))
    if 'defaultChannel' in settings:
        if not any(db.same_id(c, settings['defaultChannel']) for c in server.get('channels', [])):
            raise ApiError(400, 'Default channel must belong to this server')
        settings['defaultChannel'] = ObjectId(settings['defaultChannel'])
    if settings:
        await db.servers().update_one({'_id': server['_id']},
                                      {'$set': {f'settings.{k}': v for k, v in settings.items()}})
    server.setdefault('settings', {}).update(settings)
    await _audit(server['_id'], 'settings_update', user['_id'], details={'updated': list(settings)})
    return respond({'settings': server['settings']})
