"""Beacon backend (Python). Run with: uvicorn app.main:app --port 5000"""
import asyncio
import logging
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import socketio
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import config

config.validate_env()

from . import db, sockets  # noqa: E402  (sockets registers the event handlers)
from .push import init_web_push  # noqa: E402
from .realtime import sio  # noqa: E402
from .routes import admin, auth, calls, channels, messages, notifications, servers, upload, users  # noqa: E402
from .scheduled import scheduler_loop  # noqa: E402

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('beacon')
_ = sockets


@asynccontextmanager
async def lifespan(_app):
    await db.connect()
    init_web_push()
    task = asyncio.create_task(scheduler_loop())
    log.info('Beacon (Python) running on port %s', config.PORT)
    yield
    task.cancel()


api = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


# --- rate limiting -------------------------------------------------------------
class SlidingWindow:
    def __init__(self, limit, window_seconds, message, skip_successful=False):
        self.limit, self.window, self.message = limit, window_seconds, message
        self.skip_successful = skip_successful
        self.hits = defaultdict(deque)

    def blocked(self, key):
        hits, cutoff = self.hits[key], time.monotonic() - self.window
        while hits and hits[0] < cutoff:
            hits.popleft()
        return len(hits) >= self.limit

    def record(self, key):
        self.hits[key].append(time.monotonic())

    def undo(self, key):
        if self.hits[key]:
            self.hits[key].pop()


GLOBAL_LIMIT = SlidingWindow(300, 15 * 60, 'Too many requests, please try again later.')
LIMITS = {
    # Much stricter limits on credential endpoints to slow down password guessing
    '/api/auth/login': SlidingWindow(10, 15 * 60, 'Too many login attempts, please try again in 15 minutes.',
                                     skip_successful=True),
    '/api/auth/register': SlidingWindow(10, 60 * 60, 'Too many accounts created, please try again later.'),
}


def client_ip(request: Request):
    # Behind one reverse proxy (Render/Vercel): the last X-Forwarded-For hop is the client
    forwarded = request.headers.get('x-forwarded-for')
    if forwarded:
        return forwarded.split(',')[-1].strip()
    return request.client.host if request.client else 'unknown'


SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-DNS-Prefetch-Control': 'off',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
}


@api.middleware('http')
async def guard(request: Request, call_next):
    path = request.url.path
    ip = client_ip(request)
    limiters = []
    if path.startswith('/api/'):
        limiters.append(GLOBAL_LIMIT)
        if path in LIMITS and request.method == 'POST':
            limiters.append(LIMITS[path])
    for limiter in limiters:
        if limiter.blocked(ip):
            return JSONResponse({'error': limiter.message}, status_code=429)
    for limiter in limiters:
        limiter.record(ip)

    started = time.perf_counter()
    response = await call_next(request)
    for limiter in limiters:
        if limiter.skip_successful and response.status_code < 400:
            limiter.undo(ip)

    for header, value in SECURITY_HEADERS.items():
        response.headers.setdefault(header, value)
    if config.IS_PROD:
        response.headers.setdefault('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
    log.info('%s %s %s %.0fms', request.method, path, response.status_code, (time.perf_counter() - started) * 1000)
    return response


# Only origins in CLIENT_URL (plus localhost in development) may call the API
api.add_middleware(
    CORSMiddleware,
    allow_origins=config.allowed_origins(),
    allow_origin_regex=None if config.IS_PROD else r'^https?://(localhost|127\.0\.0\.1)(:\d+)?$',
    allow_credentials=True,
    allow_methods=['GET', 'POST', 'PATCH', 'DELETE'],
    allow_headers=['*'],
)


@api.exception_handler(StarletteHTTPException)
async def http_error(request: Request, error: StarletteHTTPException):
    messages = {404: 'Not found', 405: 'Method not allowed'}
    return JSONResponse({'error': messages.get(error.status_code, error.detail)}, status_code=error.status_code)


@api.exception_handler(Exception)
async def unhandled_error(request: Request, error: Exception):
    log.exception('Server error')
    return JSONResponse({'error': 'Internal server error' if config.IS_PROD else str(error)}, status_code=500)


for prefix, module in (('auth', auth), ('users', users), ('servers', servers), ('channels', channels),
                       ('messages', messages), ('upload', upload), ('admin', admin),
                       ('notifications', notifications), ('calls', calls)):
    api.include_router(module.router, prefix=f'/api/{prefix}')


@api.get('/api/health')
async def health():
    now = datetime.now(timezone.utc)
    return {'status': 'ok', 'timestamp': now.strftime('%Y-%m-%dT%H:%M:%S.') + f'{now.microsecond // 1000:03d}Z',
            'runtime': 'python'}


@api.get('/')
async def root():
    return PlainTextResponse('Royal Beacon Backend is running. Live at /api/health')


# Socket.IO and the HTTP API share one port, like before.
app = socketio.ASGIApp(sio, other_asgi_app=api, socketio_path='socket.io')
