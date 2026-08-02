const test = require('node:test');
const assert = require('node:assert');
const tls = require('node:tls');
const {
  pinOf,
  chainMatchesPin,
  buildMultipart,
  postJson,
} = require('../lib/pinned-http');

// Minimal stand-ins for Node's getPeerCertificate(true) shape: a linked list of
// certs via issuerCertificate, terminated by a self-reference.
function cert(name, issuer) {
  const c = {
    pubkey: Buffer.from(`key-of-${name}`),
    fingerprint256: `fp-${name}`,
    subject: { CN: name },
  };
  c.issuerCertificate = issuer ?? c;
  return c;
}

test('chainMatchesPin accepts a pin anywhere in the chain', () => {
  const root = cert('root');
  const intermediate = cert('intermediate', root);
  const leaf = cert('leaf', intermediate);

  assert.equal(chainMatchesPin(leaf, [pinOf(leaf)]), true, 'leaf');
  assert.equal(chainMatchesPin(leaf, [pinOf(intermediate)]), true, 'intermediate');
  assert.equal(chainMatchesPin(leaf, [pinOf(root)]), true, 'root');
});

test('chainMatchesPin rejects a chain signed by an unpinned CA', () => {
  const rogueRoot = cert('rogue-root');
  const rogueLeaf = cert('rogue-leaf', rogueRoot);
  const legitimate = cert('legit');

  assert.equal(chainMatchesPin(rogueLeaf, [pinOf(legitimate)]), false);
});

test('chainMatchesPin terminates on a self-signed root and on a cycle', () => {
  const selfSigned = cert('self');
  assert.equal(chainMatchesPin(selfSigned, ['nope']), false);

  // Hostile chain that loops back on itself must not hang.
  const a = cert('a');
  const b = cert('b', a);
  a.issuerCertificate = b;
  assert.equal(chainMatchesPin(b, ['nope']), false);
});

test('chainMatchesPin tolerates a malformed chain', () => {
  assert.equal(chainMatchesPin(null, ['x']), false);
  assert.equal(chainMatchesPin({}, ['x']), false);
  assert.equal(chainMatchesPin({ pubkey: undefined, fingerprint256: 'f' }, ['x']), false);
});

test('buildMultipart encodes fields, filename and payload', () => {
  const { body, contentType } = buildMultipart(
    { to: 'ZooH_' },
    { name: 'shot.png', type: 'image/png', buf: Buffer.from([1, 2, 3]) },
  );
  const boundary = contentType.match(/boundary=(.+)$/)[1];
  const text = body.toString('latin1');

  assert.ok(contentType.startsWith('multipart/form-data; '));
  assert.ok(text.includes('name="to"'), 'field name');
  assert.ok(text.includes('ZooH_'), 'field value');
  assert.ok(text.includes('filename="shot.png"'), 'filename');
  assert.ok(text.includes('Content-Type: image/png'), 'file content type');
  assert.ok(text.endsWith(`--${boundary}--\r\n`), 'terminating boundary');
  assert.ok(body.includes(Buffer.from([1, 2, 3])), 'raw bytes preserved');
});

test('buildMultipart strips quotes that would break the filename header', () => {
  const { body } = buildMultipart({}, { name: 'a"b".png', type: 'image/png', buf: Buffer.alloc(0) });
  assert.ok(body.toString().includes('filename="ab.png"'));
});

// The property that matters most: a server presenting an unpinned certificate
// must never receive the request body. Node buffers the body before the TLS
// handshake completes, so this guards against it being flushed to a rogue peer
// before the pin check tears the socket down.
//
// Node can parse X.509 but not issue it, so the rogue certificate comes from
// openssl. Always present on the CI runner; skipped rather than failed when a
// developer's machine lacks it.
test('an unpinned server never receives the credentials', async (t) => {
  const rogue = selfSignedCert();
  if (!rogue) return t.skip('openssl unavailable');

  let received = '';
  const server = tls.createServer({ key: rogue.key, cert: rogue.cert }, (sock) => {
    sock.on('data', (c) => { received += c.toString('utf8'); });
    sock.on('error', () => {});
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  // The rogue cert is handed to the client as a trust anchor, so ordinary TLS
  // validation succeeds and ONLY the pin check can reject the connection. Without
  // this, rejectUnauthorized would reject it first and the test would pass even
  // with pinning disabled.
  const result = await postJson(
    '/api/launcher/login',
    { username: 'Noldez', password: 'SUPER_SECRET_PASSWORD' },
    { host: '127.0.0.1', port, pins: ['this-pin-will-never-match'], ca: rogue.cert },
  );

  await new Promise((r) => server.close(r));

  assert.ok(
    result.error === 'PIN' || result.error === 'NETWORK',
    `connection must be refused, got ${JSON.stringify(result)}`,
  );
  assert.equal(
    received.includes('SUPER_SECRET_PASSWORD'),
    false,
    'password reached a server whose certificate was not pinned',
  );
});

function selfSignedCert() {
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-test-'));
  const keyPath = path.join(dir, 'k.pem');
  const certPath = path.join(dir, 'c.pem');
  try {
    execFileSync(
      'openssl',
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
        '-days', '2', '-subj', '/CN=localhost',
        // Needed so hostname verification passes when the client dials by IP.
        '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'],
      { stdio: 'ignore' },
    );
  } catch {
    return null;
  }
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}
