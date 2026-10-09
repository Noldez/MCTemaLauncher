const test = require('node:test');
const assert = require('node:assert');
const { podiumOf, unlockCapes, placesOf } = require('../lib/podium-capes');

const catalogue = () => [
  { id: 'podium-1.png', name: 'Konkurso nugalėtojas', podium: 1 },
  { id: 'podium-2.png', name: 'Konkurso II vieta', podium: 2 },
  { id: 'podium-3.png', name: 'Konkurso III vieta', podium: 3 },
  { id: 'duck-cape.png', name: 'Duck Cape', podium: 0 },
];

const podium = { winners: [{ place: 1, nick: 'Noldez' }, { place: 2, nick: 'sendisz' }, { place: 3, nick: 'ZooH_' }] };

test('only places 1 to 3 make a podium cape', () => {
  assert.equal(podiumOf({ podium: 1 }), 1);
  assert.equal(podiumOf({ podium: 3 }), 3);
  assert.equal(podiumOf({ podium: 4 }), 0);
  assert.equal(podiumOf({ podium: '2' }), 2);
  assert.equal(podiumOf({}), 0);
  assert.equal(podiumOf(null), 0);
});

test('placesOf keys the podium by lower-cased nick', () => {
  assert.deepEqual(placesOf(podium), { noldez: 1, sendisz: 2, zooh_: 3 });
  assert.deepEqual(placesOf(null), {});
  assert.deepEqual(placesOf({ winners: [{ place: 9, nick: 'x' }, { place: 1 }] }), {});
});

test('a stranger sees the podium capes locked and the rest open', () => {
  const r = unlockCapes(catalogue(), { nick: 'Tadas', placeOf: placesOf(podium), earned: {} });
  assert.deepEqual(r.capes.map((c) => c.locked), [true, true, true, false]);
  assert.deepEqual(r.newlyEarned, []);
  assert.deepEqual(r.earned, {});
});

test('signed out, nothing on the podium opens', () => {
  const r = unlockCapes(catalogue(), { nick: '', placeOf: placesOf(podium), earned: { '': ['podium-1.png'] } });
  assert.deepEqual(r.capes.map((c) => c.locked), [true, true, true, false]);
  assert.deepEqual(r.newlyEarned, []);
});

test('the place holder gets exactly their cape, case-insensitively, and it is remembered', () => {
  const r = unlockCapes(catalogue(), { nick: 'SENDISZ', placeOf: placesOf(podium), earned: {} });
  assert.deepEqual(r.capes.map((c) => c.locked), [true, false, true, false]);
  assert.deepEqual(r.newlyEarned, ['podium-2.png']);
  assert.deepEqual(r.earned, { sendisz: ['podium-2.png'] });
});

test('an earned cape stays open after the podium moves on', () => {
  const earned = { noldez: ['podium-1.png'] };
  const later = { winners: [{ place: 1, nick: 'Kitas' }] };
  const r = unlockCapes(catalogue(), { nick: 'Noldez', placeOf: placesOf(later), earned });
  assert.equal(r.capes[0].locked, false);
  assert.deepEqual(r.newlyEarned, [], 'nothing new: it was already earned');
  assert.deepEqual(r.earned, earned);
});

test('a second win adds to the memory rather than replacing it', () => {
  const r = unlockCapes(catalogue(), { nick: 'Noldez', placeOf: { noldez: 3 }, earned: { noldez: ['podium-1.png'] } });
  assert.deepEqual(r.capes.map((c) => c.locked), [false, true, false, false]);
  assert.deepEqual(r.newlyEarned, ['podium-3.png']);
  assert.deepEqual(r.earned.noldez.sort(), ['podium-1.png', 'podium-3.png']);
});

test('offline, with no podium, memory still opens what was earned', () => {
  const r = unlockCapes(catalogue(), { nick: 'ZooH_', placeOf: {}, earned: { zooh_: ['podium-3.png'] } });
  assert.deepEqual(r.capes.map((c) => c.locked), [true, true, false, false]);
});

test('other nicks in the memory are left alone', () => {
  const earned = { sendisz: ['podium-2.png'] };
  const r = unlockCapes(catalogue(), { nick: 'Noldez', placeOf: placesOf(podium), earned });
  assert.deepEqual(r.earned, { sendisz: ['podium-2.png'], noldez: ['podium-1.png'] });
  assert.deepEqual(earned, { sendisz: ['podium-2.png'] }, 'input is not mutated');
});
