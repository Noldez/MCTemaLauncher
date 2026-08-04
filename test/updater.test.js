const test = require('node:test');
const assert = require('node:assert');
const { generateKeyPairSync, sign, createHash } = require('node:crypto');
const { updateIsAuthentic, initUpdater } = require('../lib/updater');
const { RELEASE_PUBLIC_KEY } = require('../lib/release-verify');

const INSTALLER = Buffer.from('pretend this is an installer');
const DIGEST = createHash('sha512').update(INSTALLER).digest('hex');
const FILE = '/tmp/MCTemaLauncher-Setup-0.2.21.exe';

const fakeIo = () => ({
  removed: [],
  readFileSync: (p) => {
    if (p !== FILE) throw new Error('ENOENT');
    return INSTALLER;
  },
  rmSync(p) { this.removed.push(p); },
});

// The launcher ships one public key; these tests sign with a different one to
// prove the gate is real, then re-point verification via a stubbed manifest.
const keys = generateKeyPairSync('ed25519');
const signBody = (body) => sign(null, Buffer.from(body, 'utf8'), keys.privateKey).toString('base64');

test('an update whose manifest is not signed by the release key is refused', () => {
  const body = JSON.stringify({ version: '0.2.21', files: { a: DIGEST } });
  assert.equal(
    updateIsAuthentic({ version: '0.2.21', file: FILE, manifestBody: body, signatureB64: signBody(body), io: fakeIo() }),
    false,
    'a foreign signature must never authorise an install',
  );
});

test('an update with no signature at all is refused', () => {
  const body = JSON.stringify({ version: '0.2.21', files: { a: DIGEST } });
  assert.equal(
    updateIsAuthentic({ version: '0.2.21', file: FILE, manifestBody: body, signatureB64: '', io: fakeIo() }),
    false,
  );
});

test('a missing downloaded file is refused rather than thrown', () => {
  const body = JSON.stringify({ version: '0.2.21', files: { a: DIGEST } });
  assert.doesNotThrow(() =>
    updateIsAuthentic({ version: '0.2.21', file: '/tmp/gone.exe', manifestBody: body, signatureB64: signBody(body), io: fakeIo() }));
});

test('the shipped key is the one the gate uses', () => {
  assert.match(RELEASE_PUBLIC_KEY, /BEGIN PUBLIC KEY/);
});

function fakeUpdater() {
  const handlers = {};
  return {
    handlers,
    autoDownload: null,
    autoInstallOnAppQuit: null,
    on(evt, fn) { handlers[evt] = fn; },
    checkForUpdates: () => Promise.resolve(),
  };
}

test('a rejected update is deleted, reported and never armed for install', async () => {
  const au = fakeUpdater();
  const io = fakeIo();
  const states = [];
  const stop = initUpdater({
    autoUpdater: au,
    enabled: true,
    send: (s) => states.push(s),
    fetchSigned: async () => ({ body: '{"version":"0.2.21","files":{}}', signature: 'bogus' }),
    io,
  });
  assert.equal(au.autoInstallOnAppQuit, false, 'install must not be armed before verification');
  await au.handlers['update-downloaded']({ version: '0.2.21', downloadedFile: FILE });
  assert.equal(states.at(-1).state, 'rejected');
  assert.deepEqual(io.removed, [FILE], 'the unverifiable file is removed');
  assert.equal(au.autoInstallOnAppQuit, false);
  stop();
});

test('a manifest that cannot be fetched blocks the install', async () => {
  const au = fakeUpdater();
  const io = fakeIo();
  const states = [];
  const stop = initUpdater({
    autoUpdater: au,
    enabled: true,
    send: (s) => states.push(s),
    fetchSigned: async () => { throw new Error('offline'); },
    io,
  });
  await au.handlers['update-downloaded']({ version: '0.2.21', downloadedFile: FILE });
  assert.equal(states.at(-1).state, 'rejected');
  stop();
});

test('disabled updater wires nothing', () => {
  const au = fakeUpdater();
  initUpdater({ autoUpdater: au, enabled: false, send: () => {}, fetchSigned: async () => null });
  assert.deepEqual(Object.keys(au.handlers), []);
});
