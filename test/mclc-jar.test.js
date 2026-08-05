"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// A player reported the game dying inside Fabric with "zip END header not
// found" on every launch. The cause was upstream MCLC downloading the version
// jar only when the file was absent: a download cut short by a dropped
// connection or antivirus left a partial jar that nothing ever looked at
// again, and reinstalling the launcher could not help because the broken file
// lives in the game directory. These check the fix stays in place - the real
// code path needs a full Minecraft install to exercise.
const HANDLER = fs.readFileSync(path.join(__dirname, "..", "lib", "mclc", "handler.js"), "utf8");
const LAUNCHER = fs.readFileSync(path.join(__dirname, "..", "lib", "mclc", "launcher.js"), "utf8");

test("the version jar is verified, not merely assumed to be present", () => {
  assert.ok(
    /await this\.handler\.ensureJar\(mcPath\)/.test(LAUNCHER),
    "launcher.js must go through ensureJar",
  );
  assert.ok(
    !/if \(!fs\.existsSync\(mcPath\)\)\s*\{\s*[^}]*getJar\(\)/s.test(LAUNCHER),
    "existence alone must never decide whether the jar is downloaded",
  );
});

test("a jar that fails its hash is replaced rather than run", () => {
  const fn = HANDLER.slice(HANDLER.indexOf("async ensureJar"), HANDLER.indexOf("async getJar"));
  assert.ok(fn.includes("checkSum"), "ensureJar must check the published hash");
  assert.ok(fn.includes("rmSync"), "a damaged jar must be removed before re-downloading");
  assert.ok(fn.includes("this.getJar()"), "ensureJar must be able to fetch a fresh copy");
});

test("libraries keep verifying what is already on disk", () => {
  // The same bug class: this one was already right, and must stay right.
  const idx = HANDLER.indexOf("if (!fs.existsSync(path.join(jarPath, name))) await downloadLibrary(library)");
  assert.ok(idx > 0, "library download still guarded by existence");
  const after = HANDLER.slice(idx, idx + 1200);
  assert.ok(
    after.includes("checkSum") && after.includes("Library failed checksum verification"),
    "a library present on disk must still be checked against its hash",
  );
});
