const test = require('node:test');
const assert = require('node:assert');
const { DEFAULTS, defaultRam, loadConfig, saveConfig } = require('../lib/config');

const CONFIG_PATH = '/tmp/.mctema/launcher.json';
const GB = 1024 ** 3;
// Pin system memory in loadConfig tests: the real os.totalmem would make the
// expected ram default depend on the machine running the suite.
const SMALL_RAM = () => 8 * GB;

function fakeIo(initial = {}) {
  const files = { ...initial };
  const dirs = [];
  return {
    files,
    dirs,
    readFileSync: (p) => {
      if (!(p in files)) throw new Error('ENOENT');
      return files[p];
    },
    writeFileSync: (p, data) => { files[p] = data; },
    mkdirSync: (p) => { dirs.push(p); },
  };
}

test('a missing config yields defaults', () => {
  const cfg = loadConfig(CONFIG_PATH, fakeIo(), SMALL_RAM);
  assert.deepEqual(cfg, DEFAULTS);
});

test('unreadable or corrupt JSON yields defaults rather than throwing', () => {
  for (const body of ['{ not json', '', 'null']) {
    const cfg = loadConfig(CONFIG_PATH, fakeIo({ [CONFIG_PATH]: body }), SMALL_RAM);
    assert.equal(cfg.ram, DEFAULTS.ram, `body: ${JSON.stringify(body)}`);
  }
});

test('defaultRam tiers by total system memory', () => {
  assert.equal(defaultRam(32 * GB), 8);
  assert.equal(defaultRam(16 * GB), 8);
  assert.equal(defaultRam(15.9 * GB), 6);
  assert.equal(defaultRam(12 * GB), 6);
  assert.equal(defaultRam(11.9 * GB), 4);
  assert.equal(defaultRam(8 * GB), 4);
  assert.equal(defaultRam(4 * GB), 4);
});

test('first run picks the RAM default from system memory', () => {
  assert.equal(loadConfig(CONFIG_PATH, fakeIo(), () => 32 * GB).ram, 8);
  assert.equal(loadConfig(CONFIG_PATH, fakeIo(), () => 12 * GB).ram, 6);
  assert.equal(loadConfig(CONFIG_PATH, fakeIo(), SMALL_RAM).ram, 4);
});

test('a stored ram value is never overridden by system memory', () => {
  const io = fakeIo({ [CONFIG_PATH]: JSON.stringify({ ram: 2 }) });
  assert.equal(loadConfig(CONFIG_PATH, io, () => 32 * GB).ram, 2);
});

test('stored values override defaults, absent keys keep them', () => {
  const io = fakeIo({ [CONFIG_PATH]: JSON.stringify({ username: 'Noldez', ram: 8 }) });
  const cfg = loadConfig(CONFIG_PATH, io);
  assert.equal(cfg.username, 'Noldez');
  assert.equal(cfg.ram, 8);
  assert.equal(cfg.closeOnPlay, false, 'default preserved');
  assert.deepEqual(cfg.resolution, DEFAULTS.resolution, 'nested default preserved');
});

test('defaults are not shared between calls', () => {
  const a = loadConfig(CONFIG_PATH, fakeIo());
  a.skins.push('mutated');
  const b = loadConfig(CONFIG_PATH, fakeIo());
  assert.deepEqual(b.skins, [], 'a later read must not see the earlier mutation');
});

test('save writes readable JSON and creates the directory', () => {
  const io = fakeIo();
  saveConfig(CONFIG_PATH, { ...DEFAULTS, username: 'ZooH_' }, io);
  assert.equal(io.dirs.length, 1, 'parent directory created');
  assert.equal(JSON.parse(io.files[CONFIG_PATH]).username, 'ZooH_');
  assert.equal(loadConfig(CONFIG_PATH, io).username, 'ZooH_', 'round trip');
});

test('a failing write does not throw', () => {
  const io = fakeIo();
  io.writeFileSync = () => { throw new Error('EACCES'); };
  assert.doesNotThrow(() => saveConfig(CONFIG_PATH, DEFAULTS, io));
});
