import re
from datetime import timedelta

from bson import ObjectId
from fastapi import APIRouter, Request

from .. import db
from ..access import channel_access, message_access
from ..http import ApiError, ValidationFailed, read_json, require_id, respond, route
from ..link_preview import build_link_previews
from ..models import new_audit_log, new_message, new_notification
from ..permissions import has_permission
from ..populate import populate
from ..push import push_in_background
from ..realtime import emit
from ..security import current_user
from ..validation import is_id, parse_date, parse_paging, sanitize_attachments

router = APIRouter()

MAX_SCHEDULE = timedelta(days=365)
MENTION_RE = re.compile(r'@([A-Za-z0-9_]{3,32})')
AUTHOR_FIELDS = 'username displayName avatar status'


async def populate_message(messages):
    await populate(messages, 'author', db.users(), AUTHOR_FIELDS)
    await populate(messages, 'mentions', db.users(), 'username displayName')
    await populate(messages, 'replyTo', db.messages())
    await populate(messages, 'replyTo.author', db.users(), 'username displayName avatar')
    return messages


async def _notify(user_id, type_, title, body, message, channel, sender_id, push=True):
    notification = new_notification(user_id, type_, title, body, message['_id'], channel['_id'],
                                    channel.get('server'), sender_id)
    await db.notifications().insert_one(notification)
    await emit('notification:new', {'notification': notification}, f'user:{user_id}')
    if push:
        push_in_background(user_id, {'title': title, 'body': body, 'data': {
            'messageId': message['_id'], 'channelId': channel['_id'], 'serverId': channel.get('server')}})


async def _wants(user_id, preference):
    user = await db.users().find_one({'_id': db.oid(user_id)}, {'notificationPreferences': 1, 'status': 1})
    if not user:
        return False
    return (user.get('notificationPreferences') or {}).get(preference, True)


@router.get('/search/{channelId}')
@route('Search failed')
async def search(request: Request, channelId: str):
    user = await current_user(request)
    require_id(channelId)
    channel, *_ = await channel_access(channelId, user['_id'])
    query_params = request.query_params
    _, limit, _ = parse_paging(query_params, default_limit=25, max_limit=50)
    query = {'channel': channel['_id'], 'isDeleted': False, 'isScheduled': False}

    q = query_params.get('q')
    if q is not None:
        if len(q) > 200:
            raise ApiError(400, 'Invalid search query')
        if q.strip():
            query['$text'] = {'$search': q}
    author = query_params.get('author')
    if author is not None:
        if not is_id(author):
            raise ApiError(400, 'Invalid author')
        query['author'] = ObjectId(author)
    has = query_params.get('has')
    if has == 'attachment':
        query['attachments.0'] = {'$exists': True}
    elif has == 'link':
        query['content'] = {'$regex': r'https?://', '$options': 'i'}
    for key, operator in (('before', '$lt'), ('after', '$gt')):
        if query_params.get(key) is not None:
            date = parse_date(query_params.get(key))
            if not date:
                raise ApiError(400, f'Invalid {key} date')
            query.setdefault('createdAt', {})[operator] = date

    messages = await db.messages().find(query).sort('createdAt', -1).limit(limit).to_list(limit)
    await populate(messages, 'author', db.users(), 'username displayName avatar')
    return respond({'messages': messages, 'total': len(messages)})


@router.get('/thread/{messageId}')
@route('Failed to fetch thread')
async def thread(request: Request, messageId: str):
    user = await current_user(request)
    require_id(messageId)
    parent, *_ = await message_access(messageId, user['_id'])
    messages = await db.messages().find({
        '$or': [{'_id': parent['_id']}, {'replyTo': parent['_id']}], 'isScheduled': False,
    }).sort('createdAt', 1).limit(500).to_list(500)
    await populate(messages, 'author', db.users(), AUTHOR_FIELDS)
    return respond({'messages': messages})


@router.get('/scheduled/mine')
@route('Failed to fetch scheduled messages')
async def my_scheduled(request: Request):
    """New: lets users see (and cancel) messages they scheduled."""
    user = await current_user(request)
    messages = await db.messages().find({'author': user['_id'], 'isScheduled': True}) \
        .sort('scheduledFor', 1).limit(100).to_list(100)
    await populate(messages, 'channel', db.channels(), 'name type server')
    return respond({'messages': messages})


@router.get('/{channelId}')
@route('Failed to fetch messages')
async def list_messages(request: Request, channelId: str):
    user = await current_user(request)
    require_id(channelId)
    channel, *_ = await channel_access(channelId, user['_id'])
    page, limit, skip = parse_paging(request.query_params, default_limit=50, max_limit=100)
    query = {'channel': channel['_id'], 'isScheduled': False}

    before = request.query_params.get('before')
    if before:
        date = parse_date(before)
        if not date:
            raise ApiError(400, 'Invalid before date')
        query['createdAt'] = {'$lt': date}

    messages = await db.messages().find(query).sort('createdAt', -1).skip(skip).limit(limit).to_list(limit)
    total = await db.messages().count_documents(query)
    await populate_message(messages)
    messages.reverse()
    return respond({'messages': messages, 'total': total, 'hasMore': total > page * limit})


