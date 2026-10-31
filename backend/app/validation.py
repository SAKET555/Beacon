"""Input validation and sanitising helpers."""
import re
from datetime import datetime, timezone
from urllib.parse import urlparse

from bson import ObjectId

from . import config

_HEX_ID = re.compile(r'^[a-fA-F0-9]{24}$')
_HEX_COLOR = re.compile(r'^#[0-9a-fA-F]{6}$')


def is_id(value):
    """Strict 24-char hex ObjectId string."""
    return isinstance(value, str) and bool(_HEX_ID.match(value)) and ObjectId.is_valid(value)


def parse_paging(query, default_limit=50, max_limit=100):
    """Caps page/limit so ?limit=1000000 cannot dump a whole collection."""
    def as_int(value, fallback):
        try:
            return int(str(value).strip())
        except (TypeError, ValueError):
            return fallback

    limit = as_int(query.get('limit'), default_limit) or default_limit
    limit = min(max(limit, 1), max_limit)
    page = min(max(as_int(query.get('page'), 1) or 1, 1), 10000)
    return page, limit, (page - 1) * limit


def parse_date(value):
    """Accepts ISO strings and epoch milliseconds; returns a naive UTC datetime or None."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        if isinstance(value, (int, float)) or (isinstance(value, str) and re.fullmatch(r'-?\d+', value.strip())):
            return datetime.fromtimestamp(float(value) / 1000, timezone.utc).replace(tzinfo=None)
        if isinstance(value, str):
            text = value.strip().replace('Z', '+00:00')
            parsed = datetime.fromisoformat(text)
            if parsed.tzinfo:
                parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
            return parsed
    except (ValueError, OverflowError, OSError):
        return None
    return None


def escape_regex(value):
    return re.escape(str(value))


def is_https_url(value, max_length=2048):
    if not isinstance(value, str) or len(value) > max_length or re.search(r'\s', value):
        return False
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    return parsed.scheme == 'https' and bool(parsed.netloc)


def clean_media_url(value):
    """'' clears the field, an https URL is kept, anything else is invalid (None)."""
    if value == '' or value is None:
        return ''
    return value if is_https_url(value) else None


def clean_string(value, max_length):
    return value.strip()[:max_length] if isinstance(value, str) else None


def is_hex_color(value):
    return isinstance(value, str) and bool(_HEX_COLOR.match(value))


# --- email (mirrors express-validator's isEmail + normalizeEmail defaults so
# existing accounts, stored normalised, still match on login) -----------------

_GMAIL = {'gmail.com', 'googlemail.com'}
_OUTLOOK = {'hotmail.at', 'hotmail.be', 'hotmail.ca', 'hotmail.cl', 'hotmail.co.il', 'hotmail.co.nz',
            'hotmail.co.th', 'hotmail.co.uk', 'hotmail.com', 'hotmail.com.ar', 'hotmail.com.au',
            'hotmail.com.br', 'hotmail.com.gr', 'hotmail.com.mx', 'hotmail.com.pe', 'hotmail.com.tr',
            'hotmail.com.vn', 'hotmail.cz', 'hotmail.de', 'hotmail.dk', 'hotmail.es', 'hotmail.fr',
            'hotmail.hu', 'hotmail.id', 'hotmail.ie', 'hotmail.in', 'hotmail.it', 'hotmail.jp',
            'hotmail.kr', 'hotmail.lv', 'hotmail.my', 'hotmail.ph', 'hotmail.pt', 'hotmail.sa',
            'hotmail.sg', 'hotmail.sk', 'live.be', 'live.co.uk', 'live.com', 'live.com.ar',
            'live.com.mx', 'live.de', 'live.es', 'live.eu', 'live.fr', 'live.it', 'live.nl', 'msn.com',
            'outlook.at', 'outlook.be', 'outlook.cl', 'outlook.co.il', 'outlook.co.nz', 'outlook.co.th',
            'outlook.com', 'outlook.com.ar', 'outlook.com.au', 'outlook.com.br', 'outlook.com.gr',
            'outlook.com.pe', 'outlook.com.tr', 'outlook.com.vn', 'outlook.cz', 'outlook.de',
            'outlook.dk', 'outlook.es', 'outlook.fr', 'outlook.hu', 'outlook.id', 'outlook.ie',
            'outlook.in', 'outlook.it', 'outlook.jp', 'outlook.kr', 'outlook.lv', 'outlook.my',
            'outlook.ph', 'outlook.pt', 'outlook.sa', 'outlook.sg', 'outlook.sk', 'passport.com'}
_YAHOO = {'rocketmail.com', 'yahoo.ca', 'yahoo.co.uk', 'yahoo.com', 'yahoo.de', 'yahoo.fr',
          'yahoo.in', 'yahoo.it', 'ymail.com'}
_ICLOUD = {'icloud.com', 'me.com'}
_YANDEX = {'yandex.ru', 'yandex.ua', 'yandex.kz', 'yandex.com', 'yandex.by', 'ya.ru'}


_EMAIL_LOCAL = re.compile(r"^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$")
_EMAIL_LABEL = re.compile(r'^(?!-)[A-Za-z0-9¡-￿-]{1,63}(?<!-)$')
_EMAIL_TLD = re.compile(r'^([A-Za-z¡-￿]{2,}|xn--[A-Za-z0-9-]{2,})$')


def is_email(value):
    """Same rules as validator.js isEmail (used by the old backend): requires a TLD,
    accepts any domain including reserved ones like .test."""
    if not isinstance(value, str) or len(value) > 254 or value.count('@') != 1:
        return False
    local, domain = value.split('@')
    if not 0 < len(local) <= 64 or not _EMAIL_LOCAL.match(local):
        return False
    labels = domain.split('.')
    return (len(labels) >= 2 and all(_EMAIL_LABEL.match(label) for label in labels)
            and bool(_EMAIL_TLD.match(labels[-1])))


def normalize_email(email):
    local, _, domain = email.rpartition('@')
    domain = domain.lower()
    local = local.lower()
    if domain in _GMAIL:
        local = local.split('+')[0].replace('.', '')
        domain = 'gmail.com'
    elif domain in _OUTLOOK or domain in _ICLOUD:
        local = local.split('+')[0]
    elif domain in _YAHOO:
        parts = local.split('-')
        local = '-'.join(parts[:-1]) if len(parts) > 1 else local
    elif domain in _YANDEX:
        domain = 'yandex.ru'
    return f'{local}@{domain}'


# --- settings / attachment sanitisers ----------------------------------------

def sanitize_server_settings(value):
    """Only these keys may ever be written from a request body."""
    out = {}
    if not isinstance(value, dict):
        return out
    for key in ('isPublic', 'allowInvites', 'spamFilter'):
        if isinstance(value.get(key), bool):
            out[key] = value[key]
    if isinstance(value.get('filteredWords'), list):
        words = [w.strip()[:50] for w in value['filteredWords'] if isinstance(w, str)]
        out['filteredWords'] = [w for w in words if w][:200]
    if is_id(value.get('defaultChannel')):
        out['defaultChannel'] = value['defaultChannel']  # caller checks it belongs to the server
    return out


def sanitize_channel_settings(value):
    out = {}
    if not isinstance(value, dict):
        return out
    for key in ('nsfw', 'locked'):
        if isinstance(value.get(key), bool):
            out[key] = value[key]
    slow = value.get('slowMode')
    if isinstance(slow, int) and not isinstance(slow, bool):
        out['slowMode'] = min(max(slow, 0), 21600)
    return out


def is_own_media_url(value):
    """Attachments must come from our own Cloudinary account (what /api/upload returns)."""
    if not is_https_url(value):
        return False
    parsed = urlparse(value)
    if parsed.hostname != 'res.cloudinary.com':
        return False
    cloud = config.CLOUDINARY_CLOUD_NAME
    return not cloud or parsed.path.startswith(f'/{cloud}/')


def sanitize_attachments(value):
    if not isinstance(value, list):
        return []
    out = []
    for item in value[:10]:
        if not isinstance(item, dict) or not is_own_media_url(item.get('url')):
            continue
        cleaned = {'_id': ObjectId(), 'url': item['url']}
        for key, limit in (('publicId', 256), ('type', 100), ('name', 255)):
            text = clean_string(item.get(key), limit)
            if text:
                cleaned[key] = text
        size = item.get('size')
        if isinstance(size, (int, float)) and not isinstance(size, bool) and size >= 0:
            cleaned['size'] = size
        out.append(cleaned)
    return out
