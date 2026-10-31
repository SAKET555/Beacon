from bson import ObjectId
from fastapi import APIRouter, Request

from .. import db
from ..http import ApiError, read_json, require_id, respond, route
from ..populate import populate
from ..security import current_user
from ..validation import is_https_url, parse_paging

router = APIRouter()

MAX_SUBSCRIPTIONS = 10


@router.get('')
@router.get('/')
@route('Failed to fetch notifications')
async def list_notifications(request: Request):
    user = await current_user(request)
    _, limit, skip = parse_paging(request.query_params, default_limit=30, max_limit=100)
    items = await db.notifications().find({'user': user['_id']}).sort('createdAt', -1) \
        .skip(skip).limit(limit).to_list(limit)
    await populate(items, 'sender', db.users(), 'username displayName avatar')
    await populate(items, 'channel', db.channels(), 'name')
    await populate(items, 'server', db.servers(), 'name icon')
    unread = await db.notifications().count_documents({'user': user['_id'], 'read': False})
    return respond({'notifications': items, 'unreadCount': unread})


@router.patch('/read-all')
@route('Failed to mark all as read')
async def read_all(request: Request):
    user = await current_user(request)
    await db.notifications().update_many({'user': user['_id'], 'read': False}, {'$set': {'read': True}})
    return respond({'message': 'All notifications marked as read'})


@router.patch('/{id}/read')
@route('Failed to mark as read')
async def read_one(request: Request, id: str):
    user = await current_user(request)
    require_id(id)
    notification = await db.notifications().find_one_and_update(
        {'_id': ObjectId(id), 'user': user['_id']}, {'$set': {'read': True}}, return_document=True)
    if not notification:
        raise ApiError(404, 'Notification not found')
    return respond({'notification': notification})


@router.post('/subscribe')
@route('Failed to save subscription')
async def subscribe(request: Request):
    user = await current_user(request)
    body = await read_json(request)
    endpoint, keys = body.get('endpoint'), body.get('keys')
    keys = keys if isinstance(keys, dict) else {}

    def valid_key(value):
        return isinstance(value, str) and 0 < len(value) <= 256

    if not is_https_url(endpoint) or not valid_key(keys.get('p256dh')) or not valid_key(keys.get('auth')):
        raise ApiError(400, 'Invalid subscription')

    existing = await db.push_subscriptions().find_one({'user': user['_id'], 'endpoint': endpoint}, {'_id': 1})
    if not existing and await db.push_subscriptions().count_documents({'user': user['_id']}) >= MAX_SUBSCRIPTIONS:
        raise ApiError(400, 'Too many devices subscribed to notifications')

    stamp = db.now()
    await db.push_subscriptions().update_one(
        {'user': user['_id'], 'endpoint': endpoint},
        {'$set': {'keys': {'p256dh': keys['p256dh'], 'auth': keys['auth']}, 'updatedAt': stamp},
         '$setOnInsert': {'createdAt': stamp, '__v': 0}},
        upsert=True)
    return respond({'success': True})


@router.post('/unsubscribe')
@route('Failed to remove subscription')
async def unsubscribe(request: Request):
    user = await current_user(request)
    endpoint = (await read_json(request)).get('endpoint')
    if not isinstance(endpoint, str) or not endpoint:
        raise ApiError(400, 'Endpoint required')
    await db.push_subscriptions().delete_one({'user': user['_id'], 'endpoint': endpoint})
    return respond({'success': True})
