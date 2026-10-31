import re

from bson import ObjectId
from fastapi import APIRouter, Request

from .. import db
from ..access import channel_access, server_access
from ..http import ApiError, ValidationFailed, read_json, require_id, respond, route
from ..models import new_audit_log, new_channel
from ..permissions import has_permission
from ..populate import populate
from ..realtime import emit, leave_room_everyone
from ..security import current_user
from ..validation import clean_string, sanitize_channel_settings

router = APIRouter()

CHANNEL_NAME = re.compile(r'^[a-zA-Z0-9\-_]+$')
SERVER_CHANNEL_TYPES = ('text', 'announcement')


async def _audit(server_id, action, user_id, target='', target_id=None):
    await db.audit_logs().insert_one(new_audit_log(server_id, action, user_id, target, target_id))


@router.get('/{serverId}')
@route('Failed to fetch channels')
async def list_channels(request: Request, serverId: str):
    user = await current_user(request)
    require_id(serverId)
    server, _ = await server_access(serverId, user['_id'])
    channels = await db.channels().find({'server': server['_id']}, {'readBy': 0}) \
        .sort([('type', 1), ('name', 1)]).to_list(500)
    return respond({'channels': channels})


@router.post('/{serverId}')
@route('Failed to create channel')
async def create_channel(request: Request, serverId: str):
    user = await current_user(request)
    require_id(serverId)
    body = await read_json(request)
    name, type_, topic = body.get('name'), body.get('type'), body.get('topic')
    errors = []
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 64 or not CHANNEL_NAME.match(name.strip()):
        errors.append({'type': 'field', 'value': name, 'path': 'name', 'location': 'body',
                       'msg': 'Channel name can only contain letters, numbers, hyphens, and underscores'})
    if type_ is not None and type_ not in SERVER_CHANNEL_TYPES:
        errors.append({'type': 'field', 'value': type_, 'path': 'type', 'location': 'body', 'msg': 'Invalid value'})
    if topic is not None and (not isinstance(topic, str) or len(topic) > 256):
        errors.append({'type': 'field', 'value': topic, 'path': 'topic', 'location': 'body', 'msg': 'Invalid value'})
    if errors:
        raise ValidationFailed(errors)

    server, _ = await server_access(serverId, user['_id'], 'manageChannels')
    name = name.strip().lower()
    if await db.channels().find_one({'server': server['_id'], 'name': name}, {'_id': 1}):
        raise ApiError(400, 'Channel name already exists')

    channel = new_channel(name, type_ or 'text', server['_id'], topic or '')
    await db.channels().insert_one(channel)
    await db.servers().update_one({'_id': server['_id']},
                                  {'$push': {'channels': channel['_id']}, '$set': {'updatedAt': db.now()}})
    await _audit(server['_id'], 'channel_create', user['_id'], channel['name'], channel['_id'])
    await emit('channel:created', {'channel': channel}, f"server:{server['_id']}")
    return respond({'channel': channel}, 201)


@router.get('/{id}/details')
@route('Failed to fetch channel')
async def channel_details(request: Request, id: str):
    user = await current_user(request)
    require_id(id)
    channel, *_ = await channel_access(id, user['_id'])
    await populate(channel, 'pinnedMessages', db.messages())
    return respond({'channel': channel})


@router.patch('/{id}')
@route('Failed to update channel')
async def update_channel(request: Request, id: str):
    user = await current_user(request)
    require_id(id)
    channel, server, _ = await channel_access(id, user['_id'], 'manageChannels')
    if not server:
        raise ApiError(403, 'Direct message channels cannot be modified')
    body = await read_json(request)
    updates = {}

    if 'name' in body:
        name = clean_string(body['name'], 64)
        if not name or not CHANNEL_NAME.match(name):
            raise ApiError(400, 'Invalid channel name')
        name = name.lower()
        duplicate = await db.channels().find_one(
            {'server': channel['server'], 'name': name, '_id': {'$ne': channel['_id']}}, {'_id': 1})
        if duplicate:
            raise ApiError(400, 'Channel name already exists')
        updates['name'] = name
    if 'topic' in body:
        topic = clean_string(body['topic'], 256)
        if topic is None:
            raise ApiError(400, 'Invalid topic')
        updates['topic'] = topic
    if 'type' in body:
        if body['type'] not in SERVER_CHANNEL_TYPES:
            raise ApiError(400, 'Invalid channel type')
        updates['type'] = body['type']
    for key, value in sanitize_channel_settings(body.get('settings')).items():
        updates[f'settings.{key}'] = value

    updates['updatedAt'] = db.now()
    await db.channels().update_one({'_id': channel['_id']}, {'$set': updates})
    channel = await db.channels().find_one({'_id': channel['_id']})
    await _audit(channel['server'], 'channel_update', user['_id'], channel['name'], channel['_id'])
    await emit('channel:updated', {'channel': {k: v for k, v in channel.items() if k != 'readBy'}},
               f"server:{channel['server']}")
    return respond({'channel': channel})


