const test = require('node:test');
const assert = require('node:assert');
const { generateKeyPairSync, sign } = require('node:crypto');
const { verifyManifest, manifestAllows, RELEASE_PUBLIC_KEY } = require('../lib/release-verify');

const keys = generateKeyPairSync('ed25519');
const PUB = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const signWith = (body, key = keys.privateKey) => sign(null, Buffer.from(body, 'utf8'), key).toString('base64');

const manifest = () => JSON.stringify({
  version: '0.2.21',
  files: { 'MCTemaLauncher-Setup-0.2.21.exe': 'a'.repeat(128) },
});

test('a manifest signed by the release key verifies', () => {
  const body = manifest();
  assert.deepEqual(verifyManifest(body, signWith(body), PUB), JSON.parse(body));
});

test('a tampered manifest is rejected', () => {
  const body = manifest();
  const sig = signWith(body);
  const tampered = body.replace('0.2.21', '9.9.9');
  assert.equal(verifyManifest(tampered, sig, PUB), null);
});

test('a manifest signed by another key is rejected', () => {
  const attacker = generateKeyPairSync('ed25519');
  const body = manifest();
  assert.equal(verifyManifest(body, signWith(body, attacker.privateKey), PUB), null);
});

test('missing, malformed and non-JSON inputs are rejected, never thrown', () => {
  const body = manifest();
  assert.equal(verifyManifest(body, '', PUB), null);
  assert.equal(verifyManifest(body, 'not base64 !!', PUB), null);
  assert.equal(verifyManifest('{ not json', signWith('{ not json'), PUB), null);
  assert.equal(verifyManifest(null, null, PUB), null);
  assert.equal(verifyManifest(body, signWith(body), 'not a key'), null);
});

test('manifestAllows matches the version and its file hash case-insensitively', () => {
  const m = JSON.parse(manifest());
  assert.ok(manifestAllows(m, '0.2.21', 'A'.repeat(128)));
  assert.ok(manifestAllows(m, '0.2.21', 'a'.repeat(128)));
});

test('manifestAllows refuses a different version or an unlisted hash', () => {
  const m = JSON.parse(manifest());
  assert.equal(manifestAllows(m, '0.2.22', 'a'.repeat(128)), false);
  assert.equal(manifestAllows(m, '0.2.21', 'b'.repeat(128)), false);
  assert.equal(manifestAllows(m, '0.2.21', ''), false);
  assert.equal(manifestAllows(null, '0.2.21', 'a'.repeat(128)), false);
  assert.equal(manifestAllows({ version: '0.2.21' }, '0.2.21', 'a'.repeat(128)), false);
});

test('the shipped public key is a usable ed25519 SPKI key', () => {
  assert.match(RELEASE_PUBLIC_KEY, /^-----BEGIN PUBLIC KEY-----/);
  // Signing with a foreign key must not verify against the shipped one - proves
  // the constant is a real key and the check is wired to it.
  const body = manifest();
  assert.equal(verifyManifest(body, signWith(body), RELEASE_PUBLIC_KEY), null);
});
