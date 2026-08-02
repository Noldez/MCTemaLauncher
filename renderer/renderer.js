const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function fmtAgo(ts) {
  if (!ts) return 'niekada';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'ką tik';
  const m = Math.floor(s / 60); if (m < 60) return `prieš ${m} min.`;
  const h = Math.floor(m / 60); if (h < 24) return `prieš ${h} val.`;
  const d = Math.floor(h / 24); return `prieš ${d} d.`;
}
const headUrl = (nick, size) => `https://mc-heads.net/avatar/${encodeURIComponent(nick || 'MHF_Steve')}/${size || 32}`;

// Flat front-view skin render for machines without WebGL (VMs, blocklisted GPUs).
async function flatSkin(canvas, url, variant) {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const s = Math.max(1, Math.floor(Math.min(canvas.width / 18, canvas.height / 34)));
  const ox = Math.floor((canvas.width - 16 * s) / 2);
  const oy = Math.floor((canvas.height - 32 * s) / 2);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  const legacy = img.height <= 32;
  const aw = variant === 'slim' ? 3 : 4;
  const d = (sx, sy, sw, sh, dx, dy) => ctx.drawImage(img, sx, sy, sw, sh, ox + dx * s, oy + dy * s, sw * s, sh * s);
  d(8, 8, 8, 8, 4, 0);                                                  // head
  d(20, 20, 8, 12, 4, 8);                                               // body
  d(44, 20, aw, 12, 4 - aw, 8);                                         // right arm
  if (legacy) d(44, 20, aw, 12, 12, 8); else d(36, 52, aw, 12, 12, 8);  // left arm
  d(4, 20, 4, 12, 4, 20);                                               // right leg
  if (legacy) d(4, 20, 4, 12, 8, 20); else d(20, 52, 4, 12, 8, 20);     // left leg
  d(40, 8, 8, 8, 4, 0);                                                 // hat overlay
}

// skinview3d needs WebGL; on failure callers switch to flatSkin on a fresh canvas
// (the old canvas is unusable for 2d after a failed webgl context attempt).
function swapCanvas(old, w, h) {
  const cv = document.createElement('canvas');
  cv.id = old.id;
  cv.width = w;
  cv.height = h;
  old.replaceWith(cv);
  return cv;
}

