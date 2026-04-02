const dns = require('dns').promises;
const fetch = (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));

const URL_REGEX = /(https?:\/\/[^\s]+)/gi;

const isPrivateIp = (ip) => {
  return (
    ip.startsWith('10.') ||
    ip.startsWith('127.') ||
    ip.startsWith('169.254.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('172.16.') ||
    ip.startsWith('172.17.') ||
    ip.startsWith('172.18.') ||
    ip.startsWith('172.19.') ||
    ip.startsWith('172.2') ||
    ip.startsWith('172.3') ||
    ip === '::1'
  );
};

const safeUrl = async (url) => {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return false;
    const lookup = await dns.lookup(parsed.hostname);
    if (lookup?.address && isPrivateIp(lookup.address)) return false;
    return true;
  } catch (error) {
    return false;
  }
};

const extractUrls = (content) => {
  if (!content) return [];
  const urls = content.match(URL_REGEX) || [];
  return [...new Set(urls)].slice(0, 3);
};

const parseMeta = (html) => {
  const meta = (name) => {
    const regex = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i');
    const match = html.match(regex);
    return match ? match[1] : '';
  };

  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const title = meta('og:title') || meta('twitter:title') || (titleMatch ? titleMatch[1] : '');
  const description = meta('og:description') || meta('twitter:description') || meta('description');
  const image = meta('og:image') || meta('twitter:image');
  const siteName = meta('og:site_name');

  return { title, description, image, siteName };
};

const fetchPreview = async (url) => {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return { url, title: '', description: '', image: '', siteName: '' };
    }
    const html = await res.text();
    const meta = parseMeta(html);
    return { url, ...meta };
  } catch (error) {
    return { url, title: '', description: '', image: '', siteName: '' };
  }
};

const buildLinkPreviews = async (content) => {
  const urls = extractUrls(content);
  const previews = [];
  for (const url of urls) {
    if (await safeUrl(url)) {
      previews.push(await fetchPreview(url));
    }
  }
  return previews;
};

module.exports = { buildLinkPreviews };
