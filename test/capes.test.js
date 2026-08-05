"use strict";

const test = require("node:test");
const assert = require("node:assert");
const {
  capeFrames, capeFps, planSheet,
  DEFAULT_FPS, MAX_FPS, MAX_FRAMES, MAX_SHEET_PIXELS,
} = require("../lib/capes");

test("a plain cape sheet is one frame", () => {
  assert.equal(capeFrames(64, 32), 1);
  assert.equal(capeFrames(128, 64), 1);
  assert.equal(capeFrames(256, 128), 1);
  assert.equal(capeFrames(512, 256), 1);
});

test("stacked frames are counted", () => {
  assert.equal(capeFrames(64, 32 * 8), 8);
  assert.equal(capeFrames(128, 64 * 4), 4);
  assert.equal(capeFrames(64, 32 * MAX_FRAMES), MAX_FRAMES);
});

test("a sheet that is not whole frames is not a cape", () => {
  // 40 is not a multiple of 32, so this is some other image.
  assert.equal(capeFrames(64, 40), 0);
  assert.equal(capeFrames(64, 0), 0);
  assert.equal(capeFrames(64, 33), 0);
});

test("odd widths and skin-shaped images are refused", () => {
  assert.equal(capeFrames(64, 64), 2, "64x64 is two cape frames, not a skin");
  assert.equal(capeFrames(100, 50), 0);
  assert.equal(capeFrames(32, 16), 0);
  assert.equal(capeFrames(1024, 512), 0);
});

test("a sheet longer than the cap is refused rather than truncated", () => {
  assert.equal(capeFrames(64, 32 * (MAX_FRAMES + 1)), 0);
});

test("nonsense dimensions never pass", () => {
  assert.equal(capeFrames(NaN, 32), 0);
  assert.equal(capeFrames(64.5, 32), 0);
  assert.equal(capeFrames(-64, -32), 0);
});

test("a still cape keeps the biggest size it came in at", () => {
  assert.deepEqual(planSheet(512, 1), { width: 512, height: 256, frames: 1 });
  assert.deepEqual(planSheet(128, 1), { width: 128, height: 64, frames: 1 });
});

test("an oversized source is brought down to a cape size, never up", () => {
  // The real files are 1024 and 2048 wide; 512 is the widest we store.
  assert.equal(planSheet(2048, 1).width, 512);
  assert.equal(planSheet(1024, 1).width, 512);
  // A small cape stays small rather than being blown up.
  assert.equal(planSheet(64, 1).width, 64);
  assert.equal(planSheet(64, 30).width, 64);
});

test("a long animation drops the width so the sheet stays in budget", () => {
  for (const frames of [1, 4, 16, 30, 64]) {
    const p = planSheet(2048, frames);
    assert.ok(p.width * p.height <= MAX_SHEET_PIXELS,
      `${frames} frames produced ${p.width}x${p.height}`);
    assert.equal(p.height, (p.width / 2) * frames);
  }
});

test("frames past the cap are dropped rather than stored", () => {
  assert.equal(planSheet(256, 500).frames, MAX_FRAMES);
  assert.equal(planSheet(256, 0).frames, 1);
});

test("what planSheet produces is always a cape capeFrames accepts", () => {
  for (const src of [64, 128, 256, 512, 1024, 2048]) {
    for (const frames of [1, 3, 12, 40, 64]) {
      const p = planSheet(src, frames);
      assert.equal(capeFrames(p.width, p.height), p.frames,
        `${src}px x${frames} -> ${p.width}x${p.height}`);
    }
  }
});

test("a single frame has no playback rate", () => {
  assert.equal(capeFps(1, 12), 0);
  assert.equal(capeFps(0, 12), 0);
});

test("playback rate is clamped, and nonsense falls back to the default", () => {
  assert.equal(capeFps(8, 12), 12);
  assert.equal(capeFps(8, 999), MAX_FPS);
  assert.equal(capeFps(8, 0), DEFAULT_FPS);
  assert.equal(capeFps(8, -5), DEFAULT_FPS);
  assert.equal(capeFps(8, undefined), DEFAULT_FPS);
  assert.equal(capeFps(8, "abc"), DEFAULT_FPS);
});
