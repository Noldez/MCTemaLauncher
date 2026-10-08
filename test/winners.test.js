const test = require('node:test');
const assert = require('node:assert');
const { posterUrl, mapWinners } = require('../lib/winners');

const payload = () => ({
  contest: { id: 2, slug: 'rezidenciju-konkursas', title: 'Rezidencijų konkursas', closesAt: '2026-10-07T23:59:59.000Z' },
  winners: [
    { id: 13, title: 'klubasikas', uploaderName: 'ZooH_', votes: 5, winnerRank: 3, thumbUrl: 'https://klipai.mctema.lt/thumb/13.jpg' },
    { id: 11, title: 'oromiestas', uploaderName: 'Noldez', votes: 12, winnerRank: 1, thumbUrl: 'https://klipai.mctema.lt/thumb/11.jpg' },
    { id: 12, title: 'rapunzel', uploaderName: 'sendisz', votes: 9, winnerRank: 2, thumbUrl: null },
  ],
});

test('posters are accepted from the site and the clips domain only', () => {
  assert.equal(posterUrl('https://klipai.mctema.lt/thumb/1.jpg'), 'https://klipai.mctema.lt/thumb/1.jpg');
  assert.equal(posterUrl('/assets/x.jpg'), 'https://mctema.lt/assets/x.jpg');
  assert.equal(posterUrl('https://evil.example/x.jpg'), null);
  assert.equal(posterUrl('http://klipai.mctema.lt/x.jpg'), null);
  assert.equal(posterUrl('javascript:alert(1)'), null);
  assert.equal(posterUrl(null), null);
});

test('a dev origin is only accepted when passed in', () => {
  assert.equal(posterUrl('http://localhost:3101/api/uploads/t.jpg'), null);
  assert.equal(
    posterUrl('http://localhost:3101/api/uploads/t.jpg', ['http://localhost:3101']),
    'http://localhost:3101/api/uploads/t.jpg',
  );
});

test('quotes cannot reach a CSS url() literal', () => {
  const out = posterUrl('https://klipai.mctema.lt/a"b.jpg');
  assert.ok(out === null || !out.includes('"'));
});

test('mapWinners orders the podium by place and links the contest page', () => {
  const out = mapWinners(payload());
  assert.equal(out.title, 'Rezidencijų konkursas');
  assert.equal(out.url, 'https://mctema.lt/konkursai/rezidenciju-konkursas');
  assert.deepEqual(
    out.winners.map((w) => [w.place, w.title, w.nick, w.votes]),
    [
      [1, 'oromiestas', 'Noldez', 12],
      [2, 'rapunzel', 'sendisz', 9],
      [3, 'klubasikas', 'ZooH_', 5],
    ],
  );
  assert.equal(out.winners[0].thumbUrl, 'https://klipai.mctema.lt/thumb/11.jpg');
  assert.equal(out.winners[1].thumbUrl, null);
});

test('mapWinners drops entries that are not a podium place or not a real nick', () => {
  const p = payload();
  p.winners.push({ id: 14, title: 'kaimas', uploaderName: 'Tadas', votes: 2, winnerRank: null });
  p.winners.push({ id: 15, title: 'ketvirtas', uploaderName: 'Kitas', votes: 1, winnerRank: 4 });
  p.winners.push({ id: 16, title: 'blogas', uploaderName: 'no spaces here', votes: 1, winnerRank: 1 });
  const out = mapWinners(p);
  assert.equal(out.winners.length, 3);
  assert.ok(out.winners.every((w) => w.place >= 1 && w.place <= 3));
});

test('mapWinners is null when there is nothing to show', () => {
  assert.equal(mapWinners({ contest: null, winners: [] }), null);
  assert.equal(mapWinners({ nope: true }), null);
  assert.equal(mapWinners({ contest: { slug: '../x' }, winners: [] }), null);
  const p = payload();
  p.winners = [];
  assert.equal(mapWinners(p), null);
});
