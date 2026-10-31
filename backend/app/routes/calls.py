"""New: ICE server config (so calls can use a TURN relay) and call history."""
import base64
import hashlib
import hmac
import os
import time

from fastapi import APIRouter, Request

from .. import db
from ..access import channel_access
from ..http import require_id, respond, route
from ..populate import populate
from ..security import current_user

router = APIRouter()

DEFAULT_STUN = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']


@router.get('/ice-servers')
@route('Failed to load call configuration')
async def ice_servers(request: Request):
    """STUN always; TURN when TURN_URLS is configured. With TURN_SECRET (coturn
    'use-auth-secret') short-lived credentials are minted per user; otherwise
    static TURN_USERNAME / TURN_CREDENTIAL are used."""
    user = await current_user(request)
    servers = [{'urls': DEFAULT_STUN}]
    turn_urls = [u.strip() for u in os.getenv('TURN_URLS', '').split(',') if u.strip()]
    if turn_urls:
        secret = os.getenv('TURN_SECRET')
        if secret:
            username = f"{int(time.time()) + 12 * 3600}:{user['_id']}"
            digest = hmac.new(secret.encode(), username.encode(), hashlib.sha1).digest()
            servers.append({'urls': turn_urls, 'username': username,
                            'credential': base64.b64encode(digest).decode()})
        else:
            servers.append({'urls': turn_urls, 'username': os.getenv('TURN_USERNAME', ''),
                            'credential': os.getenv('TURN_CREDENTIAL', '')})
    return respond({'iceServers': servers, 'hasTurn': bool(turn_urls)})


@router.get('/history/{channelId}')
@route('Failed to load call history')
async def call_history(request: Request, channelId: str):
    user = await current_user(request)
    require_id(channelId)
    channel, *_ = await channel_access(channelId, user['_id'])
    calls = await db.call_logs().find({'channel': channel['_id']}).sort('startedAt', -1).limit(30).to_list(30)
    await populate(calls, 'startedBy', db.users(), 'username displayName avatar')
    await populate(calls, 'participants', db.users(), 'username displayName avatar')
    return respond({'calls': calls})
