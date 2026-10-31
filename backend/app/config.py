"""Environment loading and validation. Fails fast instead of running insecurely."""
import os
import re
import sys

from dotenv import load_dotenv

load_dotenv()

IS_PROD = os.getenv('NODE_ENV', os.getenv('ENV', 'development')) == 'production'
PORT = int(os.getenv('PORT', '5000'))
MONGODB_URI = os.getenv('MONGODB_URI', '')
DB_NAME = os.getenv('DB_NAME', 'royal-beacon')
JWT_SECRET = os.getenv('JWT_SECRET', '')
JWT_EXPIRES_IN = os.getenv('JWT_EXPIRES_IN', '7d')
CLOUDINARY_CLOUD_NAME = os.getenv('CLOUDINARY_CLOUD_NAME', '')

_LOCAL_ORIGIN = re.compile(r'^https?://(localhost|127\.0\.0\.1)(:\d+)?$')


def validate_env():
    required = ['MONGODB_URI', 'JWT_SECRET'] + (['CLIENT_URL'] if IS_PROD else [])
    missing = [key for key in required if not os.getenv(key)]
    if missing:
        print(f"Missing required environment variables: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    if len(JWT_SECRET) < 32:
        message = ('JWT_SECRET must be at least 32 characters. Generate one with: '
                   'python -c "import secrets; print(secrets.token_hex(48))"')
        if IS_PROD:
            print(message, file=sys.stderr)
            sys.exit(1)
        print(f'Warning: {message}', file=sys.stderr)


def allowed_origins():
    """CLIENT_URL may be a comma-separated list (e.g. production + preview domains)."""
    return [o.strip().rstrip('/') for o in os.getenv('CLIENT_URL', '').split(',') if o.strip()]


def is_origin_allowed(origin, *_):
    # Requests without an Origin header (curl, server-to-server) are not CORS.
    if not origin:
        return True
    if origin in allowed_origins():
        return True
    return not IS_PROD and bool(_LOCAL_ORIGIN.match(origin))


def parse_duration(value):
    """'7d' / '12h' / '30m' / '3600' -> seconds (mirrors jsonwebtoken's expiresIn)."""
    match = re.fullmatch(r'\s*(\d+)\s*([smhd]?)\s*', value or '')
    if not match:
        return 7 * 86400
    amount, unit = int(match.group(1)), match.group(2) or 's'
    return amount * {'s': 1, 'm': 60, 'h': 3600, 'd': 86400}[unit]
