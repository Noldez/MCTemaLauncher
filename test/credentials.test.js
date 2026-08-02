const test = require('node:test');
const assert = require('node:assert');
const { createCredentialStore, authErrText } = require('../lib/credentials');

// In-memory fs and a fake safeStorage, so the platform rules can be exercised
// without Electron and without touching the real keystore.
function fakeIo(initial = {}) {
  const files = { ...initial };
  return {
    files,
    existsSync: (p) => p in files,
    readFileSync: (p) => {
      if (!(p in files)) throw new Error('ENOENT');
      return files[p];
    },
    writeFileSync: (p, data) => { files[p] = data; },
    rmSync: (p) => { delete files[p]; },
    mkdirSync: () => {},
  };
}

// Reversible stand-in for real encryption; the point is the storage rules, not
// the cipher.
function fakeSafeStorage({ available = true, backend = 'gnome_libsecret' } = {}) {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (s) => Buffer.from('enc:' + s),
    decryptString: (b) => {
      const s = b.toString();
      if (!s.startsWith('enc:')) throw new Error('bad blob');
      return s.slice(4);
    },
  };
}

const AUTH_PATH = '/tmp/.mctema/auth.dat';

function store(opts = {}) {
  const io = opts.io || fakeIo();
  const safeStorage = opts.safeStorage || fakeSafeStorage();
  return {
    io,
    api: createCredentialStore({ safeStorage, authPath: AUTH_PATH, platform: opts.platform || 'win32', io }),
  };
}

test('credentials round-trip through the keystore', () => {
  const { api, io } = store();
  api.save({ username: 'Noldez', password: 'hunter2', token: 'tok', refreshToken: 'ref' });
  assert.ok(io.files[AUTH_PATH], 'blob written');
  assert.equal(io.files[AUTH_PATH].toString().startsWith('enc:'), true, 'stored encrypted');

  const loaded = api.load();
  assert.equal(loaded.username, 'Noldez');
  assert.equal(loaded.password, 'hunter2');
  assert.equal(loaded.token, 'tok');
  assert.equal(loaded.refreshToken, 'ref');
});

test('token fields default to null when not supplied', () => {
  const { api } = store();
  api.save({ username: 'Noldez', password: 'hunter2' });
  const loaded = api.load();
  assert.equal(loaded.token, null);
  assert.equal(loaded.refreshToken, null);
});

test('clear removes the stored credentials', () => {
  const { api } = store();
  api.save({ username: 'Noldez', password: 'hunter2', token: 'tok' });
  api.clear();
  assert.equal(api.load(), null);
});

test('load returns null when nothing is stored', () => {
  assert.equal(store().api.load(), null);
});

test('load returns null for a corrupt blob rather than throwing', () => {
  const io = fakeIo({ [AUTH_PATH]: Buffer.from('not-encrypted-garbage') });
  assert.equal(store({ io }).api.load(), null);
});

test('load rejects a payload missing a password', () => {
  const io = fakeIo({ [AUTH_PATH]: Buffer.from('enc:' + JSON.stringify({ username: 'Noldez' })) });
  assert.equal(store({ io }).api.load(), null);
});

// The guard shipped with Linux support: safeStorage reports "available" on Linux
// even when it has fallen back to a key hardcoded in Chromium.
test('Linux without a real keyring refuses to store the password', () => {
  const { api } = store({
    platform: 'linux',
    safeStorage: fakeSafeStorage({ backend: 'basic_text' }),
  });
  assert.equal(api.keystoreUsable(), false);
});

test('Linux with gnome-libsecret or kwallet is accepted', () => {
  for (const backend of ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']) {
    const { api } = store({ platform: 'linux', safeStorage: fakeSafeStorage({ backend }) });
    assert.equal(api.keystoreUsable(), true, backend);
  }
});

test('the basic_text rule does not apply off Linux', () => {
  for (const platform of ['win32', 'darwin']) {
    const { api } = store({ platform, safeStorage: fakeSafeStorage({ backend: 'basic_text' }) });
    assert.equal(api.keystoreUsable(), true, platform);
  }
});

test('an unavailable keystore is refused everywhere', () => {
  const { api } = store({ safeStorage: fakeSafeStorage({ available: false }) });
  assert.equal(api.keystoreUsable(), false);
});

test('load refuses to decrypt when the keystore is untrusted', () => {
  const io = fakeIo({ [AUTH_PATH]: Buffer.from('enc:' + JSON.stringify({ username: 'N', password: 'p' })) });
  const { api } = store({ io, platform: 'linux', safeStorage: fakeSafeStorage({ backend: 'basic_text' }) });
  assert.equal(api.load(), null, 'must not read a blob written under a hardcoded key');
});

test('authErrText maps server codes and falls back for unknown ones', () => {
  assert.match(authErrText({ json: { error: 'WRONG' } }), /Neteisingas/);
  assert.match(authErrText({ json: { error: 'RATE' } }), /Per daug/);
  assert.match(authErrText({ json: { error: 'AUTH_DOWN' } }), /neveikia/);
  assert.match(authErrText({ json: { error: 'BAD_INPUT' } }), /3-16/);
  assert.match(authErrText({ json: { error: 'SOMETHING_NEW' } }), /Kažkas nepavyko/);
  assert.match(authErrText(null), /Kažkas nepavyko/);
  assert.match(authErrText({}), /Kažkas nepavyko/);
});
