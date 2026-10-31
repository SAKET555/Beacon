import re

from fastapi import APIRouter, Request
from pymongo.errors import DuplicateKeyError

from .. import db
from ..http import ApiError, ValidationFailed, read_json, respond, route
from ..models import new_user
from ..populate import populate
from ..security import (PRIVATE_USER_FIELDS, check_password, current_user, hash_password,
                        public_user, sign_token)
from ..validation import is_email, normalize_email

router = APIRouter()

USERNAME_RE = re.compile(r'^[a-zA-Z0-9_]+$')


def _field_error(path, value, msg):
    return {'type': 'field', 'value': value, 'msg': msg, 'path': path, 'location': 'body'}


@router.post('/register')
@route('Registration failed')
async def register(request: Request):
    body = await read_json(request)
    errors = []
    username = body.get('username')
    email = body.get('email')
    password = body.get('password')
    display_name = body.get('displayName')

    if not isinstance(username, str) or not 3 <= len(username.strip()) <= 32:
        errors.append(_field_error('username', username, 'Username must be 3-32 characters'))
    elif not USERNAME_RE.match(username.strip()):
        errors.append(_field_error('username', username,
                                   'Username can only contain letters, numbers, and underscores'))
    if not is_email(email):
        errors.append(_field_error('email', email, 'Please enter a valid email address'))
    if not isinstance(password, str) or not 8 <= len(password) <= 128:
        errors.append(_field_error('password', password, 'Password must be 8-128 characters'))
    if display_name is not None and (not isinstance(display_name, str) or len(display_name.strip()) > 32):
        errors.append(_field_error('displayName', display_name, 'Display name must be at most 32 characters'))
    if errors:
        raise ValidationFailed(errors)

    username = username.strip()
    email = normalize_email(email)
    existing = await db.users().find_one({'$or': [{'email': email}, {'username': username}]}, {'email': 1})
    if existing:
        field = 'email' if existing.get('email') == email else 'username'
        raise ApiError(400, f'This {field} is already in use')

    user = new_user(username, email, await hash_password(password),
                    (display_name or '').strip() or username)
    try:
        await db.users().insert_one(user)
    except DuplicateKeyError:
        raise ApiError(400, 'This email or username is already in use')

    return respond({'token': sign_token(user), 'user': public_user(user)}, 201)


@router.post('/login')
@route('Login failed')
async def login(request: Request):
    body = await read_json(request)
    email, password = body.get('email'), body.get('password')
    errors = []
    if not is_email(email):
        errors.append(_field_error('email', email, 'Invalid value'))
    if not isinstance(password, str) or not password or len(password) > 128:
        errors.append(_field_error('password', password, 'Invalid value'))
    if errors:
        raise ValidationFailed(errors)

    user = await db.users().find_one({'email': normalize_email(email)})
    if not user or not await check_password(password, user.get('password')):
        raise ApiError(401, 'Invalid email or password')

    await db.users().update_one({'_id': user['_id']}, {'$set': {'status': 'online', 'updatedAt': db.now()}})
    user['status'] = 'online'
    return respond({'token': sign_token(user), 'user': public_user(user)})


@router.get('/me')
@route('Failed to fetch user')
async def me(request: Request):
    viewer = await current_user(request)
    user = await db.users().find_one({'_id': viewer['_id']}, PRIVATE_USER_FIELDS)
    await populate(user, 'servers', db.servers(), 'name icon')
    return respond({'user': user})


@router.post('/refresh')
@route('Token refresh failed')
async def refresh(request: Request):
    user = await current_user(request)
    return respond({'token': sign_token(user)})


@router.post('/logout-all')
@route('Failed to sign out other sessions')
async def logout_all(request: Request):
    """Revokes every token issued so far; returns a fresh one for this device."""
    user = await current_user(request)
    updated = await db.users().find_one_and_update(
        {'_id': user['_id']}, {'$inc': {'tokenVersion': 1}},
        projection={'tokenVersion': 1}, return_document=True)
    return respond({'token': sign_token(updated)})
