const test = require('node:test');
const assert = require('node:assert');
const { DEFAULTS, loadConfig, saveConfig } = require('../lib/config');

const CONFIG_PATH = '/tmp/.mctema/launcher.json';

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
  const cfg = loadConfig(CONFIG_PATH, fakeIo());
  assert.deepEqual(cfg, DEFAULTS);
});

test('unreadable or corrupt JSON yields defaults rather than throwing', () => {
  for (const body of ['{ not json', '', 'null']) {
    const cfg = loadConfig(CONFIG_PATH, fakeIo({ [CONFIG_PATH]: body }));
    assert.equal(cfg.ram, DEFAULTS.ram, `body: ${JSON.stringify(body)}`);
  }
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
