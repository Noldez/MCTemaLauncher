const crypto = require('crypto');

function writeVarInt(value) {
  const bytes = [];
  do {
    let tmp = value & 0x7f;
    value >>>= 7;
    if (value !== 0) tmp |= 0x80;
    bytes.push(tmp);
  } while (value !== 0);
  return Buffer.from(bytes);
}

function readVarInt(buf, offset) {
  let value = 0, size = 0, b;
  do {
    if (offset + size >= buf.length) return null;
    b = buf[offset + size];
    value |= (b & 0x7f) << (7 * size);
    size++;
  } while (b & 0x80);
  return { value, size };
}

function offlineUUID(username) {
  const hash = crypto.createHash('md5')
    .update(`OfflinePlayer:${username}`, 'utf8')
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

module.exports = { writeVarInt, readVarInt, offlineUUID };
