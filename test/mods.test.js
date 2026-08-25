const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('node:path');
const { stageMods } = require('../lib/mods');

const sha = (s) => crypto.createHash('sha256').update(Buffer.from(s)).digest('hex');

// In-memory fs standing in for the game install.
function fakeIo(files = {}) {
  const store = { ...files };
  const removed = [];
  const made = [];
  return {
    store,
    removed,
    made,
    existsSync: (p) => p in store,
    readFileSync: (p) => {
      if (!(p in store)) throw new Error('ENOENT ' + p);
      return Buffer.from(store[p]);
    },
    copyFileSync: (from, to) => { store[to] = store[from]; },
    mkdirSync: (p) => { made.push(p); },
    rmSync: (p) => { removed.push(p); },
  };
}

const SRC = '/app/mods';
const DST = '/game/mods';
const OPT = '/game/optional';
const j = (...p) => path.join(...p);

test('staging copies required mods whose hashes match', () => {
  const io = fakeIo({ [j(SRC, 'client.jar')]: 'CLIENT', [j(SRC, 'api.jar')]: 'API' });
  const res = stageMods({
    srcDir: SRC, dstDir: DST, io,
    hashes: { 'client.jar': sha('CLIENT'), 'api.jar': sha('API') },
  });
  assert.deepEqual(res.required.sort(), ['api.jar', 'client.jar']);
  assert.equal(io.store[j(DST, 'client.jar')], 'CLIENT');
  assert.equal(io.store[j(DST, 'api.jar')], 'API');
});

test('a tampered client mod aborts the launch', () => {
  const io = fakeIo({ [j(SRC, 'client.jar')]: 'TAMPERED' });
  assert.throws(
    () => stageMods({ srcDir: SRC, dstDir: DST, io, hashes: { 'client.jar': sha('CLIENT') } }),
    /integrity check failed for client\.jar/,
  );
  assert.equal(j(DST, 'client.jar') in io.store, false, 'nothing may be staged');
});

test('a missing client mod aborts the launch', () => {
  const io = fakeIo({});
  assert.throws(
    () => stageMods({ srcDir: SRC, dstDir: DST, io, hashes: { 'client.jar': sha('CLIENT') } }),
    /Missing client file: client\.jar/,
  );
});

test('verification happens before the destination is touched', () => {
  const io = fakeIo({ [j(SRC, 'client.jar')]: 'TAMPERED' });
  try {
    stageMods({ srcDir: SRC, dstDir: DST, io, hashes: { 'client.jar': sha('CLIENT') } });
  } catch {}
  assert.deepEqual(io.removed, [], 'must not wipe the existing mods dir on a failed check');
});

test('the destination is rebuilt so removed mods cannot linger', () => {
  const io = fakeIo({ [j(SRC, 'client.jar')]: 'CLIENT' });
  stageMods({ srcDir: SRC, dstDir: DST, io, hashes: { 'client.jar': sha('CLIENT') } });
  assert.deepEqual(io.removed, [DST]);
  assert.deepEqual(io.made, [DST]);
});

test('enabled optional mods are staged when their hash still matches', () => {
  const io = fakeIo({ [j(SRC, 'client.jar')]: 'CLIENT', [j(OPT, 'sodium.jar')]: 'SODIUM' });
  const res = stageMods({
    srcDir: SRC, dstDir: DST, optionalDir: OPT, io,
    hashes: { 'client.jar': sha('CLIENT') },
    optionalMods: [{ file: 'sodium.jar', sha256: sha('SODIUM'), enabled: true }],
  });
  assert.deepEqual(res.optional, ['sodium.jar']);
  assert.equal(io.store[j(DST, 'sodium.jar')], 'SODIUM');
});

test('optional mods are skipped when disabled, missing or altered', () => {
  const io = fakeIo({
    [j(SRC, 'client.jar')]: 'CLIENT',
    [j(OPT, 'off.jar')]: 'OFF',
    [j(OPT, 'changed.jar')]: 'DIFFERENT NOW',
  });
  const res = stageMods({
    srcDir: SRC, dstDir: DST, optionalDir: OPT, io,
    hashes: { 'client.jar': sha('CLIENT') },
    optionalMods: [
      { file: 'off.jar', sha256: sha('OFF'), enabled: false },
      { file: 'changed.jar', sha256: sha('ORIGINAL'), enabled: true },
      { file: 'gone.jar', sha256: sha('GONE'), enabled: true },
      null,
    ],
  });
  assert.deepEqual(res.optional, [], 'none should be staged');
  // Unlike required mods, a bad optional mod is skipped rather than fatal.
  assert.deepEqual(res.required, ['client.jar']);
});

// Java resolution moved to lib/java.js - see test/java.test.js.
