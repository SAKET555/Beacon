"""Delivers scheduled messages once their time has come (runs every 30 seconds)."""
import asyncio
import logging

from . import db
from .populate import populate
from .realtime import emit

log = logging.getLogger('beacon')


async def process_scheduled_messages():
    due = await db.messages().find({'isScheduled': True, 'scheduledFor': {'$lte': db.now()}}).to_list(500)
    for message in due:
        # Claim atomically so two workers can never send the same message twice
        claimed = await db.messages().update_one(
            {'_id': message['_id'], 'isScheduled': True},
            {'$set': {'isScheduled': False, 'scheduledFor': None, 'updatedAt': db.now()}})
        if not claimed.modified_count:
            continue
        message.update(isScheduled=False, scheduledFor=None)
        await db.channels().update_one({'_id': message['channel']}, {'$set': {'lastMessage': message['_id']}})
        await populate(message, 'author', db.users(), 'username displayName avatar status')
        await emit('message:new', {'message': message}, f"channel:{message['channel']}")
    if due:
        log.info('Sent %d scheduled messages', len(due))


async def scheduler_loop():
    while True:
        try:
            await process_scheduled_messages()
        except Exception as error:
            log.error('Scheduled message processing error: %s', error)
        await asyncio.sleep(30)
