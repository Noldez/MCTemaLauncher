#!/usr/bin/env node
// Sign a release so launchers will install it.
//
//   node scripts/sign-release.js build/MCTemaLauncher-Setup-0.2.21.exe [...more files]
//
// Reads the private key from MCTEMA_SIGNING_KEY (a path to the PEM) and writes
// manifest-<version>.json next to the artifacts. That file goes to the VPS
// update feed alongside the installers; the launcher fetches it over the pinned
// client and refuses anything it does not vouch for.
//
// The key must never live on the server or in this repository - the whole
// point is that compromising either is not enough to ship code to players.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { version } = require("../package.json");
const files = process.argv.slice(2);

if (!files.length) {
  console.error("usage: node scripts/sign-release.js <installer> [more files...]");
  process.exit(1);
}

const keyPath = process.env.MCTEMA_SIGNING_KEY;
if (!keyPath || !fs.existsSync(keyPath)) {
  console.error("MCTEMA_SIGNING_KEY must point at the release private key PEM.");
  process.exit(1);
}

const manifest = { version, files: {} };
for (const f of files) {
  if (!fs.existsSync(f)) {
    console.error(`missing artifact: ${f}`);
    process.exit(1);
  }
  manifest.files[path.basename(f)] = crypto
    .createHash("sha512")
    .update(fs.readFileSync(f))
    .digest("hex");
}

// The signature covers these exact bytes, so the launcher verifies the body it
// received rather than a re-serialisation of it.
const body = JSON.stringify(manifest);
const signature = crypto
  .sign(null, Buffer.from(body, "utf8"), crypto.createPrivateKey(fs.readFileSync(keyPath)))
  .toString("base64");

const out = path.join(path.dirname(files[0]), `manifest-${version}.json`);
fs.writeFileSync(out, JSON.stringify({ body, signature }, null, 2));
console.log(`signed ${Object.keys(manifest.files).length} file(s) -> ${out}`);
