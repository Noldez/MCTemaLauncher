const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('node:path');
const { resolveJava, javaReport, jreZipIsAuthentic } = require('../lib/java');

const j = (...p) => path.join(...p);

// In-memory fs standing in for the install: files map to contents, directories
// to the names they hold.
function fakeIo(files = [], dirs = {}) {
  return {
    existsSync: (p) => files.includes(p),
    readdirSync: (p) => {
      if (!(p in dirs)) throw new Error('ENOENT ' + p);
      return dirs[p];
    },
  };
}

test('resolveJava points at the bundled runtime for packaged and dev layouts', () => {
  const packagedPath = j('/res', 'jre', 'bin', 'java.exe');
  const devPath = j('/app', 'assets', 'jre', 'bin', 'java');

  const packaged = resolveJava({
    packaged: true, resourcesPath: '/res', appDir: '/app', repairDir: '/game',
    platform: 'win32', io: fakeIo([packagedPath]),
  });
  assert.equal(packaged.path, packagedPath);
  assert.equal(packaged.source, 'bundled');

  const dev = resolveJava({
    packaged: false, resourcesPath: '/res', appDir: '/app', repairDir: '/game',
    platform: 'linux', io: fakeIo([devPath]),
  });
  assert.equal(dev.path, devPath);
  assert.equal(dev.source, 'bundled');
});

test('resolveJava falls back to a repaired runtime, never to system java', () => {
  const repaired = j('/game', 'jre', 'bin', 'java.exe');
  const found = resolveJava({
    packaged: true, resourcesPath: '/res', appDir: '/app', repairDir: '/game',
    platform: 'win32', io: fakeIo([repaired]),
  });
  assert.equal(found.path, repaired);
  assert.equal(found.source, 'repair');
});

test('resolveJava prefers the bundled runtime over a repaired one', () => {
  const bundled = j('/res', 'jre', 'bin', 'java.exe');
  const repaired = j('/game', 'jre', 'bin', 'java.exe');
  const found = resolveJava({
    packaged: true, resourcesPath: '/res', appDir: '/app', repairDir: '/game',
    platform: 'win32', io: fakeIo([bundled, repaired]),
  });
  assert.equal(found.path, bundled);
  assert.equal(found.source, 'bundled');
});

test('resolveJava reports nothing found when both runtimes are absent', () => {
  const found = resolveJava({
    packaged: true, resourcesPath: '/res', appDir: '/app', repairDir: '/game',
    platform: 'win32', io: fakeIo([]),
  });
  assert.equal(found.path, undefined);
  assert.equal(found.source, null);
});

test('javaReport names the runtime that will be used', () => {
  const bundled = j('/res', 'jre', 'bin', 'java.exe');
  const found = resolveJava({
    packaged: true, resourcesPath: '/res', appDir: '/app', repairDir: '/game',
    platform: 'win32', io: fakeIo([bundled]),
  });
  const lines = javaReport(found, fakeIo([bundled]));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes(bundled));
});

test('javaReport lists what is next to a missing runtime', () => {
  const io = fakeIo([], { [j('/res')]: ['app.asar', 'mods'], [j('/res', 'jre', 'bin')]: [] });
  const found = resolveJava({
    packaged: true, resourcesPath: '/res', appDir: '/app', repairDir: '/game',
    platform: 'win32', io,
  });
  const text = javaReport(found, io).join('\n');
  assert.ok(text.includes(j('/res', 'jre', 'bin', 'java.exe')), 'names the path it looked for');
  assert.ok(text.includes('app.asar'), 'lists the resources directory');
  assert.ok(text.includes('mods'));
});

test('javaReport survives directories it cannot read', () => {
  const found = resolveJava({
    packaged: true, resourcesPath: '/res', appDir: '/app', repairDir: '/game',
    platform: 'win32', io: fakeIo([]),
  });
  assert.doesNotThrow(() => javaReport(found, fakeIo([])));
});

// The repair download is gated on a hash pinned in the launcher, the same rule
// the update path uses: serving the feed is not enough to ship code.
const zip = (body) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(body)]);
const shaOf = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

test('jreZipIsAuthentic accepts the pinned archive', () => {
  const buf = zip('runtime');
  assert.equal(jreZipIsAuthentic(buf, shaOf(buf)), true);
});

test('jreZipIsAuthentic refuses a rewritten archive', () => {
  const buf = zip('rewritten');
  assert.equal(jreZipIsAuthentic(buf, shaOf(zip('runtime'))), false);
});

test('jreZipIsAuthentic refuses what is not a zip, empty or oversized', () => {
  const notZip = Buffer.from('<!doctype html>');
  assert.equal(jreZipIsAuthentic(notZip, shaOf(notZip)), false);
  assert.equal(jreZipIsAuthentic(Buffer.alloc(0), shaOf(Buffer.alloc(0))), false);
  const big = zip('x'.repeat(200));
  assert.equal(jreZipIsAuthentic(big, shaOf(big), 100), false);
});
