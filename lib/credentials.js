// Account credentials at rest.
//
// The launcher stores the account password, not just a session token, because
// token refresh needs it. That raises the bar for where it may be written: only
// a real OS keystore is acceptable.
//
// Electron's safeStorage is injected rather than required, so the platform rules
// below can be tested without running inside Electron.
const fs = require("fs");
const path = require("path");

/**
 * @param {object} deps
 * @param {any} deps.safeStorage       Electron safeStorage (or a test double).
 * @param {string} deps.authPath       File holding the encrypted blob.
 * @param {string} [deps.platform]     process.platform override for tests.
 * @param {any} [deps.io]              fs override for tests.
 */
function createCredentialStore({ safeStorage, authPath, platform = process.platform, io = fs }) {
  /**
   * On Linux, isEncryptionAvailable() also returns true for the `basic_text`
   * backend, which "encrypts" with a key hardcoded in Chromium. That is
   * obfuscation, not storage we can trust with a password, so a real keyring
   * (gnome-libsecret or kwallet) is required there.
   */
  function keystoreUsable() {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (platform !== "linux") return true;
    // Reported before the app is ready; treat as usable and re-check later
    // rather than refusing a login that would in fact be safe.
    const backend = safeStorage.getSelectedStorageBackend();
    return backend !== "basic_text";
  }

  function load() {
    try {
      if (!io.existsSync(authPath) || !keystoreUsable()) return null;
      const o = JSON.parse(safeStorage.decryptString(io.readFileSync(authPath)));
      if (o && o.username && o.password) return o;
    } catch {}
    return null;
  }

  function save(username, password, token) {
    try {
      io.mkdirSync(path.dirname(authPath), { recursive: true });
    } catch {}
    io.writeFileSync(
      authPath,
      safeStorage.encryptString(JSON.stringify({ username, password, token: token || null })),
    );
  }

  function clear() {
    try {
      io.rmSync(authPath, { force: true });
    } catch {}
  }

  return { keystoreUsable, load, save, clear };
}

/** Server error code -> message shown on the login gate. */
function authErrText(r) {
  const code = r && r.json && r.json.error;
  switch (code) {
    case "AUTH_DOWN":
      return "Prisijungimas laikinai neveikia.";
    case "RATE":
      return "Per daug bandymų - pabandyk vėliau.";
    case "WRONG":
      return "Neteisingas slapyvardis arba slaptažodis.";
    case "BAD_INPUT":
      return "Slapyvardis: 3-16 simbolių (raidės, skaičiai, _).";
    default:
      return "Kažkas nepavyko. Pabandyk dar kartą.";
  }
}

module.exports = { createCredentialStore, authErrText };
