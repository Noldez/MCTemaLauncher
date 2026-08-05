// Launcher settings, persisted as JSON next to the game data.
//
// Paths are passed in rather than derived from Electron's app.getPath, so this
// stays importable (and testable) outside the main process.
const fs = require("fs");
const os = require("os");
const path = require("path");

const GIB = 1024 ** 3;

/**
 * First-run RAM default from total system memory. Machines with plenty of
 * memory get a bigger heap out of the box; tight ones stay at 4 GB so the OS
 * keeps breathing room.
 * @param {number} totalBytes
 */
function defaultRam(totalBytes) {
  if (totalBytes >= 16 * GIB) return 8;
  if (totalBytes >= 12 * GIB) return 6;
  return 4;
}

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
  currentCape: null,
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
 * @param {() => number} [totalmem]
 */
function loadConfig(configPath, io = fs, totalmem = os.totalmem) {
  // Deep copy: a shallow spread would hand every caller the same `skins`,
  // `friends` and `resolution` instances, so one mutation would leak into the
  // defaults for the rest of the process.
  const base = structuredClone(DEFAULTS);
  try {
    return { ...base, ...JSON.parse(io.readFileSync(configPath, "utf8")) };
  } catch {
    // First run (or an unreadable config): size the JVM heap to the machine.
    // A stored config never lands here, so a player's own choice always wins.
    base.ram = defaultRam(totalmem());
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

module.exports = { DEFAULTS, defaultRam, loadConfig, saveConfig };
