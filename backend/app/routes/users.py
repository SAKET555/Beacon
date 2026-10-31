import re

from bson import ObjectId
from fastapi import APIRouter, Request

from .. import db
from ..access import message_access
from ..http import ApiError, read_json, require_id, respond, route
from ..models import new_channel
from ..populate import populate
from ..realtime import broadcast_presence, disconnect_user
from ..security import PRIVATE_USER_FIELDS, current_user
from ..validation import clean_media_url, clean_string, escape_regex

router = APIRouter()

PROFILE_LIMITS = {'displayName': 32, 'bio': 190, 'customStatus': 128}
PUBLIC_PROFILE = {'username': 1, 'displayName': 1, 'avatar': 1, 'bio': 1, 'status': 1,
                  'customStatus': 1, 'createdAt': 1}

# NOTE: static routes stay above GET /{id}, otherwise /{id} swallows them.


@router.patch('/profile')
@route('Failed to update profile')
async def update_profile(request: Request):
    user = await current_user(request)
    body = await read_json(request)
    updates = {}
    for field, limit in PROFILE_LIMITS.items():
        if field in body:
            value = clean_string(body[field], limit)
            if value is None:
                raise ApiError(400, f'Invalid {field}')
            updates[field] = value
    if 'avatar' in body:
        avatar = clean_media_url(body['avatar'])
        if avatar is None:
            raise ApiError(400, 'Avatar must be an https URL')
        updates['avatar'] = avatar

    if updates:
        updates['updatedAt'] = db.now()
        await db.users().update_one({'_id': user['_id']}, {'$set': updates})
    fresh = await db.users().find_one({'_id': user['_id']}, PRIVATE_USER_FIELDS)
    return respond({'user': fresh})


@router.patch('/status')
@route('Failed to update status')
async def update_status(request: Request):
    user = await current_user(request)
    status = (await read_json(request)).get('status')
    if status not in ('online', 'away', 'dnd', 'offline'):
        raise ApiError(400, 'Invalid status')
    await db.users().update_one({'_id': user['_id']}, {'$set': {'status': status, 'updatedAt': db.now()}})
    await broadcast_presence(user['_id'], status)
    fresh = await db.users().find_one({'_id': user['_id']}, PRIVATE_USER_FIELDS)
    return respond({'user': fresh})


@router.post('/block/{id}')
@route('Failed to block user')
async def block_user(request: Request, id: str):
    user = await current_user(request)
    require_id(id)
    if id == str(user['_id']):
        raise ApiError(400, 'Cannot block yourself')
    if not await db.users().find_one({'_id': ObjectId(id)}, {'_id': 1}):
        raise ApiError(404, 'User not found')

    blocked = any(db.same_id(b, id) for b in user.get('blockedUsers', []))
    operation = '$pull' if blocked else '$addToSet'
    await db.users().update_one({'_id': user['_id']}, {operation: {'blockedUsers': ObjectId(id)}})
    fresh = await db.users().find_one({'_id': user['_id']}, {'blockedUsers': 1})
    return respond({'blocked': not blocked, 'blockedUsers': fresh.get('blockedUsers', [])})


@router.patch('/notifications/preferences')
@route('Failed to update preferences')
async def update_preferences(request: Request):
    user = await current_user(request)
    body = await read_json(request)
    prefs = {f'notificationPreferences.{key}': body[key]
             for key in ('mentions', 'replies', 'reactions', 'sounds') if isinstance(body.get(key), bool)}
    if prefs:
        await db.users().update_one({'_id': user['_id']}, {'$set': prefs})
    fresh = await db.users().find_one({'_id': user['_id']}, PRIVATE_USER_FIELDS)
    return respond({'user': fresh})


@router.post('/dm/{id}')
@route('Failed to create DM channel')
async def open_dm(request: Request, id: str):
    user = await current_user(request)
    require_id(id)
    if id == str(user['_id']):
        raise ApiError(400, 'Cannot DM yourself')
    target = await db.users().find_one({'_id': ObjectId(id)}, {'blockedUsers': 1})
    if not target:
        raise ApiError(404, 'User not found')
    if any(db.same_id(b, user['_id']) for b in target.get('blockedUsers', [])):
        raise ApiError(403, 'You cannot message this user')

    pair = [user['_id'], ObjectId(id)]
    channel = await db.channels().find_one({'type': 'dm', 'participants': {'$all': pair, '$size': 2}})
    if not channel:
        channel = new_channel(f"dm-{user['_id']}-{id}", 'dm', participants=pair)
        await db.channels().insert_one(channel)
        await db.users().update_many({'_id': {'$in': pair}}, {'$addToSet': {'dmChannels': channel['_id']}})

    await populate(channel, 'participants', db.users(), 'username displayName avatar status')
    return respond({'channel': channel})


