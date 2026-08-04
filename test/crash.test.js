const test = require('node:test');
const assert = require('node:assert');
const { createLogBuffer, suspectCause } = require('../lib/crash');

test('buffer keeps pushed lines in order', () => {
  const buf = createLogBuffer();
  buf.push('first');
  buf.push('second');
  assert.equal(buf.text(), 'first\nsecond');
});

test('buffer evicts oldest lines past the byte cap', () => {
  const buf = createLogBuffer(50);
  buf.push('a'.repeat(30));
  buf.push('b'.repeat(30));
  const t = buf.text();
  assert.ok(!t.includes('a'), 'oldest line evicted');
  assert.ok(t.includes('b'), 'newest line kept');
});

test('a single line larger than the cap keeps its tail', () => {
  const buf = createLogBuffer(100);
  buf.push('x'.repeat(90) + 'TAIL');
  const t = buf.text();
  assert.ok(t.length <= 100);
  assert.ok(t.endsWith('TAIL'), 'the end of the line is the interesting part');
});

test('reset empties the buffer', () => {
  const buf = createLogBuffer();
  buf.push('senas');
  buf.reset();
  assert.equal(buf.text(), '');
  buf.push('naujas');
  assert.equal(buf.text(), 'naujas');
});

test('suspectCause blames a mod jar seen near the end of the log', () => {
  const log = [
    'normal startup line',
    'Exception in server tick loop',
    '\tat me.jellysquid.mods.lithium.something(Lithium.java:42)',
    '\tat knot//mixin from lithium-fabric-mc1.21.3-0.12.2.jar',
  ].join('\n');
  assert.equal(suspectCause(log), 'lithium-fabric-mc1.21.3-0.12.2.jar');
});

test('suspectCause ignores loader and vanilla jars', () => {
  const log = [
    'loading fabric-loader-0.16.9.jar',
    'loading minecraft-1.21.11-client.jar',
    'Caused by: java.lang.IllegalStateException: broken block entity',
  ].join('\n');
  assert.equal(suspectCause(log), 'Caused by: java.lang.IllegalStateException: broken block entity');
});

test('suspectCause falls back to the last exception-looking line', () => {
  const log = 'ok\njava.lang.OutOfMemoryError: Java heap space\nok';
  assert.equal(suspectCause(log), 'java.lang.OutOfMemoryError: Java heap space');
});

test('suspectCause returns null for a clean log', () => {
  assert.equal(suspectCause('viskas gerai\nzaidimas uzdarytas'), null);
  assert.equal(suspectCause(''), null);
  assert.equal(suspectCause(null), null);
});

test('suspectCause output is capped at 200 chars', () => {
  const cause = suspectCause('Caused by: ' + 'x'.repeat(500));
  assert.ok(cause.length <= 200);
});
