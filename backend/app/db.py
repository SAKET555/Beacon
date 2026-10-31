"""MongoDB access. Collection names and document shapes match the original
Mongoose models, so existing data keeps working unchanged."""
import logging
from datetime import datetime, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, TEXT

from . import config

log = logging.getLogger('beacon')

client = None
db = None


def now():
    # BSON stores milliseconds; trimming keeps values identical after a round trip.
    current = datetime.now(timezone.utc).replace(tzinfo=None)
    return current.replace(microsecond=current.microsecond // 1000 * 1000)


def col(name):
    return db[name]


users = lambda: col('users')                    # noqa: E731
servers = lambda: col('servers')                # noqa: E731
channels = lambda: col('channels')              # noqa: E731
messages = lambda: col('messages')              # noqa: E731
notifications = lambda: col('notifications')    # noqa: E731
audit_logs = lambda: col('auditlogs')           # noqa: E731
push_subscriptions = lambda: col('pushsubscriptions')  # noqa: E731
call_logs = lambda: col('calllogs')             # noqa: E731
polls = lambda: col('polls')                    # noqa: E731


async def connect():
    global client, db
    client = AsyncIOMotorClient(config.MONGODB_URI, serverSelectionTimeoutMS=10000)
    db = client[config.DB_NAME]
    await client.admin.command('ping')
    log.info('MongoDB connected')
    await ensure_indexes()


async def ensure_indexes():
    specs = [
        (users(), [('username', ASCENDING)], {'unique': True}),
        (users(), [('email', ASCENDING)], {'unique': True}),
        (users(), [('username', TEXT), ('displayName', TEXT)], {}),
        (servers(), [('inviteCode', ASCENDING)], {'unique': True}),
        (servers(), [('name', TEXT), ('description', TEXT)], {}),
        (servers(), [('members.user', ASCENDING)], {}),
        (channels(), [('server', ASCENDING), ('name', ASCENDING)], {}),
        (channels(), [('participants', ASCENDING)], {}),
        (messages(), [('content', TEXT)], {}),
        (messages(), [('channel', ASCENDING), ('createdAt', DESCENDING)], {}),
        (messages(), [('author', ASCENDING)], {}),
        (messages(), [('scheduledFor', ASCENDING), ('isScheduled', ASCENDING)], {}),
        (messages(), [('replyTo', ASCENDING)], {}),
        (notifications(), [('user', ASCENDING), ('read', ASCENDING), ('createdAt', DESCENDING)], {}),
        (audit_logs(), [('server', ASCENDING), ('createdAt', DESCENDING)], {}),
        (push_subscriptions(), [('user', ASCENDING), ('endpoint', ASCENDING)], {'unique': True}),
        (call_logs(), [('channel', ASCENDING), ('startedAt', DESCENDING)], {}),
    ]
    for collection, keys, options in specs:
        try:
            await collection.create_index(keys, **options)
        except Exception as error:  # an older index with other options must not stop startup
            log.warning('Index %s on %s skipped: %s', keys, collection.name, error)


def oid(value):
    return value if isinstance(value, ObjectId) else ObjectId(str(value))


def same_id(a, b):
    if a is None or b is None:
        return False
    a = a.get('_id') if isinstance(a, dict) else a
    b = b.get('_id') if isinstance(b, dict) else b
    return str(a) == str(b)
