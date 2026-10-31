const test = require('node:test');
const assert = require('node:assert');

const { isPrivateIp, validateUrl } = require('../utils/linkPreview');
const { matchesDeclaredType } = require('../utils/fileSignature');
const { isId, parsePaging, escapeRegex, cleanMediaUrl } = require('../utils/http');
const { sanitizeServerSettings, sanitizeAttachments, isHexColor } = require('../utils/sanitize');

test('isPrivateIp blocks internal ranges and allows public ones', () => {
  ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1',
    '::ffff:7f00:1', 'not-an-ip'].forEach(ip => assert.strictEqual(isPrivateIp(ip), true, ip));

  ['8.8.8.8', '1.1.1.1', '172.217.0.1', '172.32.0.1', '2606:4700:4700::1111']
    .forEach(ip => assert.strictEqual(isPrivateIp(ip), false, ip));
});

test('validateUrl rejects unsafe link-preview targets', () => {
  ['http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://2130706433/',
    'http://169.254.169.254/latest/meta-data', 'ftp://example.com/', 'http://user:pass@example.com/',
    'http://example.com:8080/', 'http://printer.local/', 'javascript:alert(1)']
    .forEach(url => assert.strictEqual(validateUrl(url), null, url));

  assert.ok(validateUrl('https://example.com/page'));
  assert.ok(validateUrl('http://example.com:80/page'));
});

test('matchesDeclaredType checks real file bytes', () => {
  const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0]);
  const pdf = Buffer.from('%PDF-1.7 ...');
  const html = Buffer.from('<html><script>alert(1)</script></html>');

  assert.strictEqual(matchesDeclaredType(png, 'image/png'), true);
  assert.strictEqual(matchesDeclaredType(pdf, 'application/pdf'), true);
  assert.strictEqual(matchesDeclaredType(html, 'image/png'), false);
  assert.strictEqual(matchesDeclaredType(html, 'text/plain'), true);
  assert.strictEqual(matchesDeclaredType(Buffer.from('<svg/>'), 'image/svg+xml'), false);
  assert.strictEqual(matchesDeclaredType(Buffer.from([0x00, 0x01]), 'text/plain'), false);
});

test('isId only accepts 24-char hex ids', () => {
  assert.strictEqual(isId('507f1f77bcf86cd799439011'), true);
  assert.strictEqual(isId('starred'), false);
  assert.strictEqual(isId('aaaaaaaaaaaa'), false); // 12 chars: mongoose alone would accept this
  assert.strictEqual(isId({ $ne: null }), false);
});

test('parsePaging caps limits', () => {
  assert.deepStrictEqual(parsePaging({ limit: '1000000', page: '2' }), { page: 2, limit: 100, skip: 100 });
  assert.deepStrictEqual(parsePaging({ limit: '-5', page: 'abc' }), { page: 1, limit: 1, skip: 0 });
  assert.deepStrictEqual(parsePaging({}), { page: 1, limit: 50, skip: 0 });
});

test('escapeRegex neutralises regex syntax', () => {
  assert.strictEqual(new RegExp(escapeRegex('(a+)+$')).test('(a+)+$'), true);
});

test('cleanMediaUrl allows https or empty only', () => {
  assert.strictEqual(cleanMediaUrl('https://res.cloudinary.com/x/a.png'), 'https://res.cloudinary.com/x/a.png');
  assert.strictEqual(cleanMediaUrl(''), '');
  assert.strictEqual(cleanMediaUrl('http://example.com/a.png'), null);
  assert.strictEqual(cleanMediaUrl('javascript:alert(1)'), null);
  assert.strictEqual(cleanMediaUrl({ url: 'x' }), null);
});

test('sanitizeServerSettings drops unknown and malformed keys', () => {
  const out = sanitizeServerSettings({
    isPublic: false, spamFilter: 'yes', owner: 'evil', filteredWords: ['bad', 42, '  '], defaultChannel: 'x'
  });
  assert.deepStrictEqual(out, { isPublic: false, filteredWords: ['bad'] });
});

test('sanitizeAttachments only keeps our own Cloudinary URLs', () => {
  process.env.CLOUDINARY_CLOUD_NAME = 'demo';
  const out = sanitizeAttachments([
    { url: 'https://res.cloudinary.com/demo/image/upload/a.png', name: 'a.png', size: 10, extra: 'x' },
    { url: 'https://res.cloudinary.com/other/image/upload/b.png' },
    { url: 'https://evil.example/tracker.gif' },
    'not-an-object'
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].name, 'a.png');
  assert.strictEqual(out[0].extra, undefined);
});

test('isHexColor', () => {
  assert.strictEqual(isHexColor('#8b5cf6'), true);
  assert.strictEqual(isHexColor('red;background:url(x)'), false);
});
