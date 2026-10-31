"""Socket.IO server instance plus helpers routes use to push events."""
import logging

import socketio

from . import config, db
from .serialize import to_json

log = logging.getLogger('beacon')

sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins=config.is_origin_allowed,
    cors_credentials=True,
    max_http_buffer_size=1_000_000,
    logger=False,
    engineio_logger=False,
)

# user id -> set of socket ids
online_users: dict[str, set[str]] = {}


async def emit(event, data, room, skip_sid=None):
    await sio.emit(event, to_json(data), to=room, skip_sid=skip_sid)


def user_sids(user_id):
    return [sid for sid, _ in sio.manager.get_participants('/', f'user:{user_id}')]


async def broadcast_presence(user_id, status):
    """Only people who share a server or DM with the user are told."""
    try:
        uid = db.oid(user_id)
        user = await db.users().find_one({'_id': uid}, {'servers': 1})
        rooms = {f'user:{user_id}'}
        rooms.update(f'server:{s}' for s in (user or {}).get('servers', []))
        async for dm in db.channels().find({'type': 'dm', 'participants': uid}, {'participants': 1}):
            rooms.update(f'user:{p}' for p in dm.get('participants', []))
        await emit('presence:changed', {'userId': str(user_id), 'status': status}, list(rooms))
    except Exception as error:  # presence must never break the caller
        log.warning('Presence broadcast failed: %s', error)


async def evict_from_server(user_id, server):
    """Removes all of a user's live sockets from a server's rooms (kick / leave / delete)."""
    rooms = [f"server:{server['_id']}"]
    for channel_id in server.get('channels', []):
        rooms += [f'channel:{channel_id}', f'call:{channel_id}']
    for sid in user_sids(user_id):
        for room in rooms:
            await sio.leave_room(sid, room)


async def leave_room_everyone(room):
    for sid, _ in list(sio.manager.get_participants('/', room)):
        await sio.leave_room(sid, room)


async def disconnect_user(user_id):
    for sid in user_sids(user_id):
        await sio.disconnect(sid)
