// Launcher settings, persisted as JSON next to the game data.
//
// Paths are passed in rather than derived from Electron's app.getPath, so this
// stays importable (and testable) outside the main process.
const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  username: "",
  ram: 4,
  closeOnPlay: false,
  discordRpc: true,
  friends: [],
  totalPlayMs: 0,
  lastPlayedAt: null,
  skins: [],
  currentSkin: null,
  resolution: { w: 1280, h: 720, fullscreen: false },
  jvmArgs: "",
  optionalMods: [],
  friendPrefs: {},
};

/**
 * Read settings, falling back to defaults for a missing, unreadable or corrupt
 * file. A bad config must never stop the launcher from starting.
 */
/**
 * @param {string} configPath
 * @param {any} [io]
 */
function loadConfig(configPath, io = fs) {
  // Deep copy: a shallow spread would hand every caller the same `skins`,
  // `friends` and `resolution` instances, so one mutation would leak into the
  // defaults for the rest of the process.
  const base = structuredClone(DEFAULTS);
  try {
    return { ...base, ...JSON.parse(io.readFileSync(configPath, "utf8")) };
  } catch {
    return base;
  }
}

/** Best-effort write; a failure here must not break the action that triggered it. */
/**
 * @param {string} configPath
 * @param {any} cfg
 * @param {any} [io]
 */
function saveConfig(configPath, cfg, io = fs) {
  try {
    io.mkdirSync(path.dirname(configPath), { recursive: true });
  } catch {}
  try {
    io.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  } catch {}
}

module.exports = { DEFAULTS, loadConfig, saveConfig };
