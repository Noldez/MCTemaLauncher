// Auto-update wiring.
//
// The feed is a generic provider on mctema.lt (see package.json build.publish),
// not GitHub, so shipping a release means uploading artifacts there as well as
// tagging. Notably this path is NOT certificate-pinned: electron-updater does
// its own TLS, which is what would make a pin mistake recoverable.
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Start checking for updates and forward progress to the renderer.
 *
 * @param {object} o
 * @param {object} o.autoUpdater  electron-updater instance.
 * @param {boolean} o.enabled     Skip entirely when unpackaged (dev runs).
 * @param {Function} o.send       Deliver a state object to the renderer.
 * @returns {Function} stop - clears the interval; used by tests.
 */
function initUpdater({ autoUpdater, enabled, send }) {
  if (!enabled) return () => {};
  let timer = null;
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    // Update failures are never surfaced: the launcher still works on the
    // installed version, and a modal about it would only alarm players.
    autoUpdater.on("error", () => {});
    autoUpdater.on("update-available", (i) => send({ state: "available", version: i && i.version }));
    autoUpdater.on("download-progress", (p) =>
      send({ state: "downloading", percent: Math.round((p && p.percent) || 0) }),
    );
    autoUpdater.on("update-downloaded", (i) => send({ state: "ready", version: i && i.version }));
    autoUpdater.checkForUpdates().catch(() => {});
    timer = setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), CHECK_INTERVAL_MS);
  } catch {}
  return () => {
    if (timer) clearInterval(timer);
  };
}

module.exports = { initUpdater, CHECK_INTERVAL_MS };
