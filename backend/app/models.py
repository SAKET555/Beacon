"""Document factories with the same defaults the Mongoose schemas applied."""
import secrets

from bson import ObjectId

from .db import now


def _base(**fields):
    stamp = now()
    return {'_id': ObjectId(), **fields, 'createdAt': stamp, 'updatedAt': stamp, '__v': 0}


def new_user(username, email, password_hash, display_name):
    return _base(
        username=username, email=email, password=password_hash, displayName=display_name,
        avatar='', bio='', status='offline', customStatus='', twoFactorEnabled=False,
        twoFactorSecret='', tokenVersion=0, blockedUsers=[],
        notificationPreferences={'mentions': True, 'replies': True, 'reactions': True, 'sounds': True},
        servers=[], dmChannels=[], starredMessages=[],
    )


def new_member(user_id, role='member'):
    return {'user': user_id, 'role': role, 'roleIds': [], 'nickname': '', 'joinedAt': now()}


def invite_code():
    # crypto-random so invite codes can't be predicted or enumerated
    return secrets.token_hex(5).upper()


def new_server(name, description, icon, owner_id):
    return _base(
        name=name, description=description, icon=icon, banner='', owner=owner_id, roles=[],
        members=[new_member(owner_id, 'owner')], channels=[], inviteCode=invite_code(),
        settings={'isPublic': True, 'allowInvites': True, 'spamFilter': False, 'filteredWords': []},
    )


def new_channel(name, type_='text', server_id=None, topic='', participants=None):
    return _base(
        name=name, type=type_, server=server_id, topic=topic, participants=participants or [],
        pinnedMessages=[], lastMessage=None, readBy=[],
        settings={'slowMode': 0, 'nsfw': False, 'locked': False},
    )


def new_message(content, author_id, channel_id, server_id=None, **extra):
    doc = _base(
        content=content, author=author_id, channel=channel_id, server=server_id, type='text',
        attachments=[], linkPreviews=[], reactions=[], mentions=[], replyTo=None, thread=None,
        threadCount=0, isEdited=False, editHistory=[], isDeleted=False, isPinned=False,
        scheduledFor=None, isScheduled=False,
    )
    doc.update(extra)
    return doc


def new_notification(user_id, type_, title='', body='', message=None, channel=None, server=None, sender=None):
    return _base(user=user_id, type=type_, title=title, body=body, message=message,
                 channel=channel, server=server, sender=sender, read=False)


def new_audit_log(server_id, action, user_id, target='', target_id=None, details=None):
    return _base(server=server_id, action=action, user=user_id, target=target,
                 targetId=target_id, details=details or {})
