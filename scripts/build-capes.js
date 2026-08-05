"use strict";

// Turn a folder of cape art into the sheets the launcher ships.
//
//   npx electron scripts/build-capes.js "C:\\capes" "C:\\capes\\more capes"
//
// Folders are listed rather than walked: cape art tends to sit next to mod
// assets that happen to be 2:1 too, and those are not capes.
//
// Source capes come as animated GIFs as often as PNGs, and Node has no GIF
// decoder. Rather than take a dependency for a step that runs a handful of
// times, this runs inside Electron and borrows the renderer's ImageDecoder -
// the same one the launcher itself uses when a player imports their own cape.
//
// Output is assets/capes/<slug>.png (frames stacked downwards) plus capes.json.
// Originals stay out of the repo: the sheet is what actually ships.

const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const { planSheet, capeFps, capeFrames } = require("../lib/capes");

const SRCS = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const OUT = path.join(__dirname, "..", "assets", "capes");

// Art that is in the source folders but not wanted in the shipped set.
const SKIP = new Set(["cape.png"]);

const slug = (name) =>
  name
    .replace(/\.(gif|png)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

/** A readable name from the file name, since that is all the art carries. */
const title = (name) => name.replace(/\.(gif|png)$/i, "").trim().slice(0, 32);

// Both of these are stringified and evaluated in the hidden page, hence the
// browser globals.
/* global atob, document, ImageDecoder, createImageBitmap */

/**
 * Real dimensions and frame count, straight from the decoder.
 *
 * Worth the extra decode: counting a GIF's frames by scanning for its block
 * markers over-counts, because those same bytes turn up inside compressed
 * image data. That produced a plan for one more frame than existed and the
 * decode threw, which killed the whole run partway through.
 */
async function pageProbe(b64, isGif) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (!isGif) {
    const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    return { width: bmp.width, height: bmp.height, frames: 1 };
  }
  const dec = new ImageDecoder({ data: bytes, type: "image/gif" });
  await dec.completed;
  const { image } = await dec.decode({ frameIndex: 0 });
  return {
    width: image.displayWidth,
    height: image.displayHeight,
    frames: dec.tracks.selectedTrack.frameCount,
  };
}

// Decode every frame, stack them, hand back a PNG. `plan` is computed in Node
// so the sizing rule lives in exactly one place.
async function pageWork(b64, isGif, plan) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const cv = document.createElement("canvas");
  cv.width = plan.width;
  cv.height = plan.height;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  const frameH = plan.width / 2;

  // A cape sheet holds the cloak on the left and the elytra wing beside it at
  // u=22,v=0. Plenty of capes never draw that block, and the game silently
  // renders the elytra from the cape - so a blank block means an invisible
  // elytra. Recording it here lets the launcher say so before you pick one.
  const elytraPainted = () => {
    const s = plan.width / 64;
    const d = ctx.getImageData(
      Math.round(22 * s), 0,
      Math.round(24 * s), Math.min(frameH, Math.round(24 * s)),
    ).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return true;
    return false;
  };

  if (isGif) {
    const dec = new ImageDecoder({ data: bytes, type: "image/gif" });
    await dec.completed;
    let totalMs = 0;
    for (let i = 0; i < plan.frames; i += 1) {
      const { image } = await dec.decode({ frameIndex: i });
      totalMs += (image.duration || 100000) / 1000;
      ctx.drawImage(image, 0, i * frameH, plan.width, frameH);
      image.close();
    }
    return { png: cv.toDataURL("image/png"), avgMs: totalMs / plan.frames, elytra: elytraPainted() };
  }

  const blob = new Blob([bytes], { type: "image/png" });
  const bmp = await createImageBitmap(blob);
  ctx.drawImage(bmp, 0, 0, plan.width, plan.height);
  return { png: cv.toDataURL("image/png"), avgMs: 0, elytra: elytraPainted() };
}

// Electron on Windows is a GUI binary, so console output does not reliably
// reach the terminal it was started from. The log is a file as well.
const LOG = path.join(app.getPath("temp"), "mctema-cape-build.log");
const lines = [];
function say(line) {
  lines.push(line);
  console.log(line);
  try { fs.writeFileSync(LOG, `${lines.join("\n")}\n`); } catch { /* best effort */ }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  const blank = path.join(app.getPath("temp"), "mctema-cape-build.html");
  fs.writeFileSync(blank, "<!doctype html><meta charset=utf-8><title>capes</title>");
  await win.loadFile(blank);

  const files = SRCS.flatMap((dir) =>
    fs
      .readdirSync(dir)
      .filter((f) => /\.(gif|png)$/i.test(f))
      .filter((f) => !SKIP.has(f.toLowerCase()))
      .map((f) => ({ dir, file: f })),
  ).sort((a, b) => a.file.localeCompare(b.file));

  fs.mkdirSync(OUT, { recursive: true });
  if (!files.length) {
    say(`No cape art in ${SRCS.join(", ") || "(no folders given)"}`);
    app.exit(1);
    return;
  }

  const manifest = [];
  const taken = new Set();
  for (const { dir, file } of files) {
    // Two folders can hold the same name; the second must not overwrite it.
    const out = `${slug(file)}.png`;
    if (taken.has(out)) {
      say(`skip ${file}: ${out} already written from another folder`);
      continue;
    }
    const isGif = /\.gif$/i.test(file);
    const b64 = JSON.stringify(fs.readFileSync(path.join(dir, file)).toString("base64"));

    // One bad file gets skipped with a reason, rather than taking the run down
    // and leaving the manifest unwritten.
    let sheet;
    let plan;
    let avgMs;
    let elytra;
    try {
      const probe = await win.webContents.executeJavaScript(`(${pageProbe})(${b64}, ${isGif})`);
      if (probe.height * 2 !== probe.width) {
        say(`skip ${file}: ${probe.width}x${probe.height} is not a 2:1 cape sheet`);
        continue;
      }
      plan = planSheet(probe.width, probe.frames);
      if (probe.frames > plan.frames) {
        say(`note ${file}: ${probe.frames} frames trimmed to ${plan.frames}`);
      }
      const res = await win.webContents.executeJavaScript(
        `(${pageWork})(${b64}, ${isGif}, ${JSON.stringify(plan)})`,
      );
      sheet = Buffer.from(res.png.split(",")[1], "base64");
      avgMs = res.avgMs;
      elytra = !!res.elytra;
    } catch (e) {
      say(`skip ${file}: ${e && e.message ? e.message : e}`);
      continue;
    }
    // What we just wrote has to be a cape by the launcher's own rule, or the
    // manifest would promise something the launcher refuses to draw.
    const got = capeFrames(sheet.readUInt32BE(16), sheet.readUInt32BE(20));
    if (got !== plan.frames) {
      say(`skip ${file}: produced ${got} frames, expected ${plan.frames}`);
      continue;
    }
    fs.writeFileSync(path.join(OUT, out), sheet);
    taken.add(out);
    const fps = capeFps(plan.frames, avgMs > 0 ? Math.round(1000 / avgMs) : 0);
    manifest.push({ file: out, name: title(file), frames: plan.frames, fps, elytra });
    say(`${file} -> ${out} (${plan.width}x${plan.height}, ${plan.frames}f @ ${fps}fps${elytra ? ", elytra" : ""})`);
  }

  fs.writeFileSync(path.join(OUT, "capes.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\n${manifest.length} capes -> ${path.relative(process.cwd(), OUT)}`);
  app.exit(0);
});
