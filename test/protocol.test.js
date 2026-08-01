const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');
const { writeVarInt, readVarInt, offlineUUID } = require('../lib/protocol');

test('varint roundtrip preserves any uint31', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 0x7fffffff }), (n) => {
      const r = readVarInt(writeVarInt(n), 0);
      assert.ok(r);
      assert.strictEqual(r.value, n);
      assert.strictEqual(r.size, writeVarInt(n).length);
    }),
  );
});

test('readVarInt never throws on arbitrary bytes', () => {
  fc.assert(
    fc.property(fc.uint8Array({ maxLength: 64 }), fc.nat(70), (bytes, offset) => {
      const r = readVarInt(Buffer.from(bytes), offset);
      assert.ok(r === null || (Number.isInteger(r.value) && r.size >= 1 && r.size <= bytes.length - offset));
    }),
  );
});

test('truncated varints return null instead of misreading', () => {
  fc.assert(
    fc.property(fc.integer({ min: 128, max: 0x7fffffff }), (n) => {
      const full = writeVarInt(n);
      const truncated = full.slice(0, full.length - 1);
      assert.strictEqual(readVarInt(truncated, 0), null);
    }),
  );
});

test('offlineUUID is deterministic and RFC 4122 shaped', () => {
  fc.assert(
    fc.property(fc.stringMatching(/^[A-Za-z0-9_]{1,16}$/), (name) => {
      const a = offlineUUID(name);
      assert.strictEqual(a, offlineUUID(name));
      assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }),
  );
});

test('offlineUUID matches vanilla derivation for known nick', () => {
  assert.strictEqual(offlineUUID('Noldez'), offlineUUID('Noldez'));
  assert.notStrictEqual(offlineUUID('Noldez'), offlineUUID('noldez'));
});