@router.get('/dm/channels')
@route('Failed to fetch DM channels')
async def dm_channels(request: Request):
    user = await current_user(request)
    channels = await db.channels().find({'type': 'dm', 'participants': user['_id']}) \
        .sort('updatedAt', -1).to_list(500)
    await populate(channels, 'participants', db.users(), 'username displayName avatar status')
    await populate(channels, 'lastMessage', db.messages())
    return respond({'channels': channels})


@router.get('/search/{query}')
@route('Search failed')
async def search_users(request: Request, query: str):
    user = await current_user(request)
    query = query.strip()
    if not query or len(query) > 32:
        raise ApiError(400, 'Search must be 1-32 characters')
    # Escaped so user input can't inject regex syntax (or a ReDoS pattern)
    pattern = re.compile(escape_regex(query), re.I)
    users = await db.users().find(
        {'$or': [{'username': pattern}, {'displayName': pattern}], '_id': {'$ne': user['_id']}},
        {'username': 1, 'displayName': 1, 'avatar': 1, 'status': 1}).limit(20).to_list(20)
    return respond({'users': users})


@router.post('/star/{messageId}')
@route('Failed to update starred messages')
async def toggle_star(request: Request, messageId: str):
    user = await current_user(request)
    require_id(messageId)
    message, *_ = await message_access(messageId, user['_id'])

    starred_list = user.get('starredMessages', [])
    if any(db.same_id(s, message['_id']) for s in starred_list):
        await db.users().update_one({'_id': user['_id']}, {'$pull': {'starredMessages': message['_id']}})
        return respond({'starred': False})
    if len(starred_list) >= 500:
        raise ApiError(400, 'Starred message limit reached (500)')
    await db.users().update_one({'_id': user['_id']}, {'$addToSet': {'starredMessages': message['_id']}})
    return respond({'starred': True})


@router.get('/starred')
@route('Failed to fetch starred messages')
async def starred(request: Request):
    user = await current_user(request)
    ids = user.get('starredMessages', [])
    messages = await db.messages().find({'_id': {'$in': ids}, 'isDeleted': False}).to_list(500)

    # Hide stars from channels the user has since left or been kicked from
    server_ids = await db.servers().distinct('_id', {'members.user': user['_id']})
    channel_ids = await db.channels().distinct(
        '_id', {'$or': [{'server': {'$in': server_ids}}, {'participants': user['_id']}]})
    visible = {str(c) for c in channel_ids}
    order = {str(m): i for i, m in enumerate(ids)}
    messages = sorted((m for m in messages if str(m['channel']) in visible),
                      key=lambda m: order.get(str(m['_id']), 0))
    await populate(messages, 'author', db.users(), 'username displayName avatar')
    return respond({'messages': messages})


@router.delete('/account')
@route('Failed to delete account')
async def delete_account(request: Request):
    user = await current_user(request)
    user_id = user['_id']
    if await db.servers().count_documents({'owner': user_id}, limit=1):
        raise ApiError(400, 'You own servers. Delete them or transfer ownership before deleting your account.')

    await broadcast_presence(user_id, 'offline')
    await db.servers().update_many({'members.user': user_id}, {'$pull': {'members': {'user': user_id}}})
    await db.channels().delete_many({'type': 'dm', 'participants': user_id})
    await db.notifications().delete_many({'user': user_id})
    await db.push_subscriptions().delete_many({'user': user_id})
    await db.users().delete_one({'_id': user_id})
    await disconnect_user(user_id)
    return respond({'message': 'Account deleted successfully'})


@router.get('/{id}')
@route('Failed to fetch user')
async def get_user(request: Request, id: str):
    viewer = await current_user(request)
    require_id(id)
    is_self = id == str(viewer['_id'])
    user = await db.users().find_one(
        {'_id': ObjectId(id)},
        PRIVATE_USER_FIELDS if is_self else PUBLIC_PROFILE)
    if not user:
        raise ApiError(404, 'User not found')
    return respond({'user': user})
