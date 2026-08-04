// Auto-update wiring.
//
// The feed is a generic provider on mctema.lt (see package.json build.publish),
// not GitHub, so shipping a release means uploading artifacts there as well as
// tagging. electron-updater does its own TLS with the system trust store, so
// this path is not certificate-pinned - which is what keeps a pin mistake
// recoverable. The trust that matters instead comes from the signed release
// manifest (lib/release-verify.js): the downloaded file is hashed locally and
// installed only if a manifest signed with our offline key vouches for exactly
// that hash. Serving the feed is therefore not enough to ship code to players.
const crypto = require("crypto");
const fs = require("fs");
const { verifyManifest, manifestAllows } = require("./release-verify");

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

/** SHA512 of a file on disk, or null if it cannot be read. */
function sha512File(file, io = fs) {
  try {
    return crypto.createHash("sha512").update(io.readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Decide whether a downloaded update may be installed.
 *
 * Split out from the event wiring so the rule is testable without an updater:
 * the manifest must carry our signature, name this exact version, and list the
 * hash of the file actually on disk.
 *
 * @param {object} o
 * @param {string} o.version
 * @param {string} o.file            Path to the downloaded installer.
 * @param {string} o.manifestBody    Raw signed manifest JSON.
 * @param {string} o.signatureB64
 * @param {any} [o.io]
 */
function updateIsAuthentic({ version, file, manifestBody, signatureB64, io = fs }) {
  const manifest = verifyManifest(manifestBody, signatureB64);
  if (!manifest) return false;
  const digest = sha512File(file, io);
  if (!digest) return false;
  return manifestAllows(manifest, version, digest);
}

/**
 * Start checking for updates and forward progress to the renderer.
 *
 * @param {object} o
 * @param {any} o.autoUpdater      electron-updater instance.
 * @param {boolean} o.enabled      Skip entirely when unpackaged (dev runs).
 * @param {Function} o.send        Deliver a state object to the renderer.
 * @param {Function} o.fetchSigned Fetch the signed manifest for a version:
 *   (version) => Promise<{body: string, signature: string} | null>.
 * @param {any} [o.io]
 * @returns {Function} stop - clears the interval; used by tests.
 */
function initUpdater({ autoUpdater, enabled, send, fetchSigned, io = fs }) {
  if (!enabled) return () => {};
  let timer = null;
  try {
    autoUpdater.autoDownload = true;
    // Installing is gated on the signature check below, so nothing may be
    // installed behind our back when the app quits.
    autoUpdater.autoInstallOnAppQuit = false;
    // Update failures are never surfaced: the launcher still works on the
    // installed version, and a modal about it would only alarm players.
    autoUpdater.on("error", () => {});
    autoUpdater.on("update-available", (i) => send({ state: "available", version: i && i.version }));
    autoUpdater.on("download-progress", (p) =>
      send({ state: "downloading", percent: Math.round((p && p.percent) || 0) }),
    );
    autoUpdater.on("update-downloaded", async (i) => {
      const version = String((i && i.version) || "");
      const file = i && i.downloadedFile;
      let signed;
      try {
        signed = fetchSigned ? await fetchSigned(version) : null;
      } catch {
        signed = null;
      }
      const ok =
        !!file &&
        !!signed &&
        updateIsAuthentic({
          version,
          file,
          manifestBody: signed.body,
          signatureB64: signed.signature,
          io,
        });
      if (!ok) {
        // Refuse it and remove the file: an unverifiable update is either a
        // release we did not sign or one someone rewrote in transit.
        try {
          if (file) io.rmSync(file, { force: true });
        } catch {}
        send({ state: "rejected", version });
        return;
      }
      autoUpdater.autoInstallOnAppQuit = true;
      send({ state: "ready", version });
    });
    autoUpdater.checkForUpdates().catch(() => {});
    timer = setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), CHECK_INTERVAL_MS);
  } catch {}
  return () => {
    if (timer) clearInterval(timer);
  };
}

module.exports = { initUpdater, updateIsAuthentic, sha512File, CHECK_INTERVAL_MS };
