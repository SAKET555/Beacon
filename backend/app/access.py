"""Membership / participation checks used by every route and socket handler."""
from bson import ObjectId

from . import db
from .http import ApiError
from .permissions import ensure_server_roles, has_permission


def find_member(server, user_id):
    return next((m for m in server.get('members', []) if db.same_id(m.get('user'), user_id)), None)


async def server_access(server_id, user_id, permission=None):
    server = await db.servers().find_one({'_id': ObjectId(str(server_id))})
    if not server:
        raise ApiError(404, 'Server not found')
    member = find_member(server, user_id)
    if not member:
        raise ApiError(403, 'Not a member of this server')
    ensure_server_roles(server)
    if permission and not has_permission(server, member, permission):
        raise ApiError(403, 'Insufficient permissions')
    return server, member


async def channel_access(channel_id, user_id, permission=None):
    """Server channels: membership + viewChannels. DMs: participants only.
    Returns (channel, server, member); server/member are None for DMs."""
    channel = await db.channels().find_one({'_id': ObjectId(str(channel_id))})
    if not channel:
        raise ApiError(404, 'Channel not found')

    if not channel.get('server'):
        if not any(db.same_id(p, user_id) for p in channel.get('participants', [])):
            raise ApiError(403, 'No access to this channel')
        return channel, None, None

    server, member = await server_access(channel['server'], user_id)
    if not has_permission(server, member, 'viewChannels'):
        raise ApiError(403, 'No access to this channel')
    if permission and not has_permission(server, member, permission):
        raise ApiError(403, 'Insufficient permissions')
    return channel, server, member


async def message_access(message_id, user_id, permission=None):
    message = await db.messages().find_one({'_id': ObjectId(str(message_id))})
    if not message:
        raise ApiError(404, 'Message not found')
    channel, server, member = await channel_access(message['channel'], user_id, permission)
    return message, channel, server, member


async def try_access(coro):
    """For socket handlers: returns the result, or None if access is denied."""
    try:
        return await coro
    except ApiError:
        return None
