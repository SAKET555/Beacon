"""Verifies uploaded bytes really are the type the client claimed
(the multipart Content-Type header is attacker controlled)."""


def _starts(buf, sig, offset=0):
    return buf[offset:offset + len(sig)] == sig


def _is_zip(b):
    return _starts(b, b'PK\x03\x04') or _starts(b, b'PK\x05\x06')


def _is_ole(b):
    return _starts(b, b'\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1')


CHECKS = {
    'image/jpeg': lambda b: _starts(b, b'\xFF\xD8\xFF'),
    'image/png': lambda b: _starts(b, b'\x89PNG\r\n\x1a\n'),
    'image/gif': lambda b: _starts(b, b'GIF87a') or _starts(b, b'GIF89a'),
    'image/webp': lambda b: _starts(b, b'RIFF') and _starts(b, b'WEBP', 8),
    'video/mp4': lambda b: _starts(b, b'ftyp', 4),
    'video/webm': lambda b: _starts(b, b'\x1A\x45\xDF\xA3'),
    'audio/mpeg': lambda b: _starts(b, b'ID3') or (len(b) > 1 and b[0] == 0xFF and (b[1] & 0xE0) == 0xE0),
    'audio/wav': lambda b: _starts(b, b'RIFF') and _starts(b, b'WAVE', 8),
    'audio/ogg': lambda b: _starts(b, b'OggS'),
    'audio/webm': lambda b: _starts(b, b'\x1A\x45\xDF\xA3'),
    'application/pdf': lambda b: _starts(b, b'%PDF'),
    'application/zip': _is_zip,
    'application/x-zip-compressed': _is_zip,
    'application/msword': _is_ole,
    'application/vnd.ms-excel': _is_ole,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': _is_zip,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': _is_zip,
    'text/plain': lambda b: b'\x00' not in b[:8000],
}

FILE_TYPES = [t for t in CHECKS]  # SVG intentionally absent: it can carry scripts
IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']


def matches_declared_type(data: bytes, mimetype: str) -> bool:
    check = CHECKS.get(mimetype)
    return bool(check) and len(data) > 0 and check(data)
