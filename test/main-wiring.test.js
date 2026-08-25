const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// main.js cannot be imported outside Electron, so its use of the lib modules is
// checked statically instead. This exists because a real bug shipped: main.js
// called `configStore.load(...)` while lib/config.js exports `loadConfig`.
// Destructuring a missing export yields undefined and only throws when called,
// so nothing failed until that code path ran at runtime.
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

// Vendored upstream; not ours to hold to this contract.
const SKIP = new Set(['./lib/mclc']);

/** Every `require('./lib/x')` in main.js, with how it was bound. */
function libRequires(src) {
  const out = [];
  // const { a, b: c } = require('./lib/x')  - possibly spanning lines
  const destructured = /const\s*\{([^}]*)\}\s*=\s*require\('(\.\/lib\/[\w-]+)'\)/gs;
  for (const m of src.matchAll(destructured)) {
    const names = m[1]
      .split(',')
      .map((s) => s.trim().split(':')[0].trim())
      .filter(Boolean);
    out.push({ module: m[2], kind: 'named', names });
  }
  // const x = require('./lib/y')
  const namespaced = /const\s+(\w+)\s*=\s*require\('(\.\/lib\/[\w-]+)'\)/g;
  for (const m of src.matchAll(namespaced)) {
    out.push({ module: m[2], kind: 'namespace', local: m[1] });
  }
  return out.filter((r) => !SKIP.has(r.module));
}

// The repair download is only as good as the hash it is checked against, and a
// placeholder would turn the check into a permanent "neatitiko parašo".
test('main.js pins a real sha256 for the Java repair archive', () => {
  const m = /JRE_REPAIR = \{[^}]*sha256:\s*'([^']*)'/s.exec(MAIN);
  assert.ok(m, 'expected a JRE_REPAIR constant with a sha256');
  assert.match(m[1], /^[a-f0-9]{64}$/);
});

test('main.js only destructures names its lib modules export', () => {
  const requires = libRequires(MAIN).filter((r) => r.kind === 'named');
  assert.ok(requires.length > 0, 'expected to find destructured lib requires');

  for (const req of requires) {
    const mod = require(path.join(__dirname, '..', req.module));
    for (const name of req.names) {
      assert.ok(
        name in mod,
        `main.js destructures { ${name} } from ${req.module}, which does not export it`,
      );
    }
  }
});

test('main.js only calls members its namespaced lib modules export', () => {
  const requires = libRequires(MAIN).filter((r) => r.kind === 'namespace');
  assert.ok(requires.length > 0, 'expected to find a namespaced lib require');

  for (const req of requires) {
    const mod = require(path.join(__dirname, '..', req.module));
    const used = new Set(
      [...MAIN.matchAll(new RegExp(`\\b${req.local}\\.(\\w+)`, 'g'))].map((m) => m[1]),
    );
    for (const member of used) {
      assert.ok(
        member in mod,
        `main.js calls ${req.local}.${member}(), but ${req.module} does not export "${member}"`,
      );
    }
  }
});

// The preload runs with sandbox: true, where `require` resolves only electron
// and a handful of built-ins. Requiring anything from lib/ throws before
// contextBridge runs, so window.api never appears and the whole UI is dead -
// no version, no login, no error anyone can see. This shipped once.
const PRELOAD = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

test('preload.js requires nothing a sandboxed preload cannot resolve', () => {
  const allowed = new Set(['electron']);
  const found = [...PRELOAD.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.ok(found.length > 0, 'expected preload.js to require electron');
  for (const mod of found) {
    assert.ok(
      allowed.has(mod),
      `preload.js requires "${mod}"; a sandboxed preload can only resolve ${[...allowed].join(', ')}. `
        + 'Move the work to main.js and reach it over IPC.',
    );
  }
});

test('every api method the preload exposes is a function', () => {
  // A bare value here means a typo turned a call into a property read.
  const body = PRELOAD.slice(PRELOAD.indexOf('exposeInMainWorld'));
  const bad = [...body.matchAll(/^\s{2}(\w+):\s*([^(\s].*)$/gm)]
    .filter((m) => !m[2].startsWith('('))
    .map((m) => m[1]);
  assert.deepEqual(bad, [], `these api entries are not functions: ${bad.join(', ')}`);
});

// config:set is the one channel that writes the config file, and the config
// also holds things main owns - the skin and cape libraries, installed
// optional mods, the signed-in nick - some of which become file paths later.
// It must be an allowlist, or a scripting bug in the UI turns into a way to
// point those paths anywhere.
test('config:set writes only the settings the UI owns', () => {
  const block = MAIN.slice(MAIN.indexOf('const CONFIG_SETTERS'), MAIN.indexOf("ipcMain.handle('config:openFolder'"));
  assert.ok(block.includes('const CONFIG_SETTERS'), 'expected a CONFIG_SETTERS allowlist');

  const allowed = [...block.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(
    allowed.sort(),
    ['closeOnPlay', 'discordRpc', 'friendPrefs', 'jvmArgs', 'ram', 'resolution', 'toasts'],
    'the set of writable settings changed - is the new one safe for the renderer to control?',
  );
  for (const owned of ['skins', 'capes', 'currentSkin', 'currentCape', 'optionalMods', 'username', 'friends']) {
    assert.ok(!allowed.includes(owned), `${owned} is main's to write, not the renderer's`);
  }
  // A spread of the incoming patch would put every key back regardless.
  assert.ok(!/\.\.\.\(patch \|\| \{\}\)/.test(block), 'config:set must not spread the raw patch');
});
