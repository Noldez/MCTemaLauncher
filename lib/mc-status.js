// Minecraft Server List Ping, used for the live player count in the UI.
//
// Speaks just enough of the protocol to send a handshake plus status request and
// read the JSON reply. Needs no Electron, so the parsing is unit-testable.
const net = require("net");
const { writeVarInt, readVarInt } = require("./protocol");

const OFFLINE = { online: false, players: { online: 0, max: 0 }, sample: [] };

// A real status reply is a few KB; anything beyond this is a peer trying to
// exhaust memory rather than answer.
const MAX_RESPONSE_BYTES = 256 * 1024;

/** A length-prefixed packet: [len][id][...payload]. */
function packet(id, ...parts) {
  const data = Buffer.concat([writeVarInt(id), ...parts]);
  return Buffer.concat([writeVarInt(data.length), data]);
}

/** Length-prefixed UTF-8 string, as the protocol encodes them. */
function mcString(s) {
  const b = Buffer.from(s, "utf8");
  return Buffer.concat([writeVarInt(b.length), b]);
}

function handshake(host, port) {
  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(port);
  // -1 as the protocol version means "just tell me your status".
  return Buffer.concat([
    packet(0x00, writeVarInt(-1), mcString(host), portBuf, writeVarInt(1)),
    packet(0x00),
  ]);
}

/**
 * Parse a status response.
 * Returns null when more bytes are needed, or a status object once complete.
 * Never throws: a malformed reply reads as offline rather than crashing the
 * status poll.
 */
function parseStatusResponse(buf) {
  const len = readVarInt(buf, 0);
  if (!len || buf.length < len.size + len.value) return null;
  try {
    let off = len.size;
    const id = readVarInt(buf, off);
    off += id.size;
    const sLen = readVarInt(buf, off);
    off += sLen.size;
    const json = JSON.parse(buf.slice(off, off + sLen.value).toString("utf8"));
    // Server-controlled data: keep only names that look like real nicks.
    const sample = ((json.players && json.players.sample) || [])
      .map((p) => p && p.name)
      .filter((n) => typeof n === "string" && /^[A-Za-z0-9_]{1,16}$/.test(n));
    return {
      online: true,
      players: {
        online: (json.players && json.players.online) || 0,
        max: (json.players && json.players.max) || 0,
      },
      sample,
    };
  } catch {
    return { ...OFFLINE };
  }
}

/** Ping a server. Always resolves; unreachable or malformed reads as offline. */
function mcStatus(host, port, timeout = 4000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {}
      resolve(v);
    };
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeout, () => finish({ ...OFFLINE }));
    socket.on("error", () => finish({ ...OFFLINE }));
    socket.on("connect", () => socket.write(handshake(host, port)));

    let buf = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      // setTimeout below is an idle timeout, so a peer that keeps streaming
      // never trips it. Refuse a reply far larger than any real status packet.
      if (buf.length > MAX_RESPONSE_BYTES) {
        finish({ ...OFFLINE });
        return;
      }
      const parsed = parseStatusResponse(buf);
      if (parsed) finish(parsed);
    });
  });
}

module.exports = { mcStatus, parseStatusResponse, packet, mcString, handshake, OFFLINE };
