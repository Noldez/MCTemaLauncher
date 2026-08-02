// Certificate-pinned HTTPS client for mctema.lt.
//
// The launcher does not trust the system certificate store for its own API: a
// rogue CA, a corporate proxy or hostile wifi would otherwise be able to read
// account credentials. Every request must present a chain containing one of the
// pinned public keys, or it is torn down before the body is written.
//
// Requires no Electron, so the pin logic is unit-testable.
const https = require("https");
const crypto = require("crypto");

const WEBSITE_HOST = "mctema.lt";
const USER_AGENT = "MCTemaLauncher";

// Cloudflare issues our edge certificate and picks the CA, so Let's Encrypt is
// pinned as a backup alongside the Google chain served today - without it, a CA
// switch on Cloudflare's side would lock every player out at once.
//
// Roots rather than intermediates: they outlive intermediates by years, and the
// chain walk below inspects every certificate presented.
//
// Regenerate with `npm run check-pins`. Do NOT copy pin values from a CA's
// website: those are SPKI digests, and this hashes Node's `pubkey` field, which
// differs for ECDSA keys.
const CERT_PINS = [
  "H7AMYAvicN2+UcFPBz3kJXCDmGrTItZh4ujUBK8hoWg=", // GTS WE1 (current issuer)
  "YSoUL4CBzo5aJ/ES9gSZTsavsgtHsiLLnTG+BKUdork=", // GTS Root R4
  "C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=", // ISRG Root X1 (Let's Encrypt, RSA)
  "+QHt0j1IgBr88CsiSG197KRsbAlprQDohcvoe1Za45Y=", // ISRG Root X2 (Let's Encrypt, ECDSA)
  "fk6IOKit1ild5647BH06ujSIq5XbCgqlbYl6ANhhi88=", // ISRG Root YR (Let's Encrypt, newer hierarchy)
  "o8gmWo6hTNA1Y/ybI8g6rlbzT1YElMY4ivrLbjg5fyE=", // ISRG Root YE (Let's Encrypt, newer hierarchy)
];

/** Pin value for a single certificate, as produced by `npm run check-pins`. */
function pinOf(cert) {
  return crypto.createHash("sha256").update(cert.pubkey).digest("base64");
}

/**
 * True when any certificate in the presented chain matches a pin. Walks leaf ->
 * issuer, guarding against the self-referential link a root uses to terminate
 * the chain, and against loops in a hostile chain.
 */
function chainMatchesPin(leaf, pins = CERT_PINS) {
  let cert = leaf;
  const seen = new Set();
  while (cert && cert.pubkey && !seen.has(cert.fingerprint256)) {
    seen.add(cert.fingerprint256);
    if (pins.includes(pinOf(cert))) return true;
    if (!cert.issuerCertificate || cert.issuerCertificate === cert) break;
    cert = cert.issuerCertificate;
  }
  return false;
}

/**
 * Body and content type for a multipart upload. Split out from the request so
 * the encoding can be checked without a network round trip.
 */
// The body is assembled by concatenation, so any CR or LF reaching a header
// would let a caller forge extra parts or overwrite earlier fields. Strip them
// at the boundary rather than trusting every call site.
const headerSafe = (v) => String(v).replace(/[\r\n]/g, "");
const fileNameSafe = (v) => String(v).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64) || "file";

function buildMultipart(fields, file) {
  const boundary = "----mctema" + crypto.randomBytes(12).toString("hex");
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${headerSafe(k)}"\r\n\r\n${headerSafe(v)}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${fileNameSafe(file.name)}"\r\n` +
        `Content-Type: ${headerSafe(file.type)}\r\n\r\n`,
    ),
  );
  parts.push(file.buf);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

/**
 * Single pinned request. Resolves rather than rejects, with either
 * `{ status, json }` or `{ error }` where error is PIN, NETWORK or BAD_RESPONSE.
 *
 * `opts.host`/`opts.pins` exist so tests can point at a local server.
 */
function pinnedRequest({ method, path: reqPath, headers = {}, body = null, timeoutMs = 15000, host = WEBSITE_HOST, pins = CERT_PINS, port = 443, ca = undefined }) {
  return new Promise((resolve) => {
    let pinned = false;
    const allHeaders = { "User-Agent": USER_AGENT, ...headers };
    if (body) allHeaders["Content-Length"] = body.length;
    const req = https.request(
      {
        host,
        port,
        method,
        path: reqPath,
        // RFC 6066 forbids an IP literal as SNI; Node warns and will drop it.
        servername: /^[\d.]+$/.test(host) || host.includes(":") ? undefined : host,
        rejectUnauthorized: true,
        // Extra trust anchor, used by tests to present a chain that passes
        // ordinary validation but is not pinned - otherwise rejectUnauthorized
        // alone rejects it and the pin check is never exercised.
        ...(ca ? { ca } : {}),
        minVersion: "TLSv1.2",
        agent: false,
        headers: allHeaders,
      },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          buf += c;
        });
        res.on("end", () => {
          if (!pinned) {
            resolve({ error: "PIN" });
            return;
          }
          try {
            resolve({ status: res.statusCode, json: JSON.parse(buf || "{}") });
          } catch {
            resolve({ error: "BAD_RESPONSE" });
          }
        });
      },
    );
    req.on("socket", (/** @type {any} */ s) =>
      s.on("secureConnect", () => {
        try {
          pinned = chainMatchesPin(s.getPeerCertificate(true), pins);
        } catch {
          pinned = false;
        }
        if (!pinned) req.destroy(new Error("certificate pin mismatch"));
      }),
    );
    req.on("error", () => resolve({ error: "NETWORK" }));
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    if (body) req.write(body);
    req.end();
  });
}

/** Unauthenticated JSON POST - used by login, which has no token yet. */
function postJson(reqPath, body, opts = {}) {
  return pinnedRequest({
    method: "POST",
    path: reqPath,
    headers: { "Content-Type": "application/json" },
    body: Buffer.from(JSON.stringify(body), "utf8"),
    timeoutMs: 20000,
    ...opts,
  });
}

/** Authenticated JSON call against the launcher API. */
function apiRequest(method, reqPath, body, token, opts = {}) {
  const data = body ? Buffer.from(JSON.stringify(body), "utf8") : null;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (data) headers["Content-Type"] = "application/json";
  return pinnedRequest({ method, path: reqPath, headers, body: data, timeoutMs: 15000, ...opts });
}

/** Authenticated multipart upload (screenshots, DM images). */
function upload(reqPath, token, fields, file, opts = {}) {
  const { body, contentType } = buildMultipart(fields, file);
  return pinnedRequest({
    method: "POST",
    path: reqPath,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
    timeoutMs: 30000,
    ...opts,
  });
}

module.exports = {
  WEBSITE_HOST,
  CERT_PINS,
  pinOf,
  chainMatchesPin,
  buildMultipart,
  pinnedRequest,
  postJson,
  apiRequest,
  upload,
};
