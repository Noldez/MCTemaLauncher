const test = require('node:test');
const assert = require('node:assert');
const { absolutizeImage, mapPosts } = require('../lib/news');

test('uploads paths point at the backend uploads mount', () => {
  assert.equal(
    absolutizeImage('/uploads/content/a.webp'),
    'https://mctema.lt/api/uploads/content/a.webp',
  );
});

test('site-relative paths are prefixed with the site origin', () => {
  assert.equal(absolutizeImage('/assets/hero.webp'), 'https://mctema.lt/assets/hero.webp');
});

test('absolute mctema.lt URLs pass through', () => {
  assert.equal(absolutizeImage('https://mctema.lt/x.png'), 'https://mctema.lt/x.png');
});

test('foreign hosts and non-https are rejected', () => {
  assert.equal(absolutizeImage('https://evil.example/x.png'), null);
  assert.equal(absolutizeImage('http://mctema.lt/x.png'), null);
  assert.equal(absolutizeImage('javascript:alert(1)'), null);
  assert.equal(absolutizeImage(null), null);
});

test('quotes cannot reach a CSS url() literal', () => {
  const out = absolutizeImage('/a"b.png');
  assert.ok(out === null || !out.includes('"'));
});

test('mapPosts keeps the top posts and builds site links', () => {
  const posts = Array.from({ length: 6 }, (_, i) => ({
    id: i + 1,
    title: `Postas ${i + 1}`,
    createdAt: '2026-08-01T10:00:00.000Z',
  }));
  const out = mapPosts(posts);
  assert.equal(out.length, 4);
  assert.equal(out[0].url, 'https://mctema.lt/naujienos/1');
  assert.equal(out[0].dateIso, '2026-08-01T10:00:00.000Z');
});

test('mapPosts survives garbage payloads', () => {
  assert.deepEqual(mapPosts({ nope: true }), []);
  assert.deepEqual(mapPosts([{ id: 1 }]), []);
  assert.deepEqual(mapPosts([{ id: 'x', title: 'a' }]), []);
});
