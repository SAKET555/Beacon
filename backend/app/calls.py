"""Call ringing and call history.

When the first person joins a call, everyone else who can see the channel gets a
`call:incoming` event (the frontend shows a ring with Join / Decline). When the
last person leaves, `call:ended` is sent and the call is logged."""
import logging

from bson import ObjectId

from . import db
from .realtime import emit, user_sids

log = logging.getLogger('beacon')

# channel id -> active call document id
_active: dict[str, ObjectId] = {}


def _audience(channel):
    if channel.get('server'):
        return f"server:{channel['server']}"
    return [f'user:{p}' for p in channel.get('participants', [])]


async def announce_call(channel, session, mode, first):
    channel_id = str(channel['_id'])
    if channel_id not in _active:
        call_id = ObjectId()
        _active[channel_id] = call_id
        await db.call_logs().insert_one({
            '_id': call_id, 'channel': channel['_id'], 'server': channel.get('server'),
            'startedBy': db.oid(session['userId']), 'mode': 'video' if mode == 'video' else 'audio',
            'participants': [db.oid(session['userId'])], 'startedAt': db.now(), 'endedAt': None,
        })
    else:
        await db.call_logs().update_one({'_id': _active[channel_id]},
                                        {'$addToSet': {'participants': db.oid(session['userId'])}})

    if not first:
        return
    user = session['user']
    payload = {
        'channelId': channel_id,
        'serverId': channel.get('server'),
        'channelName': channel.get('name'),
        'isDM': not channel.get('server'),
        'mode': 'video' if mode == 'video' else 'audio',
        'caller': {'_id': session['userId'], 'username': user.get('username'),
                   'displayName': user.get('displayName'), 'avatar': user.get('avatar')},
    }
    # Every tab of the caller is skipped so they don't ring themselves.
    await emit('call:incoming', payload, _audience(channel), skip_sid=user_sids(session['userId']) or None)


async def end_call(channel_id):
    call_id = _active.pop(channel_id, None)
    if not call_id:
        return
    try:
        await db.call_logs().update_one({'_id': call_id}, {'$set': {'endedAt': db.now()}})
        call = await db.call_logs().find_one({'_id': call_id})
        if call:
            channel = {'_id': call['channel'], 'server': call.get('server')}
            if not call.get('server'):
                dm = await db.channels().find_one({'_id': call['channel']}, {'participants': 1})
                channel['participants'] = (dm or {}).get('participants', [])
            await emit('call:ended', {'channelId': channel_id}, _audience(channel))
    except Exception as error:
        log.warning('Ending call failed: %s', error)
