import asyncio
import io
import logging
import os

import cloudinary
import cloudinary.uploader
from fastapi import APIRouter, Request
from starlette.datastructures import UploadFile

from ..file_signature import FILE_TYPES, IMAGE_TYPES, matches_declared_type
from ..http import ApiError, respond, route
from ..security import current_user

log = logging.getLogger('beacon')
router = APIRouter()

MAX_FILE = 10 * 1024 * 1024
MAX_IMAGE = 5 * 1024 * 1024

cloudinary.config(
    cloud_name=os.getenv('CLOUDINARY_CLOUD_NAME'),
    api_key=os.getenv('CLOUDINARY_API_KEY'),
    api_secret=os.getenv('CLOUDINARY_API_SECRET'),
    secure=True,
)


async def _read_file(request, field, allowed, max_bytes):
    """Reads one multipart file, enforcing type, size and real file signature."""
    length = request.headers.get('content-length')
    if length and length.isdigit() and int(length) > max_bytes + 64 * 1024:
        raise ApiError(413, 'File is too large')
    try:
        form = await request.form(max_files=1, max_fields=5)
    except Exception:
        raise ApiError(400, 'Invalid upload')
    upload = form.get(field)
    if not isinstance(upload, UploadFile):
        raise ApiError(400, 'No file provided')
    mimetype = upload.content_type or ''
    if mimetype not in allowed:
        raise ApiError(400, f'File type {mimetype} is not allowed')
    data = await upload.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ApiError(413, 'File is too large')
    if not matches_declared_type(data, mimetype):
        raise ApiError(400, 'File content does not match its type')
    return data, mimetype, (upload.filename or 'file')[:255]


async def _to_cloudinary(data, **options):
    return await asyncio.to_thread(lambda: cloudinary.uploader.upload(io.BytesIO(data), **options))


@router.post('')
@router.post('/')
@route('Upload failed')
async def upload_file(request: Request):
    await current_user(request)
    data, mimetype, name = await _read_file(request, 'file', FILE_TYPES, MAX_FILE)
    result = await _to_cloudinary(data, folder='royal-beacon/attachments', resource_type='auto',
                                  use_filename=True, unique_filename=True, filename_override=name)
    return respond({'url': result['secure_url'], 'publicId': result['public_id'],
                    'type': mimetype, 'name': name, 'size': len(data)})


@router.post('/avatar')
@route('Avatar upload failed')
async def upload_avatar(request: Request):
    await current_user(request)
    data, *_ = await _read_file(request, 'avatar', IMAGE_TYPES, MAX_IMAGE)
    result = await _to_cloudinary(data, folder='royal-beacon/avatars', resource_type='image',
                                  transformation=[{'width': 256, 'height': 256, 'crop': 'fill', 'gravity': 'face'}])
    return respond({'url': result['secure_url'], 'publicId': result['public_id']})


@router.post('/server-icon')
@route('Server icon upload failed')
async def upload_server_icon(request: Request):
    await current_user(request)
    data, *_ = await _read_file(request, 'icon', IMAGE_TYPES, MAX_IMAGE)
    result = await _to_cloudinary(data, folder='royal-beacon/server-icons', resource_type='image',
                                  transformation=[{'width': 256, 'height': 256, 'crop': 'fill', 'gravity': 'center'}])
    return respond({'url': result['secure_url'], 'publicId': result['public_id']})
