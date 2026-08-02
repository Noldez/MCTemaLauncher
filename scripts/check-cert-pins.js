#!/usr/bin/env node
// Checks that mctema.lt still presents a chain matching one of the pins baked
// into main.js. Cloudflare chooses our edge CA, so this is an early warning: if
// it starts failing, players cannot log in and the pin list needs updating.
//
// Also prints every pin in the live chain, so regenerating the list never means
// copying values off a CA's website (those are SPKI digests; this hashes Node's
// `pubkey`, which differs for ECDSA keys).
const tls = require("tls");
const crypto = require("crypto");

// Overridable so the failure path itself can be exercised against a host we
// deliberately do not pin.
const HOST = process.env.PIN_CHECK_HOST || "mctema.lt";

// Imported rather than parsed out of the source: the pins used to live in
// main.js, and when they moved this script silently stopped finding them.
const { CERT_PINS: known } = require("../lib/pinned-http");
if (!Array.isArray(known) || known.length === 0) {
  console.error("lib/pinned-http.js exports no CERT_PINS");
  process.exit(1);
}
console.log(`pinned keys: ${known.length}`);

const sock = tls.connect({ host: HOST, port: 443, servername: HOST, timeout: 20000 }, () => {
  let cert = sock.getPeerCertificate(true);
  const seen = new Set();
  let matched = null;
  console.log(`\nlive chain for ${HOST}:`);
  while (cert && cert.pubkey && !seen.has(cert.fingerprint256)) {
    seen.add(cert.fingerprint256);
    const pin = crypto.createHash("sha256").update(cert.pubkey).digest("base64");
    const cn = (cert.subject && cert.subject.CN) || "?";
    const hit = known.includes(pin);
    if (hit && !matched) matched = cn;
    console.log(`  ${hit ? "PINNED " : "       "} ${pin}  ${cn}  (expires ${cert.valid_to})`);
    if (!cert.issuerCertificate || cert.issuerCertificate === cert) break;
    cert = cert.issuerCertificate;
  }
  sock.end();
  if (matched) {
    console.log(`\nOK - chain matches pinned "${matched}"`);
    process.exit(0);
  }
  console.error(
    `\nFAIL - no certificate in ${HOST}'s chain matches a pin in main.js.\n` +
      "Players cannot reach the API in this state. Add the correct pin above to\n" +
      "CERT_PINS and ship a release before this reaches users.",
  );
  process.exit(1);
});

sock.on("error", (e) => {
  console.error(`could not reach ${HOST}: ${e.message}`);
  process.exit(2);
});
sock.on("timeout", () => {
  sock.destroy();
  console.error(`timed out connecting to ${HOST}`);
  process.exit(2);
});
