"""Passwords and JWTs. Hashes and tokens are interchangeable with the old Node
backend (bcrypt + HS256 JWT with {userId, v})."""
import asyncio
import time

import bcrypt
import jwt
from bson import ObjectId
from fastapi import Request

from . import config, db
from .http import ApiError

ALGORITHM = 'HS256'

# Never sent to clients.
PRIVATE_USER_FIELDS = {'password': 0, 'twoFactorSecret': 0, 'tokenVersion': 0}


async def hash_password(password):
    return await asyncio.to_thread(
        lambda: bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt(12)).decode())


async def check_password(password, hashed):
    if not hashed:
        return False
    return await asyncio.to_thread(
        lambda: bcrypt.checkpw(password.encode()[:72], hashed.encode()))


def sign_token(user):
    issued = int(time.time())
    payload = {
        'userId': str(user['_id']),
        'v': user.get('tokenVersion', 0) or 0,
        'iat': issued,
        'exp': issued + config.parse_duration(config.JWT_EXPIRES_IN),
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm=ALGORITHM)


class TokenError(Exception):
    def __init__(self, expired=False):
        super().__init__('expired' if expired else 'invalid')
        self.expired = expired


async def authenticate_token(token):
    """Returns the user for a valid token. A token is only valid while its
    version matches user.tokenVersion, so bumping it revokes all old tokens."""
    try:
        decoded = jwt.decode(token, config.JWT_SECRET, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise TokenError(expired=True)
    except jwt.PyJWTError:
        raise TokenError()

    user_id = decoded.get('userId')
    if not isinstance(user_id, str) or not ObjectId.is_valid(user_id):
        raise TokenError()
    user = await db.users().find_one({'_id': ObjectId(user_id)}, {'password': 0, 'twoFactorSecret': 0})
    if not user:
        raise TokenError()
    if (decoded.get('v') or 0) != (user.get('tokenVersion') or 0):
        raise TokenError()
    return user


async def current_user(request: Request):
    header = request.headers.get('authorization', '')
    token = header[7:] if header.startswith('Bearer ') else ''
    if not token:
        raise ApiError(401, 'Authentication required')
    try:
        return await authenticate_token(token)
    except TokenError as error:
        raise ApiError(401, 'Token expired' if error.expired else 'Invalid token')


def public_user(user):
    """Equivalent of the Mongoose toJSON transform."""
    return {k: v for k, v in user.items() if k not in PRIVATE_USER_FIELDS}
