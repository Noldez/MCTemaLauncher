// Launcher-styled notification popups.
//
// These are frameless BrowserWindows rather than OS notifications on purpose:
// they match the launcher's look, and they still appear when Windows toasts are
// disabled system-wide (which they were on the author's machine, and which cost
// several rounds of debugging to discover).
const path = require("path");

const TOAST_W = 368;
const TOAST_H = 82;
const MAX_VISIBLE = 3;
const AUTO_DISMISS_MS = 8000;

/**
 * @param {object} o
 * @param {any} o.BrowserWindow
 * @param {Function} o.getScreen   Returns Electron's screen module. Resolved
 *   lazily on purpose: the screen module may not be touched before the app is
 *   ready, and this factory is constructed at module load.
 * @param {string} o.appDir        Root used to resolve the toast HTML/preload.
 */
function createToastStack({ BrowserWindow, getScreen, appDir }) {
  const windows = [];

  /** Stack upward from the bottom-right of the work area. */
  function layout() {
    const wa = getScreen().getPrimaryDisplay().workArea;
    windows.forEach((tw, i) => {
      if (tw.isDestroyed()) return;
      tw.setPosition(wa.x + wa.width - TOAST_W - 8, wa.y + wa.height - (TOAST_H + 4) * (i + 1) - 8);
    });
  }

  function drop(tw) {
    const i = windows.indexOf(tw);
    if (i !== -1) windows.splice(i, 1);
    if (!tw.isDestroyed()) tw.close();
    layout();
  }

  /** Drop by web contents, used when the toast itself asks to close. */
  function dropBySender(sender) {
    const tw = BrowserWindow.fromWebContents(sender);
    if (tw) drop(tw);
    return tw;
  }

  function show({ title, body, nick }) {
    if (!title) return null;
    while (windows.length >= MAX_VISIBLE) drop(windows[0]);
    const tw = new BrowserWindow({
      width: TOAST_W,
      height: TOAST_H,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      // Never steal focus from the game or the launcher.
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: path.join(appDir, "toast-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
      },
    });
    // Above full-screen apps, so a message is not missed while playing.
    tw.setAlwaysOnTop(true, "screen-saver");
    const qs = new URLSearchParams({
      title: String(title),
      body: String(body || ""),
      nick: String(nick || ""),
    });
    tw.loadFile(path.join(appDir, "renderer", "toast.html"), { search: qs.toString() });
    tw.once("ready-to-show", () => {
      windows.push(tw);
      layout();
      tw.showInactive();
    });
    const auto = setTimeout(() => drop(tw), AUTO_DISMISS_MS);
    tw.on("closed", () => clearTimeout(auto));
    return tw;
  }

  return { show, drop, dropBySender, layout, count: () => windows.length };
}

module.exports = { createToastStack, TOAST_W, TOAST_H, MAX_VISIBLE, AUTO_DISMISS_MS };
