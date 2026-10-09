'use strict';

// Podium capes: the three built-in capes reserved for the latest contest's
// winners. A cape entry in capes.json carries `podium: 1|2|3`; everything else
// in the catalogue is an ordinary cape anyone may wear.
//
// Who may wear one is decided here, from the live podium (nick -> place) and
// the install's memory of what this nick has already earned. The memory is
// what keeps a past winner's cape after the next contest replaces the podium:
// a win is not something a later contest should take back.

/** The place a cape is reserved for, 1..3, or 0 for an ordinary cape. */
function podiumOf(cape) {
  const n = Number(cape && cape.podium);
  return Number.isInteger(n) && n >= 1 && n <= 3 ? n : 0;
}

/**
 * @typedef {{ id: string, podium?: number } & Record<string, any>} CapeEntry
 */

/**
 * Lock state for every cape as this player sees it, plus the updated memory.
 * Signed out, every podium cape is locked: the memory is keyed by nick, and
 * nobody is one.
 *
 * @param {CapeEntry[]} capes the built-in catalogue
 * @param {object} ctx
 * @param {string} ctx.nick the signed-in nick, '' when signed out
 * @param {Record<string, number>} ctx.placeOf lower-cased nick -> place, from the live podium
 * @param {Record<string, string[]>} ctx.earned lower-cased nick -> cape ids earned on this install
 * @returns {{capes: Array<CapeEntry & { locked: boolean }>, earned: Record<string, string[]>, newlyEarned: string[]}}
 *   `newlyEarned` lists podium capes this call opened for the first time, best place first.
 */
function unlockCapes(capes, { nick, placeOf, earned }) {
  const low = String(nick || '').toLowerCase();
  const place = low ? Number((placeOf || {})[low]) || 0 : 0;
  const had = low && Array.isArray((earned || {})[low]) ? (earned || {})[low].filter((x) => typeof x === 'string') : [];
  const mine = new Set(had);
  const fresh = [];

  const out = capes.map((c) => {
    const p = podiumOf(c);
    if (!p) return { ...c, locked: false };
    if (low && p === place && !mine.has(c.id)) {
      mine.add(c.id);
      fresh.push({ place: p, id: c.id });
    }
    return { ...c, locked: !mine.has(c.id) };
  });

  const next = { ...(earned || {}) };
  if (low && mine.size) next[low] = [...mine];
  fresh.sort((a, b) => a.place - b.place);
  return { capes: out, earned: next, newlyEarned: fresh.map((f) => f.id) };
}

/** Lower-cased nick -> place from a mapped podium ({ winners: [{ place, nick }] }), or {} for none. */
function placesOf(podium) {
  const out = {};
  if (!podium || !Array.isArray(podium.winners)) return out;
  for (const w of podium.winners) {
    const low = String(w && w.nick ? w.nick : '').toLowerCase();
    const p = Number(w && w.place);
    if (low && p >= 1 && p <= 3 && !(low in out)) out[low] = p;
  }
  return out;
}

module.exports = { podiumOf, unlockCapes, placesOf };
