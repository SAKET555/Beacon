import os

os.environ.setdefault('MONGODB_URI', 'mongodb://127.0.0.1:1/test')
os.environ.setdefault('JWT_SECRET', 'x' * 48)
os.environ['CLOUDINARY_CLOUD_NAME'] = 'demo'

import pytest  # noqa: E402

from app import config  # noqa: E402
from app.file_signature import matches_declared_type  # noqa: E402
from app.link_preview import is_private_ip, validate_url  # noqa: E402
from app.permissions import can_grant, ensure_server_roles, member_permissions  # noqa: E402
from app.validation import (clean_media_url, is_hex_color, is_id, normalize_email, parse_date,  # noqa: E402
                            parse_paging, sanitize_attachments, sanitize_server_settings)

config.CLOUDINARY_CLOUD_NAME = 'demo'


@pytest.mark.parametrize('ip', ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
                                '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::',
                                'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'not-an-ip'])
def test_private_ips_blocked(ip):
    assert is_private_ip(ip)


@pytest.mark.parametrize('ip', ['8.8.8.8', '1.1.1.1', '172.217.0.1', '172.32.0.1', '2606:4700:4700::1111'])
def test_public_ips_allowed(ip):
    assert not is_private_ip(ip)


@pytest.mark.parametrize('url', ['http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://2130706433/',
                                 'http://169.254.169.254/latest/meta-data', 'ftp://example.com/',
                                 'http://user:pass@example.com/', 'http://example.com:8080/',
                                 'http://printer.local/', 'javascript:alert(1)', 'http://0x7f.1/'])
def test_unsafe_preview_urls(url):
    assert validate_url(url) is None


def test_safe_preview_urls():
    assert validate_url('https://example.com/page')
    assert validate_url('http://example.com:80/page')


def test_file_signatures():
    png = b'\x89PNG\r\n\x1a\n\x00\x00'
    html = b'<html><script>alert(1)</script></html>'
    assert matches_declared_type(png, 'image/png')
    assert matches_declared_type(b'%PDF-1.7', 'application/pdf')
    assert not matches_declared_type(html, 'image/png')
    assert matches_declared_type(html, 'text/plain')
    assert not matches_declared_type(b'<svg/>', 'image/svg+xml')
    assert not matches_declared_type(b'\x00\x01', 'text/plain')


def test_ids():
    assert is_id('507f1f77bcf86cd799439011')
    assert not is_id('starred')
    assert not is_id('aaaaaaaaaaaa')
    assert not is_id({'$ne': None})


def test_paging_caps():
    assert parse_paging({'limit': '1000000', 'page': '2'}) == (2, 100, 100)
    assert parse_paging({'limit': '-5', 'page': 'abc'}) == (1, 1, 0)
    assert parse_paging({}) == (1, 50, 0)


def test_dates():
    assert parse_date('2026-01-02T03:04:05.000Z').year == 2026
    assert parse_date('nonsense') is None
    assert parse_date({'$gt': 1}) is None


def test_media_urls():
    assert clean_media_url('https://res.cloudinary.com/x/a.png') == 'https://res.cloudinary.com/x/a.png'
    assert clean_media_url('') == ''
    assert clean_media_url('http://example.com/a.png') is None
    assert clean_media_url('javascript:alert(1)') is None
    assert clean_media_url({'url': 'x'}) is None


def test_server_settings_whitelist():
    out = sanitize_server_settings({'isPublic': False, 'spamFilter': 'yes', 'owner': 'evil',
                                    'filteredWords': ['bad', 42, '  '], 'defaultChannel': 'x'})
    assert out == {'isPublic': False, 'filteredWords': ['bad']}


def test_attachments_only_own_cloudinary():
    out = sanitize_attachments([
        {'url': 'https://res.cloudinary.com/demo/image/upload/a.png', 'name': 'a.png', 'size': 10, 'extra': 'x'},
        {'url': 'https://res.cloudinary.com/other/image/upload/b.png'},
        {'url': 'https://evil.example/tracker.gif'},
        'not-an-object',
    ])
    assert len(out) == 1 and out[0]['name'] == 'a.png' and 'extra' not in out[0]


def test_hex_color():
    assert is_hex_color('#8b5cf6')
    assert not is_hex_color('red;background:url(x)')


def test_email_normalisation_matches_node():
    assert normalize_email('John.Doe+spam@GoogleMail.com') == 'johndoe@gmail.com'
    assert normalize_email('Alice+x@outlook.com') == 'alice@outlook.com'
    assert normalize_email('Bob@Example.com') == 'bob@example.com'


def test_permissions_and_escalation():
    server = {'members': [{'user': 'a', 'role': 'owner'}, {'user': 'b', 'role': 'moderator'}]}
    ensure_server_roles(server)
    owner, moderator = server['members']
    assert member_permissions(server, owner)['manageServer']
    assert not member_permissions(server, moderator)['manageServer']
    assert member_permissions(server, moderator)['manageMessages']
    assert not can_grant(server, moderator, {'manageServer': True})
    assert can_grant(server, moderator, {'manageMessages': True})
    assert can_grant(server, owner, {'manageServer': True})


def test_populate_projection():
    from app.populate import projection
    assert projection('username displayName') == {'username': 1, 'displayName': 1}
    assert projection('-password -twoFactorSecret') == {'password': 0, 'twoFactorSecret': 0}
