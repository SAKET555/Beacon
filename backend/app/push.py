"""Web push notifications (VAPID)."""
import asyncio
import json
import logging
import os

from . import db
from .serialize import to_json

log = logging.getLogger('beacon')

_vapid = None


def init_web_push():
    global _vapid
    public_key = os.getenv('VAPID_PUBLIC_KEY')
    private_key = os.getenv('VAPID_PRIVATE_KEY')
    if not public_key or not private_key:
        log.warning('VAPID keys missing. Web push disabled.')
        return False
    _vapid = {'private_key': private_key,
              'subject': os.getenv('VAPID_SUBJECT', 'mailto:admin@royalbeacon.app')}
    return True


def _send(subscription, payload):
    from pywebpush import webpush
    webpush(subscription_info=subscription, data=payload,
            vapid_private_key=_vapid['private_key'], vapid_claims={'sub': _vapid['subject']}, ttl=3600)


async def send_push_to_user(user_id, payload):
    if not _vapid:
        return
    try:
        data = json.dumps(to_json(payload))
        async for sub in db.push_subscriptions().find({'user': db.oid(user_id)}):
            info = {'endpoint': sub['endpoint'], 'keys': sub['keys']}
            try:
                await asyncio.to_thread(_send, info, data)
            except Exception as error:
                status = getattr(getattr(error, 'response', None), 'status_code', None)
                if status in (404, 410):  # subscription expired
                    await db.push_subscriptions().delete_one({'_id': sub['_id']})
    except Exception as error:
        log.warning('Push send failed: %s', error)


def push_in_background(user_id, payload):
    asyncio.create_task(send_push_to_user(user_id, payload))