@router.delete('/{id}')
@route('Failed to delete channel')
async def delete_channel(request: Request, id: str):
    user = await current_user(request)
    require_id(id)
    channel, server, _ = await channel_access(id, user['_id'], 'manageChannels')
    if not server:
        raise ApiError(403, 'Direct message channels cannot be deleted')

    remaining = [c for c in server.get('channels', []) if not db.same_id(c, channel['_id'])]
    update = {'channels': remaining, 'updatedAt': db.now()}
    if db.same_id(server.get('settings', {}).get('defaultChannel'), channel['_id']):
        update['settings.defaultChannel'] = remaining[0] if remaining else None
    await db.servers().update_one({'_id': server['_id']}, {'$set': update})
    await _audit(server['_id'], 'channel_delete', user['_id'], channel['name'], channel['_id'])

    for collection in (db.messages(), db.notifications(), db.polls()):
        await collection.delete_many({'channel': channel['_id']})
    await db.channels().delete_one({'_id': channel['_id']})

    await emit('channel:deleted', {'channelId': channel['_id']}, f"server:{server['_id']}")
    await leave_room_everyone(f"channel:{channel['_id']}")
    return respond({'message': 'Channel deleted'})


@router.post('/{id}/pin/{messageId}')
@route('Failed to pin message')
async def toggle_pin(request: Request, id: str, messageId: str):
    user = await current_user(request)
    require_id(id, messageId)
    channel, server, member = await channel_access(id, user['_id'])
    # In servers pinning is a moderation action; in DMs either participant may pin
    if server and not has_permission(server, member, 'manageMessages'):
        raise ApiError(403, 'Insufficient permissions')

    message = await db.messages().find_one({'_id': ObjectId(messageId)}, {'channel': 1})
    if not message or not db.same_id(message['channel'], channel['_id']):
        raise ApiError(404, 'Message not found in this channel')

    pins = channel.get('pinnedMessages', [])
    is_pinned = any(db.same_id(p, message['_id']) for p in pins)
    if is_pinned:
        pins = [p for p in pins if not db.same_id(p, message['_id'])]
    else:
        if len(pins) >= 50:
            raise ApiError(400, 'This channel has reached the pin limit (50)')
        pins = pins + [message['_id']]
    await db.channels().update_one({'_id': channel['_id']}, {'$set': {'pinnedMessages': pins}})
    await db.messages().update_one({'_id': message['_id']}, {'$set': {'isPinned': not is_pinned}})

    if server:
        await _audit(server['_id'], 'message_pin', user['_id'], 'unpin' if is_pinned else 'pin', message['_id'])
    await emit('message:pinned', {'messageId': message['_id'], 'isPinned': not is_pinned},
               f"channel:{channel['_id']}")
    return respond({'pinned': not is_pinned, 'pinnedMessages': pins})


@router.get('/{id}/pins')
@route('Failed to fetch pinned messages')
async def list_pins(request: Request, id: str):
    user = await current_user(request)
    require_id(id)
    channel, *_ = await channel_access(id, user['_id'])
    await populate(channel, 'pinnedMessages', db.messages())
    await populate(channel, 'pinnedMessages.author', db.users(), 'username displayName avatar')
    return respond({'pinnedMessages': channel.get('pinnedMessages', [])})


@router.post('/{id}/read')
@route('Failed to mark as read')
async def mark_read(request: Request, id: str):
    user = await current_user(request)
    require_id(id)
    channel, *_ = await channel_access(id, user['_id'])
    last_read = db.now()
    # Atomic update avoids lost writes when several clients mark read at once
    result = await db.channels().update_one(
        {'_id': channel['_id'], 'readBy.user': user['_id']}, {'$set': {'readBy.$.lastRead': last_read}})
    if not result.matched_count:
        await db.channels().update_one(
            {'_id': channel['_id']}, {'$push': {'readBy': {'user': user['_id'], 'lastRead': last_read}}})

    await emit('channel:read', {
        'channelId': channel['_id'], 'userId': user['_id'], 'lastRead': last_read,
        'user': {'_id': user['_id'], 'username': user.get('username'),
                 'displayName': user.get('displayName'), 'avatar': user.get('avatar')},
    }, f"channel:{channel['_id']}")
    return respond({'success': True})


@router.get('/{id}/readers')
@route('Failed to fetch read receipts')
async def readers(request: Request, id: str):
    user = await current_user(request)
    require_id(id)
    channel, *_ = await channel_access(id, user['_id'])
    await populate(channel, 'readBy.user', db.users(), 'username displayName avatar')
    return respond({'readBy': channel.get('readBy') or []})
