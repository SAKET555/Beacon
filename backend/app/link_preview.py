"""Link previews with SSRF protection: every redirect is re-validated and
private addresses are rejected at connect time (defeats DNS rebinding)."""
import asyncio
import html
import ipaddress
import re
import socket
from urllib.parse import urljoin, urlparse

import aiohttp
from aiohttp.abc import AbstractResolver

URL_RE = re.compile(r'(https?://[^\s<>"\']+)', re.I)
MAX_REDIRECTS = 3
MAX_BODY_BYTES = 512 * 1024
TIMEOUT_SECONDS = 5

_V4_BLOCKED = [ipaddress.ip_network(n) for n in (
    '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
    '172.16.0.0/12', '192.0.0.0/24', '192.168.0.0/16', '198.18.0.0/15', '224.0.0.0/3')]
_V6_BLOCKED = [ipaddress.ip_network(n) for n in ('::/8', 'fc00::/7', 'fe80::/10', 'ff00::/8')]


def is_private_ip(value):
    """Unknown / unparseable addresses count as private (fail closed)."""
    try:
        ip = ipaddress.ip_address(value.split('%')[0])
    except ValueError:
        return True
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped:
            return is_private_ip(str(ip.ipv4_mapped))
        return any(ip in net for net in _V6_BLOCKED)
    return any(ip in net for net in _V4_BLOCKED)


class GuardedResolver(AbstractResolver):
    def __init__(self):
        self._inner = aiohttp.ThreadedResolver()

    async def resolve(self, host, port=0, family=socket.AF_INET):
        results = await self._inner.resolve(host, port, family)
        if any(is_private_ip(r['host']) for r in results):
            raise OSError('Blocked address')
        return results

    async def close(self):
        await self._inner.close()


def validate_url(value):
    """Returns the URL string if it is safe to request, otherwise None."""
    try:
        parsed = urlparse(value)
        port = parsed.port
    except ValueError:
        return None
    if parsed.scheme not in ('http', 'https') or parsed.username or parsed.password:
        return None
    if port not in (None, 80, 443):
        return None
    host = (parsed.hostname or '').lower()
    if not host or host == 'localhost' or host.endswith(('.localhost', '.local', '.internal')):
        return None
    try:
        ipaddress.ip_address(host)
        if is_private_ip(host):
            return None
    except ValueError:
        # "2130706433", "0x7f.1", "0177.0.0.1" are legacy IP spellings of 127.0.0.1
        if all(re.fullmatch(r'0x[0-9a-f]*|\d+', part) for part in host.split('.') if part):
            return None
    return value


def extract_urls(content):
    seen = []
    for url in URL_RE.findall(content or ''):
        if url not in seen:
            seen.append(url)
    return seen[:3]


def _meta(doc, name):
    patterns = (
        rf'<meta[^>]+(?:property|name)=["\']{name}["\'][^>]*?content=["\']([^"\']*)["\']',
        rf'<meta[^>]+content=["\']([^"\']*)["\'][^>]*?(?:property|name)=["\']{name}["\']',
    )
    for pattern in patterns:
        match = re.search(pattern, doc, re.I)
        if match:
            return html.unescape(match.group(1))
    return ''


def parse_meta(doc):
    title_match = re.search(r'<title[^>]*>([^<]+)</title>', doc, re.I)
    return {
        'title': _meta(doc, 'og:title') or _meta(doc, 'twitter:title')
        or (html.unescape(title_match.group(1).strip()) if title_match else ''),
        'description': _meta(doc, 'og:description') or _meta(doc, 'twitter:description') or _meta(doc, 'description'),
        'image': _meta(doc, 'og:image') or _meta(doc, 'twitter:image'),
        'siteName': _meta(doc, 'og:site_name'),
    }


def _empty(url):
    return {'url': url, 'title': '', 'description': '', 'image': '', 'siteName': ''}


def _resolve_image(image, base):
    if not image:
        return ''
    resolved = urljoin(base, image)
    return resolved if urlparse(resolved).scheme in ('http', 'https') else ''


async def fetch_preview(url):
    current = validate_url(url)
    if not current:
        return _empty(url)
    connector = aiohttp.TCPConnector(resolver=GuardedResolver(), limit=2)
    timeout = aiohttp.ClientTimeout(total=TIMEOUT_SECONDS)
    try:
        async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
            for _ in range(MAX_REDIRECTS + 1):
                async with session.get(current, allow_redirects=False, headers={
                        'User-Agent': 'BeaconLinkPreview/1.0', 'Accept': 'text/html'}) as res:
                    location = res.headers.get('location')
                    if 300 <= res.status < 400 and location:
                        current = validate_url(urljoin(current, location))
                        if not current:
                            return _empty(url)
                        continue
                    if res.status >= 400 or 'text/html' not in res.headers.get('content-type', ''):
                        return _empty(url)
                    body = await res.content.read(MAX_BODY_BYTES)
                    meta = parse_meta(body.decode(res.charset or 'utf-8', errors='replace'))
                    return {
                        'url': url,
                        'title': meta['title'][:200],
                        'description': meta['description'][:300],
                        'image': _resolve_image(meta['image'], current),
                        'siteName': meta['siteName'][:100],
                    }
    except Exception:
        pass  # timeouts, blocked addresses, bad TLS: empty preview
    return _empty(url)


async def build_link_previews(content):
    from bson import ObjectId
    urls = [u for u in extract_urls(content) if validate_url(u)]
    previews = await asyncio.gather(*(fetch_preview(u) for u in urls))
    return [{'_id': ObjectId(), **p} for p in previews]
