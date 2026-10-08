// Maps /api/contests/winners into what the home view renders.
//
// Same stance as lib/news.js: every field is website data and is treated as
// untrusted text. Posters live on the clips domain (R2 behind
// klipai.mctema.lt), so that host is allowed beside the site itself. The URL
// comes back serialized by the URL parser, so it can sit inside a CSS
// url("...") without escaping surprises.
const SITE = 'https://mctema.lt';
const CLIPS = 'https://klipai.mctema.lt';
const PLACES = 3;

/**
 * @param {unknown} raw
 * @param {string[]} [extraOrigins] Dev-only: a local backend's origin.
 */
function posterUrl(raw, extraOrigins = []) {
  if (typeof raw !== 'string' || !raw) return null;
  let url;
  try {
    url = new URL(raw, SITE);
  } catch {
    return null;
  }
  if (url.origin !== SITE && url.origin !== CLIPS && !extraOrigins.includes(url.origin)) return null;
  return url.href;
}

/**
 * The podium for the home view, or null when there is nothing to show - a
 * strip with no winners on it is worse than no strip.
 * @param {any} payload
 * @param {string[]} [extraOrigins]
 */
function mapWinners(payload, extraOrigins = []) {
  const contest = payload && payload.contest;
  const list = payload && payload.winners;
  if (!contest || !Array.isArray(list)) return null;
  if (typeof contest.slug !== 'string' || !/^[a-z0-9-]{1,100}$/.test(contest.slug)) return null;

  const winners = list
    .filter(
      (w) =>
        w &&
        Number.isInteger(w.winnerRank) &&
        w.winnerRank >= 1 &&
        w.winnerRank <= PLACES &&
        typeof w.title === 'string' &&
        w.title &&
        typeof w.uploaderName === 'string' &&
        /^[A-Za-z0-9_]{1,16}$/.test(w.uploaderName),
    )
    .sort((a, b) => a.winnerRank - b.winnerRank)
    .slice(0, PLACES)
    .map((w) => ({
      place: w.winnerRank,
      title: w.title.slice(0, 120),
      nick: w.uploaderName,
      votes: Number.isInteger(w.votes) && w.votes >= 0 ? w.votes : 0,
      thumbUrl: posterUrl(w.thumbUrl, extraOrigins),
    }));
  if (!winners.length) return null;

  return {
    title: typeof contest.title === 'string' ? contest.title.slice(0, 120) : '',
    url: `${SITE}/konkursai/${contest.slug}`,
    winners,
  };
}

module.exports = { posterUrl, mapWinners };
