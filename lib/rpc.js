// Discord Rich Presence.
//
// Entirely best-effort: Discord may not be running, the user may have the
// integration disabled, or the IPC pipe may drop at any time. Nothing here may
// throw into the caller or block the launcher.
const { Client: RpcClient } = require("@xhayper/discord-rpc");

const RETRY_MS = 30000;

/**
 * @param {object} o
 * @param {string} o.clientId       Discord application id; empty disables presence.
 * @param {string} o.defaultState   Second presence line, normally the server host.
 * @param {string} [o.defaultDetails]
 * @param {Function} [o.now]        Clock override for tests.
 */
function createRichPresence({ clientId, defaultState, defaultDetails = "Paleidykloje", now = Date.now }) {
  let rpc = null;
  let ready = false;
  let details = defaultDetails;
  let stateText = defaultState;
  let start = now();
  let retryTimer = null;

  function activity() {
    return {
      details,
      state: stateText,
      // Asset name as uploaded to the Discord application, not a file path.
      largeImageKey: "mctemafull",
      largeImageText: "MC Tema",
      startTimestamp: start,
      buttons: [
        { label: "Žaisk MC Tema", url: "https://mctema.lt" },
        { label: "Discord", url: "https://discord.gg/mctema" },
      ],
      instance: false,
    };
  }

  function push() {
    if (rpc && ready && rpc.user) rpc.user.setActivity(activity()).catch(() => {});
  }

  /** Update what Discord shows; resetTimer restarts the "elapsed" counter. */
  function set(newDetails, newState, resetTimer) {
    details = newDetails;
    stateText = newState;
    if (resetTimer) start = now();
    push();
  }

  function destroy() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (!rpc) return;
    try {
      rpc.destroy();
    } catch {}
    rpc = null;
    ready = false;
  }

  /** Connect, retrying quietly - Discord may simply not be running yet. */
  function init() {
    if (rpc || !clientId) return;
    try {
      rpc = new RpcClient({ clientId });
      rpc.on("ready", () => {
        ready = true;
        push();
      });
      rpc.login().catch(() => {
        ready = false;
        rpc = null;
        retryTimer = setTimeout(init, RETRY_MS);
        if (retryTimer.unref) retryTimer.unref();
      });
    } catch {
      rpc = null;
    }
  }

  return { init, set, destroy, activity, isConnected: () => ready };
}

module.exports = { createRichPresence };
