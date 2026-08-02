// Client mod staging and integrity verification.
//
// The bundled client jars are checked against known hashes on every launch, so
// a tampered or partially-written jar refuses to start the game rather than
// joining the server with modified code. Optional mods are user-installed and
// merely skipped when they do not match.
//
// Directories and fs are injected, so the verification rules are testable
// without Electron or a real game install.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/**
 * @param {string} p
 * @param {any} [io] fs override for tests.
 */
function sha256File(p, io = fs) {
  return crypto.createHash("sha256").update(io.readFileSync(p)).digest("hex");
}

/**
 * Stage the required client mods into the game's mods directory, then add any
 * enabled optional mods whose hash still matches what was recorded.
 *
 * Throws when a required mod is missing or fails its hash check; the caller
 * surfaces that as a launch failure.
 *
 * @param {object} o
 * @param {string} o.srcDir        Bundled mods shipped with the launcher.
 * @param {string} o.dstDir        The game's mods directory (rebuilt each launch).
 * @param {object} o.hashes        filename -> expected sha256 for required mods.
 * @param {string} [o.optionalDir] Where user-installed optional mods live.
 * @param {Array}  [o.optionalMods] Entries of { file, sha256, enabled }.
 * @param {any} [o.io]             fs override for tests.
 * @returns {{required: string[], optional: string[]}} staged filenames
 */
function stageMods({ srcDir, dstDir, hashes, optionalDir, optionalMods = [], io = fs }) {
  for (const f of Object.keys(hashes)) {
    const p = path.join(srcDir, f);
    if (!io.existsSync(p)) throw new Error(`Missing client file: ${f}`);
    if (sha256File(p, io) !== hashes[f]) {
      throw new Error(`Client integrity check failed for ${f}. Reinstall the launcher.`);
    }
  }

  // Rebuilt from scratch so a mod removed from the bundle cannot linger.
  try {
    io.rmSync(dstDir, { recursive: true, force: true });
  } catch {}
  io.mkdirSync(dstDir, { recursive: true });

  const required = [];
  for (const f of Object.keys(hashes)) {
    io.copyFileSync(path.join(srcDir, f), path.join(dstDir, f));
    required.push(f);
  }

  const optional = [];
  for (const st of optionalMods || []) {
    if (!st || !st.enabled) continue;
    const p = path.join(optionalDir, st.file);
    try {
      // A mismatch here means the file changed since the user installed it, so
      // it is skipped rather than treated as an error.
      if (io.existsSync(p) && sha256File(p, io) === st.sha256) {
        io.copyFileSync(p, path.join(dstDir, st.file));
        optional.push(st.file);
      }
    } catch {}
  }

  return { required, optional };
}

/** Bundled Java runtime, or undefined when it is missing. */
/**
 * @param {object} o
 * @param {boolean} o.packaged
 * @param {string} o.resourcesPath
 * @param {string} o.appDir
 * @param {string} [o.platform]
 * @param {any} [o.io]
 */
function resolveJava({ packaged, resourcesPath, appDir, platform = process.platform, io = fs }) {
  const exe = platform === "win32" ? "java.exe" : "java";
  const candidate = packaged
    ? path.join(resourcesPath, "jre", "bin", exe)
    : path.join(appDir, "assets", "jre", "bin", exe);
  return io.existsSync(candidate) ? candidate : undefined;
}

module.exports = { sha256File, stageMods, resolveJava };
