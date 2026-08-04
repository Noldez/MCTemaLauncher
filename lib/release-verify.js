// Release signing: proof that an update came from us, not merely from the
// server the update feed happens to live on.
//
// The installers are not code-signed yet, so electron-updater's only integrity
// check is a SHA512 that travels over the same connection as the file it
// describes - whoever can serve the feed can rewrite both. This adds a second,
// independent gate: every release is described by a manifest signed offline
// with an Ed25519 key that exists nowhere on the server, and the launcher
// refuses to install anything the manifest does not vouch for. Compromising
// mctema.lt is then no longer enough to ship code to players.
const crypto = require("crypto");

// Public half of the release key. The private half never leaves the release
// machine - if it ever leaks, ship a new one in a normal (still verifiable)
// update, then rotate.
const RELEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAxXmOIS9Qt9+jU2I/bZZZh1LaoVN1/qE28as62ZMx16A=
-----END PUBLIC KEY-----
`;

/**
 * Parsed manifest when the signature is genuinely ours, null otherwise.
 * Resolves rather than throws: a bad signature is an ordinary outcome here,
 * and it must lead to "do not install", never to a crash.
 *
 * @param {unknown} body        Raw manifest JSON, verified byte for byte.
 * @param {unknown} signatureB64
 * @param {string} [publicKeyPem]
 */
function verifyManifest(body, signatureB64, publicKeyPem = RELEASE_PUBLIC_KEY) {
  if (typeof body !== "string" || typeof signatureB64 !== "string" || !signatureB64) return null;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(signatureB64)) return null;
  try {
    const key = crypto.createPublicKey(publicKeyPem);
    const ok = crypto.verify(
      null,
      Buffer.from(body, "utf8"),
      key,
      Buffer.from(signatureB64, "base64"),
    );
    return ok ? JSON.parse(body) : null;
  } catch {
    return null;
  }
}

/**
 * True when the signed manifest describes exactly this version and lists this
 * file hash. Both must match: a valid signature for an older release must not
 * authorise a different binary.
 *
 * @param {any} manifest
 * @param {unknown} version
 * @param {unknown} sha512Hex
 */
function manifestAllows(manifest, version, sha512Hex) {
  if (!manifest || typeof manifest !== "object") return false;
  if (!manifest.files || typeof manifest.files !== "object") return false;
  if (String(manifest.version) !== String(version)) return false;
  const want = String(sha512Hex || "").toLowerCase();
  if (!/^[a-f0-9]{128}$/.test(want)) return false;
  return Object.values(manifest.files).some((h) => String(h).toLowerCase() === want);
}

module.exports = { verifyManifest, manifestAllows, RELEASE_PUBLIC_KEY };