@router.post('/{channelId}')
@route('Failed to send message')
async def send_message(request: Request, channelId: str):
    user = await current_user(request)
    require_id(channelId)
    body = await read_json(request)
    content = body.get('content')
    if content is not None and (not isinstance(content, str) or len(content) > 2000):
        raise ValidationFailed([{'type': 'field', 'value': content, 'msg': 'Invalid value',
                                 'path': 'content', 'location': 'body'}])

    channel, server, member = await channel_access(channelId, user['_id'], 'sendMessages')
    moderator = bool(server) and has_permission(server, member, 'manageMessages')

    if channel.get('settings', {}).get('locked') and server and not moderator:
        raise ApiError(403, 'Channel is locked')
    if channel.get('type') == 'announcement' and server and not moderator:
        raise ApiError(403, 'Only moderators can post in announcement channels')

    content = content or ''
    attachments = sanitize_attachments(body.get('attachments'))
    if not content and not attachments:
        raise ApiError(400, 'Message must have content or attachments')
    if attachments and server and not has_permission(server, member, 'attachFiles'):
        raise ApiError(403, 'You cannot attach files in this server')

    # Slow mode: one message per N seconds per user (moderators are exempt)
    slow = channel.get('settings', {}).get('slowMode') or 0
    if slow and not moderator:
        last = await db.messages().find_one(
            {'channel': channel['_id'], 'author': user['_id'], 'isScheduled': False},
            {'createdAt': 1}, sort=[('createdAt', -1)])
        if last:
            wait = slow - (db.now() - last['createdAt']).total_seconds()
            if wait > 0:
                raise ApiError(429, f'Slow mode is on. You can send another message in {int(wait) + 1}s.')

    settings = (server or {}).get('settings', {})
    if settings.get('spamFilter') and settings.get('filteredWords'):
        lowered = content.lower()
        if any(word.lower() in lowered for word in settings['filteredWords']):
            raise ApiError(400, 'Message contains filtered words')

    # Mentions: explicit ids from the client plus any @username in the text,
    # limited to people who can actually see this channel.
    if server:
        allowed = {str(m['user']) for m in server.get('members', [])}
    else:
        allowed = {str(p) for p in channel.get('participants', [])}
    requested = [m for m in (body.get('mentions') or []) if is_id(m)] if isinstance(body.get('mentions'), list) else []
    names = list(dict.fromkeys(MENTION_RE.findall(content)))[:20]
    if names:
        async for found in db.users().find({'username': {'$in': names}}, {'_id': 1}):
            requested.append(str(found['_id']))
    mentions = [ObjectId(m) for m in dict.fromkeys(requested)
                if m in allowed and m != str(user['_id'])][:20]

    parent = None
    reply_to = body.get('replyTo')
    if reply_to is not None:
        if not is_id(reply_to):
            raise ApiError(400, 'Invalid reply target')
        parent = await db.messages().find_one({'_id': ObjectId(reply_to)}, {'channel': 1, 'author': 1})
        if not parent or not db.same_id(parent['channel'], channel['_id']):
            raise ApiError(400, 'Invalid reply target')

    scheduled = None
    if body.get('scheduledFor'):
        scheduled = parse_date(body['scheduledFor'])
        if not scheduled:
            raise ApiError(400, 'Invalid schedule time')
        if scheduled < db.now() + timedelta(seconds=1):
            raise ApiError(400, 'Scheduled time must be in the future')
        if scheduled > db.now() + MAX_SCHEDULE:
            raise ApiError(400, 'Messages can be scheduled at most one year ahead')

    message = new_message(
        content, user['_id'], channel['_id'], channel.get('server'),
        attachments=attachments, linkPreviews=await build_link_previews(content),
        replyTo=parent['_id'] if parent else None, mentions=mentions,
        scheduledFor=scheduled, isScheduled=bool(scheduled))
    await db.messages().insert_one(message)

    if parent:
        await db.messages().update_one({'_id': parent['_id']}, {'$inc': {'threadCount': 1}})
    if not scheduled:
        await db.channels().update_one({'_id': channel['_id']},
                                       {'$set': {'lastMessage': message['_id'], 'updatedAt': db.now()}})

    await populate_message(message)

    if not scheduled:
        await emit('message:new', {'message': message}, f"channel:{channel['_id']}")
        preview = content[:100]
        for mentioned in mentions:
            if await _wants(mentioned, 'mentions'):
                await _notify(mentioned, 'mention', f"{user['username']} mentioned you",
                              preview or 'in a message', message, channel, user['_id'])
        if parent and not db.same_id(parent['author'], user['_id']) and parent['author'] not in mentions:
            if await _wants(parent['author'], 'replies'):
                await _notify(parent['author'], 'reply', f"{user['username']} replied to your message",
                              preview or 'with an attachment', message, channel, user['_id'])
        if not server:  # DMs notify the other participant (and push to their devices)
            for participant in channel.get('participants', []):
                if not db.same_id(participant, user['_id']) and participant not in mentions:
                    await _notify(participant, 'dm', f"{user['username']} sent you a message",
                                  preview or 'Sent an attachment', message, channel, user['_id'])

    return respond({'message': message}, 201)


