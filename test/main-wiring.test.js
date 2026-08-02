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
