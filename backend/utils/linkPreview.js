const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const fetch = (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));

const URL_REGEX = /(https?:\/\/[^\s<>"']+)/gi;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;

const isPrivateIPv4 = (ip) => {
  const [a, b, c] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) ||           // link-local + cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224                              // multicast / reserved / broadcast
  );
};

const isPrivateIPv6 = (ip) => {
  const lower = ip.toLowerCase().split('%')[0];

  const mappedDotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return isPrivateIPv4(mappedDotted[1]);

  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }

  const first = parseInt(lower.split(':')[0] || '0', 16);
  return (
    first === 0 ||                       // ::, ::1, ::x
    (first & 0xfe00) === 0xfc00 ||       // fc00::/7 unique local
    (first & 0xffc0) === 0xfe80 ||       // fe80::/10 link-local
    (first & 0xff00) === 0xff00          // multicast
  );
};

// Unknown / unparseable addresses are treated as private (fail closed).
const isPrivateIp = (ip) => {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true;
};

// Runs at connect time, so DNS rebinding between "check" and "fetch" cannot slip through.
const guardedLookup = (hostname, options, callback) => {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  const opts = typeof options === 'number' ? { family: options } : { ...options };

  dns.lookup(hostname, { ...opts, all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (addresses.some(entry => isPrivateIp(entry.address))) {
      return callback(new Error('Blocked address'));
    }
    if (opts.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
};

const httpAgent = new http.Agent({ lookup: guardedLookup });
const httpsAgent = new https.Agent({ lookup: guardedLookup });
const pickAgent = (parsedUrl) => (parsedUrl.protocol === 'http:' ? httpAgent : httpsAgent);

// Returns a parsed URL if it is safe to request, otherwise null.
const validateUrl = (value) => {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    if (parsed.port && !['80', '443'].includes(parsed.port)) return null;

    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost') ||
        host.endsWith('.local') || host.endsWith('.internal')) return null;
    if (net.isIP(host) && isPrivateIp(host)) return null;
    return parsed;
  } catch (error) {
    return null;
  }
};

const extractUrls = (content) => {
  if (!content) return [];
  const urls = content.match(URL_REGEX) || [];
  return [...new Set(urls)].slice(0, 3);
};

const decode = (text) => text
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'");

const parseMeta = (html) => {
  const meta = (name) => {
    const nameFirst = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*?content=["']([^"']*)["']`, 'i');
    const contentFirst = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*?(?:property|name)=["']${name}["']`, 'i');
    const match = html.match(nameFirst) || html.match(contentFirst);
    return match ? decode(match[1]) : '';
  };

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return {
    title: meta('og:title') || meta('twitter:title') || (titleMatch ? decode(titleMatch[1].trim()) : ''),
    description: meta('og:description') || meta('twitter:description') || meta('description'),
    image: meta('og:image') || meta('twitter:image'),
    siteName: meta('og:site_name')
  };
};

const emptyPreview = (url) => ({ url, title: '', description: '', image: '', siteName: '' });

const resolveImage = (image, base) => {
  if (!image) return '';
  try {
    const resolved = new URL(image, base);
    return ['http:', 'https:'].includes(resolved.protocol) ? resolved.href : '';
  } catch (error) {
    return '';
  }
};

const fetchPreview = async (url) => {
  let current = validateUrl(url);

  try {
    for (let hop = 0; current && hop <= MAX_REDIRECTS; hop++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      let res;
      try {
        res = await fetch(current.href, {
          redirect: 'manual', // every redirect target is re-validated below
          agent: pickAgent,
          signal: controller.signal,
          size: MAX_BODY_BYTES,
          headers: { 'User-Agent': 'BeaconLinkPreview/1.0', Accept: 'text/html' }
        });

        const location = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && location) {
          current = validateUrl(new URL(location, current).href);
          continue;
        }

        const contentType = res.headers.get('content-type') || '';
        if (!res.ok || !contentType.includes('text/html')) return emptyPreview(url);

        const meta = parseMeta(await res.text());
        return {
          url,
          title: meta.title.slice(0, 200),
          description: meta.description.slice(0, 300),
          image: resolveImage(meta.image, current.href),
          siteName: meta.siteName.slice(0, 100)
        };
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (error) {
    // timeouts, blocked addresses, oversized bodies: fall through to an empty preview
  }
  return emptyPreview(url);
};

const buildLinkPreviews = async (content) => {
  const urls = extractUrls(content).filter(url => validateUrl(url));
  return Promise.all(urls.map(fetchPreview));
};

module.exports = { buildLinkPreviews, isPrivateIp, validateUrl };