@router.patch('/{id}')
@route('Failed to edit message')
async def edit_message(request: Request, id: str):
    user = await current_user(request)
    require_id(id)
    message, *_ = await message_access(id, user['_id'])
    if not db.same_id(message['author'], user['_id']):
        raise ApiError(403, 'Can only edit own messages')
    if message.get('isDeleted'):
        raise ApiError(400, 'Message was deleted')
    content = (await read_json(request)).get('content')
    if not isinstance(content, str) or not content or len(content) > 2000:
        raise ApiError(400, 'Invalid content')

    history = {'_id': ObjectId(), 'content': message.get('content', ''), 'editedAt': db.now()}
    await db.messages().update_one({'_id': message['_id']}, {
        '$set': {'content': content, 'isEdited': True, 'updatedAt': db.now(),
                 'linkPreviews': await build_link_previews(content)},
        '$push': {'editHistory': history}})
    message = await db.messages().find_one({'_id': message['_id']})
    await populate(message, 'author', db.users(), AUTHOR_FIELDS)
    await emit('message:edited', {'message': message}, f"channel:{message['channel']}")
    return respond({'message': message})


@router.delete('/{id}')
@route('Failed to delete message')
async def delete_message(request: Request, id: str):
    user = await current_user(request)
    require_id(id)
    message, _, server, member = await message_access(id, user['_id'])
    is_author = db.same_id(message['author'], user['_id'])
    is_moderator = bool(server) and has_permission(server, member, 'manageMessages')
    if not is_author and not is_moderator:
        raise ApiError(403, 'Cannot delete this message')

    await db.messages().update_one({'_id': message['_id']}, {'$set': {
        'isDeleted': True, 'content': '', 'attachments': [], 'linkPreviews': [], 'editHistory': [],
        'updatedAt': db.now()}})
    if not is_author and server:
        await db.audit_logs().insert_one(new_audit_log(
            server['_id'], 'message_delete', user['_id'], str(message['author']), message['_id']))
    await emit('message:deleted', {'messageId': message['_id'], 'channelId': message['channel']},
               f"channel:{message['channel']}")
    return respond({'message': 'Message deleted'})


@router.post('/{id}/react')
@route('Failed to react')
async def react(request: Request, id: str):
    user = await current_user(request)
    require_id(id)
    emoji = (await read_json(request)).get('emoji')
    if not isinstance(emoji, str) or not emoji.strip() or len(emoji) > 32:
        raise ApiError(400, 'Emoji required')
    message, channel, *_ = await message_access(id, user['_id'])
    if message.get('isDeleted'):
        raise ApiError(400, 'Message was deleted')

    reactions = message.get('reactions', [])
    existing = next((r for r in reactions if r['emoji'] == emoji), None)
    added = False
    if existing:
        if any(db.same_id(u, user['_id']) for u in existing['users']):
            existing['users'] = [u for u in existing['users'] if not db.same_id(u, user['_id'])]
            if not existing['users']:
                reactions = [r for r in reactions if r['emoji'] != emoji]
        else:
            existing['users'].append(user['_id'])
            added = True
    else:
        if len(reactions) >= 20:
            raise ApiError(400, 'Too many different reactions on this message')
        reactions.append({'_id': ObjectId(), 'emoji': emoji, 'users': [user['_id']]})
        added = True

    await db.messages().update_one({'_id': message['_id']}, {'$set': {'reactions': reactions}})
    await emit('message:reacted', {'messageId': message['_id'], 'reactions': reactions,
                                   'userId': user['_id'], 'emoji': emoji}, f"channel:{message['channel']}")

    if added and not db.same_id(message['author'], user['_id']) and await _wants(message['author'], 'reactions'):
        await _notify(message['author'], 'reaction', f"{user['username']} reacted {emoji}",
                      (message.get('content') or '')[:50] or 'to your message', message, channel,
                      user['_id'], push=False)
    return respond({'reactions': reactions})


@router.delete('/scheduled/{id}')
@route('Failed to cancel scheduled message')
async def cancel_scheduled(request: Request, id: str):
    """New: cancel a message you scheduled before it goes out."""
    user = await current_user(request)
    require_id(id)
    result = await db.messages().delete_one({'_id': ObjectId(id), 'author': user['_id'], 'isScheduled': True})
    if not result.deleted_count:
        raise ApiError(404, 'Scheduled message not found')
    return respond({'message': 'Scheduled message cancelled'})
