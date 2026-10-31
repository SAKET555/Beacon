"""Socket.IO events: presence, rooms, typing and WebRTC call signalling."""
import logging

from socketio.exceptions import ConnectionRefusedError

from . import db
from .access import channel_access, server_access, try_access
from .realtime import broadcast_presence, emit, online_users, sio
from .security import TokenError, authenticate_token
from .validation import is_id

log = logging.getLogger('beacon')

# sid -> {'userId', 'user', 'callRoom'}
sessions: dict[str, dict] = {}


def _payload(data):
    return data if isinstance(data, dict) else {}


@sio.event
async def connect(sid, environ, auth):
    token = (auth or {}).get('token') if isinstance(auth, dict) else None
    if not token:
        raise ConnectionRefusedError('Authentication required')
    try:
        user = await authenticate_token(token)
    except TokenError:
        raise ConnectionRefusedError('Authentication failed')

    user_id = str(user['_id'])
    sessions[sid] = {'userId': user_id, 'user': user, 'callRoom': None}
    online_users.setdefault(user_id, set()).add(sid)
    await sio.enter_room(sid, f'user:{user_id}')
    log.info('User connected: %s (%s)', user.get('username'), user_id)
    sio.start_background_task(_after_connect, sid, user_id)


async def _after_connect(sid, user_id):
    try:
        # Join rooms for every server the user really belongs to (presence + server events)
        async for server in db.servers().find({'members.user': db.oid(user_id)}, {'_id': 1}):
            await sio.enter_room(sid, f"server:{server['_id']}")
        await db.users().update_one({'_id': db.oid(user_id)}, {'$set': {'status': 'online'}})
        await broadcast_presence(user_id, 'online')
    except Exception as error:
        log.warning('Socket connection setup failed: %s', error)


def _session(sid):
    return sessions.get(sid)


@sio.on('server:join')
async def server_join(sid, data):
    session, server_id = _session(sid), _payload(data).get('serverId')
    if session and is_id(server_id) and await try_access(server_access(server_id, session['userId'])):
        await sio.enter_room(sid, f'server:{server_id}')


@sio.on('channel:join')
async def channel_join(sid, data):
    session, channel_id = _session(sid), _payload(data).get('channelId')
    if session and is_id(channel_id) and await try_access(channel_access(channel_id, session['userId'])):
        await sio.enter_room(sid, f'channel:{channel_id}')


@sio.on('channel:leave')
async def channel_leave(sid, data):
    channel_id = _payload(data).get('channelId')
    if is_id(channel_id):
        await sio.leave_room(sid, f'channel:{channel_id}')


# --- calls: only sockets that passed call:join may signal into a call room ---

def _in_call(sid, channel_id):
    session = _session(sid)
    return bool(session) and is_id(channel_id) and session['callRoom'] == f'call:{channel_id}'


async def _leave_call(sid):
    session = _session(sid)
    if not session or not session['callRoom']:
        return
    room = session['callRoom']
    session['callRoom'] = None
    await sio.leave_room(sid, room)
    await emit('call:user-left', {'userId': session['userId']}, room, skip_sid=sid)
    remaining = list(sio.manager.get_participants('/', room))
    if not remaining:
        from .calls import end_call
        await end_call(room.split(':', 1)[1])


@sio.on('call:join')
async def call_join(sid, data):
    session = _session(sid)
    payload = _payload(data)
    channel_id = payload.get('channelId')
    if not session or not is_id(channel_id):
        return
    # DM channels skip the permission check; server channels need connectVoice
    access = await try_access(channel_access(channel_id, session['userId'], 'connectVoice'))
    if not access:
        return
    channel, _, _ = access

    room = f'call:{channel_id}'
    if session['callRoom'] and session['callRoom'] != room:
        await _leave_call(sid)
    first = not list(sio.manager.get_participants('/', room))
    await sio.enter_room(sid, room)
    session['callRoom'] = room
    user = session['user']
    await emit('call:user-joined', {
        'userId': session['userId'],
        'user': {'username': user.get('username'), 'displayName': user.get('displayName'),
                 'avatar': user.get('avatar')},
    }, room, skip_sid=sid)

    from .calls import announce_call
    await announce_call(channel, session, payload.get('mode'), first)


async def _relay(sid, data, event, keys):
    payload = _payload(data)
    channel_id = payload.get('channelId')
    if not _in_call(sid, channel_id):
        return
    session = _session(sid)
    out = {'userId': session['userId']}
    out.update({key: payload.get(key) for key in keys})
    if event == 'call:offer':  # lets the answering side label this person's tile
        user = session['user']
        out['user'] = {'username': user.get('username'), 'displayName': user.get('displayName'),
                       'avatar': user.get('avatar')}
    await emit(event, out, f'call:{channel_id}', skip_sid=sid)


@sio.on('call:offer')
async def call_offer(sid, data):
    await _relay(sid, data, 'call:offer', ('sdp', 'targetUserId'))


@sio.on('call:answer')
async def call_answer(sid, data):
    await _relay(sid, data, 'call:answer', ('sdp', 'targetUserId'))


@sio.on('call:ice')
async def call_ice(sid, data):
    await _relay(sid, data, 'call:ice', ('candidate', 'targetUserId'))


@sio.on('call:state')
async def call_state(sid, data):
    await _relay(sid, data, 'call:state', ('state',))


@sio.on('call:leave')
async def call_leave(sid, data):
    if _in_call(sid, _payload(data).get('channelId')):
        await _leave_call(sid)


# --- typing: only for channels this socket has joined -------------------------

async def _typing(sid, data, is_typing):
    session, channel_id = _session(sid), _payload(data).get('channelId')
    room = f'channel:{channel_id}'
    if not session or not is_id(channel_id) or room not in sio.rooms(sid):
        return
    await emit('typing:update', {'userId': session['userId'], 'username': session['user'].get('username'),
                                 'channelId': channel_id, 'isTyping': is_typing}, room, skip_sid=sid)


@sio.on('typing:start')
async def typing_start(sid, data):
    await _typing(sid, data, True)


@sio.on('typing:stop')
async def typing_stop(sid, data):
    await _typing(sid, data, False)


# --- presence -------------------------------------------------------------------

@sio.on('presence:update')
async def presence_update(sid, data):
    session, status = _session(sid), _payload(data).get('status')
    if session and status in ('online', 'away', 'dnd', 'offline'):
        await db.users().update_one({'_id': db.oid(session['userId'])}, {'$set': {'status': status}})
        await broadcast_presence(session['userId'], status)


@sio.on('presence:get')
async def presence_get(sid, data=None):
    # The return value is delivered to the client's acknowledgement callback.
    return {uid: 'online' for uid, sids in online_users.items() if sids}


@sio.event
async def disconnect(sid, *args):
    session = sessions.get(sid)
    if not session:
        return
    try:
        await _leave_call(sid)
    except Exception as error:
        log.warning('Call cleanup failed: %s', error)
    sessions.pop(sid, None)
    user_id = session['userId']
    log.info('User disconnected: %s', session['user'].get('username'))
    sids = online_users.get(user_id)
    if sids is not None:
        sids.discard(sid)
        if not sids:
            online_users.pop(user_id, None)
            await db.users().update_one({'_id': db.oid(user_id)}, {'$set': {'status': 'offline'}})
            await broadcast_presence(user_id, 'offline')
