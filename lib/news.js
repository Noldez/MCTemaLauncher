// Maps /api/posts payloads into what the home view renders.
//
// Every field comes from the website database and is treated as untrusted
// text. The image URL is only accepted when it resolves to https://mctema.lt -
// the only remote host the renderer CSP loads images from anyway - and is
// returned URL-serialized, so it can be interpolated into a CSS url("...")
// without escaping surprises.
const SITE = 'https://mctema.lt';

function absolutizeImage(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let abs;
  if (raw.startsWith('/uploads/')) abs = `${SITE}/api${raw}`; // backend uploads mount
  else if (raw.startsWith('/')) abs = `${SITE}${raw}`;
  else abs = raw;
  let url;
  try {
    url = new URL(abs);
  } catch {
    return null;
  }
  if (url.origin !== SITE) return null;
  return url.href;
}

function mapPosts(payload, limit = 4) {
  if (!Array.isArray(payload)) return [];
  return payload
    .filter((p) => p && Number.isInteger(p.id) && typeof p.title === 'string' && p.title)
    .slice(0, limit)
    .map((p) => ({
      id: p.id,
      title: p.title.slice(0, 120),
      dateIso: typeof p.createdAt === 'string' ? p.createdAt : null,
      imageUrl: absolutizeImage(p.imageUrl),
      url: `${SITE}/naujienos/${p.id}`,
    }));
}

module.exports = { absolutizeImage, mapPosts };
