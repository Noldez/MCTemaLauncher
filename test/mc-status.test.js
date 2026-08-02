const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { mcStatus, parseStatusResponse, packet, mcString } = require('../lib/mc-status');

/** Encode a status reply the way a real server would. */
function statusReply(json) {
  return packet(0x00, mcString(JSON.stringify(json)));
}

test('parseStatusResponse reads counts and sample names', () => {
  const res = parseStatusResponse(
    statusReply({ players: { online: 7, max: 60, sample: [{ name: 'Noldez' }, { name: 'ZooH_' }] } }),
  );
  assert.equal(res.online, true);
  assert.deepEqual(res.players, { online: 7, max: 60 });
  assert.deepEqual(res.sample, ['Noldez', 'ZooH_']);
});

test('parseStatusResponse waits for the rest of a split packet', () => {
  const full = statusReply({ players: { online: 1, max: 2, sample: [] } });
  assert.equal(parseStatusResponse(full.slice(0, 3)), null, 'partial yields null');
  assert.ok(parseStatusResponse(full), 'complete yields a result');
});

test('parseStatusResponse discards sample entries that are not valid nicks', () => {
  const res = parseStatusResponse(
    statusReply({
      players: {
        online: 1,
        max: 2,
        // A real server can return anything here, including markup or colour codes.
        sample: [{ name: '<script>alert(1)</script>' }, { name: 'ok_Nick' }, { name: '' }, { name: 'a'.repeat(40) }, {}, null],
      },
    }),
  );
  assert.deepEqual(res.sample, ['ok_Nick']);
});

test('parseStatusResponse treats malformed JSON as offline instead of throwing', () => {
  const res = parseStatusResponse(packet(0x00, mcString('{ not json')));
  assert.equal(res.online, false);
  assert.deepEqual(res.players, { online: 0, max: 0 });
});

test('missing player counts default to zero', () => {
  const res = parseStatusResponse(statusReply({ description: 'no players key' }));
  assert.equal(res.online, true);
  assert.deepEqual(res.players, { online: 0, max: 0 });
  assert.deepEqual(res.sample, []);
});

test('mcStatus reports a real reply from a server', async () => {
  const sockets = [];
  const server = net.createServer((sock) => {
    sockets.push(sock);
    // Ignore the handshake, answer as a server would.
    sock.once('data', () => sock.write(statusReply({ players: { online: 3, max: 40, sample: [{ name: 'Aistelo' }] } })));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  const res = await mcStatus('127.0.0.1', port, 4000);
  for (const s of sockets) s.destroy();
  await new Promise((r) => server.close(r));

  assert.equal(res.online, true);
  assert.deepEqual(res.players, { online: 3, max: 40 });
  assert.deepEqual(res.sample, ['Aistelo']);
});

test('mcStatus reports offline when nothing is listening', async () => {
  // Bind then immediately release, so the port is almost certainly free.
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const { port } = probe.address();
  await new Promise((r) => probe.close(r));

  const res = await mcStatus('127.0.0.1', port, 2000);
  assert.equal(res.online, false);
  assert.deepEqual(res.players, { online: 0, max: 0 });
});

test('mcStatus gives up on a server that never answers', async () => {
  // Accepts the connection and stays silent. The sockets are tracked so they
  // can be destroyed explicitly: server.close() waits for open connections, and
  // would otherwise hang this test forever.
  const sockets = [];
  const server = net.createServer((s) => sockets.push(s));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  const started = Date.now();
  const res = await mcStatus('127.0.0.1', port, 300);
  const elapsed = Date.now() - started;

  for (const s of sockets) s.destroy();
  await new Promise((r) => server.close(r));

  assert.equal(res.online, false);
  assert.ok(elapsed < 3000, `should time out promptly, took ${elapsed}ms`);
});
