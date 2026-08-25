// Java runtime resolution.
//
// The launcher runs the game on the Java 21 it ships and on nothing else. mclc
// falls back to `java` on PATH when it is handed no path, and that fallback is
// how players ended up starting 1.21.11 on an old system Java 8: Fabric then
// refuses the mods and blames them, or the launch dies with "'java' is not
// recognized". Neither message points at the real problem, which is that the
// bundled runtime is not where it should be.
//
// So resolution is explicit here and returns what it found rather than a bare
// path: a missing runtime is a condition the caller has to handle, and the
// report below is what turns the next crash report into evidence about where
// the runtime went.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/** Largest repair archive we will download, well over a JRE's size. */
const JRE_ZIP_MAX_BYTES = 120 * 1024 * 1024;

/**
 * Where a runtime lives, given a directory that holds a `jre` folder.
 * @param {string} dir
 * @param {string} platform
 */
function javaIn(dir, platform) {
  return path.join(dir, "jre", "bin", platform === "win32" ? "java.exe" : "java");
}

/**
 * Locate the runtime the game will use.
 *
 * The bundled copy comes first; the repaired copy in the game directory is the
 * fallback for installs that lost theirs, and is written by the repair download
 * rather than by the installer. System Java is deliberately not a candidate.
 *
 * @param {object} o
 * @param {boolean} o.packaged
 * @param {string} o.resourcesPath
 * @param {string} o.appDir
 * @param {string} o.repairDir     Game directory, where a repair lands.
 * @param {string} [o.platform]
 * @param {any} [o.io]
 * @returns {{path: string|undefined, source: "bundled"|"repair"|null,
 *            bundled: string, repaired: string}}
 */
function resolveJava({ packaged, resourcesPath, appDir, repairDir, platform = process.platform, io = fs }) {
  const bundled = javaIn(packaged ? resourcesPath : path.join(appDir, "assets"), platform);
  const repaired = javaIn(repairDir, platform);
  if (io.existsSync(bundled)) return { path: bundled, source: "bundled", bundled, repaired };
  if (io.existsSync(repaired)) return { path: repaired, source: "repair", bundled, repaired };
  return { path: undefined, source: null, bundled, repaired };
}

/**
 * What a directory holds, for the launch log.
 * @param {string} dir
 * @param {any} io
 */
function entries(dir, io) {
  try {
    const names = io.readdirSync(dir);
    return names.length ? names.slice(0, 24).join(", ") : "(tuščias)";
  } catch {
    return "(nėra)";
  }
}

/**
 * Log lines describing the resolution.
 *
 * When nothing was found these lines say which paths were checked and what is
 * actually next to them, which is the difference between "the update never
 * wrote the runtime" and "something removed java.exe from it".
 *
 * @param {ReturnType<typeof resolveJava>} found
 * @param {any} [io]
 * @returns {string[]}
 */
function javaReport(found, io = fs) {
  if (found.path) {
    return [`Java: ${found.path} (${found.source === "repair" ? "atsarginė" : "įtaisytoji"})`];
  }
  const jreDir = path.dirname(path.dirname(found.bundled));
  return [
    "Java 21 nerasta - launcheris nepaleis žaidimo su sistemos Java.",
    `  ieškota: ${found.bundled}`,
    `  ieškota: ${found.repaired}`,
    `  ${path.dirname(jreDir)}: ${entries(path.dirname(jreDir), io)}`,
    `  ${path.join(jreDir, "bin")}: ${entries(path.join(jreDir, "bin"), io)}`,
  ];
}

/**
 * Whether a downloaded repair archive may be unpacked.
 *
 * Same rule as the update path: the hash pinned in the launcher is what
 * vouches for the bytes, so serving the feed is not enough to put code on a
 * player's disk.
 *
 * @param {Buffer} buf
 * @param {string} expectedSha256
 * @param {number} [maxBytes]
 */
function jreZipIsAuthentic(buf, expectedSha256, maxBytes = JRE_ZIP_MAX_BYTES) {
  if (!buf || !buf.length || buf.length > maxBytes) return false;
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return false;
  if (!/^[a-f0-9]{64}$/.test(String(expectedSha256))) return false;
  return crypto.createHash("sha256").update(buf).digest("hex") === expectedSha256;
}

module.exports = { resolveJava, javaReport, jreZipIsAuthentic, JRE_ZIP_MAX_BYTES };