window.ui = {
  $, el, fmtAgo, headUrl, flatSkin, swapCanvas,
  openUrl: (u) => window.api.openExternal(u),
  state: { cfg: null, status: null },
  showView(name) {
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
    document.querySelectorAll('.rail-btn[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  },
  async setCfg(patch) {
    window.ui.state.cfg = await window.api.setConfig(patch);
    document.dispatchEvent(new CustomEvent('cfg', { detail: window.ui.state.cfg }));
    return window.ui.state.cfg;
  },
};

const splash = $('boot-splash');
const gate = $('login-gate');
const bootAt = Date.now();
function hideSplash() {
  const wait = Math.max(0, 1100 - (Date.now() - bootAt));
  setTimeout(() => splash.classList.add('hide'), wait);
}
(async () => {
  let st = { loggedIn: false };
  try { st = await window.api.authState(); } catch {}
  gate.classList.toggle('hidden', st.loggedIn);
  hideSplash();
})();
document.querySelectorAll('#login-gate [data-url]').forEach((b) =>
  b.addEventListener('click', (e) => { e.preventDefault(); window.api.openExternal(b.dataset.url); }));
document.getElementById('lg-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('lg-submit');
  btn.disabled = true;
  btn.textContent = 'Jungiamasi...';
  const r = await window.api.authLogin({ username: $('lg-user').value.trim(), password: $('lg-pass').value });
  btn.disabled = false;
  btn.textContent = 'Prisijungti';
  if (!r.ok) { $('lg-error').textContent = r.error || 'Klaida.'; return; }
  $('lg-error').textContent = '';
  $('lg-pass').value = '';
  gate.classList.add('hidden');
  const c = await window.api.getConfig();
  window.ui.state.cfg = c;
  document.dispatchEvent(new CustomEvent('cfg', { detail: c }));
});
window.ui.logout = async () => {
  await window.api.authLogout();
  window.ui.showView('home');
  gate.classList.remove('hidden');
};

$('btn-min').addEventListener('click', () => window.api.minimize());
$('btn-max').addEventListener('click', () => window.api.maximize());
$('btn-close').addEventListener('click', () => window.api.close());
window.api.version().then((v) => { $('version').textContent = v; });

document.querySelectorAll('.rail-btn').forEach((b) => {
  b.addEventListener('click', () => {
    if (b.dataset.url) return window.ui.openUrl(b.dataset.url);
    if (b.dataset.view) window.ui.showView(b.dataset.view);
  });
});

async function refreshStatus() {
  let s;
  try { s = await window.api.serverStatus(); }
  catch { s = { online: false, players: { online: 0, max: 0 }, sample: [] }; }
  window.ui.state.status = s;
  $('online-dot').className = 'dot ' + (s.online ? 'on' : 'off');
  $('online-count').textContent = s.online ? s.players.online : '-';
  document.dispatchEvent(new CustomEvent('status', { detail: s }));
}
window.api.getConfig().then((c) => {
  window.ui.state.cfg = c;
  document.dispatchEvent(new CustomEvent('cfg', { detail: c }));
});
refreshStatus();
setInterval(refreshStatus, 15000);

const notifs = [];
const notifPop = $('notif-pop');
function renderNotifs() {
  notifPop.textContent = '';
  if (!notifs.length) { notifPop.append(el('div', 'np-empty', 'Pranešimų nėra')); return; }
  notifs.slice(-8).reverse().forEach((n) => {
    const r = el('div', 'np-row' + (n.kind === 'error' ? ' err' : ''));
    r.append(el('div', null, n.text), el('span', 'np-time', new Date(n.at).toLocaleTimeString('lt-LT', { hour: '2-digit', minute: '2-digit' })));
    notifPop.append(r);
  });
}
let unseenNotifs = 0;
function renderBellBadge() {
  const bell = $('rail-notif');
  const n = $('tb-bell-n');
  bell.classList.toggle('badged', unseenNotifs > 0);
  n.classList.toggle('hidden', unseenNotifs === 0);
  n.textContent = unseenNotifs > 9 ? '9+' : String(unseenNotifs);
}
document.addEventListener('notify', (e) => {
  notifs.push({ ...e.detail, at: Date.now() });
  unseenNotifs += 1;
  renderBellBadge();
  renderNotifs();
});
$('rail-notif').addEventListener('click', (e) => {
  e.stopPropagation();
  unseenNotifs = 0;
  renderBellBadge();
  notifPop.classList.toggle('hidden');
  renderNotifs();
});
document.addEventListener('click', (e) => {
  if (!notifPop.contains(e.target) && !$('rail-notif').contains(e.target)) notifPop.classList.add('hidden');
});
window.api.onLaunched(() => { window.ui.state.gameRunning = true; });
window.api.onClosed(() => { window.ui.state.gameRunning = false; });
window.api.onUpdate((u) => {
  if (!u) return;
  if (u.state === 'available') document.dispatchEvent(new CustomEvent('notify', { detail: { text: `Atnaujinimas v${u.version} siunčiamas...`, kind: 'info' } }));
  if (u.state === 'ready') {
    document.dispatchEvent(new CustomEvent('notify', { detail: { text: `Atnaujinimas v${u.version} paruoštas.`, kind: 'info' } }));
    const btn = $('tb-update');
    btn.classList.remove('hidden');
    btn.title = `v${u.version} paruošta - perkraus ir įdiegs`;
    window.api.nativeNotify({ title: 'MC Tema Launcher', body: `Atnaujinimas v${u.version} paruoštas - spausk ATNAUJINTI viršuje` });
  }
});
$('tb-update').addEventListener('click', () => {
  if (window.ui.state.gameRunning) {
    document.dispatchEvent(new CustomEvent('notify', { detail: { text: 'Uždaryk žaidimą prieš atnaujinant launcher.', kind: 'error' } }));
    return;
  }
  $('tb-update').innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i> DIEGIAMA...';
  window.api.installUpdate();
});

