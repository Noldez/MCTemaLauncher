"use strict";

// Cape sheets.
//
// A Minecraft cape texture is 2:1 - 64x32 for the classic size, and HD packs
// use whole multiples of it. Vanilla has no notion of an animated cape, so the
// format here is ours: the frames are stacked downwards in one PNG, which keeps
// a cape a single file that any image editor can produce.

const CAPE_WIDTHS = [64, 128, 256, 512];
const MAX_FRAMES = 64;
const DEFAULT_FPS = 10;
const MAX_FPS = 24;

// A stacked sheet is one image, so a long animation at HD width gets huge fast:
// 2048-wide frames x 30 would be a 63-megapixel canvas. Cape art is upscaled
// pixel art, so dropping the width costs far less than it looks like it should.
const MAX_SHEET_PIXELS = 4 * 1024 * 1024;

/**
 * The widest cape size whose whole sheet still fits the budget.
 *
 * @param {number} srcWidth width of the source image
 * @param {number} frames how many frames it has
 * @returns {{width: number, height: number, frames: number}}
 */
function planSheet(srcWidth, frames) {
  const n = Math.min(Math.max(1, Math.floor(frames) || 1), MAX_FRAMES);
  const fits = CAPE_WIDTHS.filter((w) => w * (w / 2) * n <= MAX_SHEET_PIXELS);
  const cap = fits.length ? Math.max(...fits) : CAPE_WIDTHS[0];
  // Never upscale: a 64-wide cape stays 64 wide.
  const width = Math.min(cap, CAPE_WIDTHS.filter((w) => w <= Math.max(64, srcWidth)).pop() || 64);
  return { width, height: (width / 2) * n, frames: n };
}

/**
 * How many frames a sheet of this size holds, or 0 if it is not a cape.
 *
 * @param {number} w
 * @param {number} h
 * @returns {number}
 */
function capeFrames(w, h) {
  if (!Number.isInteger(w) || !Number.isInteger(h)) return 0;
  if (!CAPE_WIDTHS.includes(w)) return 0;
  const frameH = w / 2;
  if (h <= 0 || h % frameH !== 0) return 0;
  const frames = h / frameH;
  return frames <= MAX_FRAMES ? frames : 0;
}

/**
 * Playback rate for a sheet. A single-frame cape does not animate, so it has
 * no rate at all rather than a rate nothing uses.
 *
 * @param {number} frames
 * @param {unknown} wanted
 * @returns {number}
 */
function capeFps(frames, wanted) {
  if (frames <= 1) return 0;
  const n = Math.round(Number(wanted));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_FPS;
  return Math.min(MAX_FPS, n);
}

module.exports = {
  capeFrames, capeFps, planSheet,
  CAPE_WIDTHS, MAX_FRAMES, MAX_FPS, DEFAULT_FPS, MAX_SHEET_PIXELS,
};
