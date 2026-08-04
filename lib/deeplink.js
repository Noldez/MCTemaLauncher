// mctema:// deep links from the website and Discord. Parsed strictly - the
// scheme is registered system-wide, so any page can fire one at us; a hostile
// link must never be able to do more than the three known actions, and a nick
// that fails the AuthMe pattern is dropped rather than forwarded.
const NICK_RE = /^[A-Za-z0-9_]{3,16}$/;

/**
 * @param {unknown} raw
 * @returns {{action: 'open'|'play'} | {action: 'friend', nick: string} | null}
 */
function parseDeepLink(raw) {
  if (typeof raw !== 'string' || !/^mctema:\/\//i.test(raw)) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const action = url.host.toLowerCase();
  if (action === 'open') return { action: 'open' };
  if (action === 'play') return { action: 'play' };
  if (action === 'friend') {
    let nick;
    try {
      nick = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    } catch {
      return null;
    }
    return NICK_RE.test(nick) ? { action: 'friend', nick } : null;
  }
  return null;
}

/** First mctema:// link in an argv array - Windows hands it to us as an arg. */
function linkFromArgv(argv) {
  for (const a of argv || []) {
    if (typeof a === 'string' && /^mctema:\/\//i.test(a)) return a;
  }
  return null;
}

module.exports = { parseDeepLink, linkFromArgv };
