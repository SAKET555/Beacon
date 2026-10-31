"""Request/response helpers shared by every route (Express-compatible error shapes)."""
import functools
import json
import logging
import traceback

from fastapi import Request
from fastapi.responses import JSONResponse

from . import config
from .serialize import to_json
from .validation import is_id

log = logging.getLogger('beacon')

MAX_JSON_BYTES = 100 * 1024


class ApiError(Exception):
    """Raised anywhere in a route to send {"error": message} with a status code."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


class ValidationFailed(Exception):
    """express-validator compatible: {"errors": [{type, value, msg, path, location}]}"""

    def __init__(self, errors):
        super().__init__('Validation failed')
        self.errors = errors


def respond(data, status=200):
    return JSONResponse(to_json(data), status_code=status)


def route(fallback_message):
    """Wraps a handler so unexpected exceptions become the route's generic 500."""
    def decorator(handler):
        @functools.wraps(handler)
        async def wrapper(*args, **kwargs):
            try:
                return await handler(*args, **kwargs)
            except ApiError as error:
                return JSONResponse({'error': error.message}, status_code=error.status)
            except ValidationFailed as error:
                return JSONResponse({'errors': to_json(error.errors)}, status_code=400)
            except Exception:
                log.error('%s\n%s', fallback_message, traceback.format_exc())
                return JSONResponse({'error': fallback_message}, status_code=500)
        return wrapper
    return decorator


async def read_json(request: Request):
    """Parses a JSON body (max 100 KB). Non-object bodies become {}."""
    raw = await request.body()
    if len(raw) > MAX_JSON_BYTES:
        raise ApiError(413, 'Request body is too large')
    if not raw:
        return {}
    try:
        body = json.loads(raw)
    except ValueError:
        raise ApiError(400, 'Invalid JSON')
    return body if isinstance(body, dict) else {}


def require_id(*values):
    """Malformed ids get a 400 instead of a database error."""
    for value in values:
        if not is_id(value):
            raise ApiError(400, 'Invalid id')


def internal_error_response(error):
    message = 'Internal server error' if config.IS_PROD else str(error)
    return JSONResponse({'error': message}, status_code=500)
