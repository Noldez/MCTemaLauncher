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
// /head is the isometric 3D render, used wherever an avatar stands on its own.
const headUrl = (nick, size) => `https://mc-heads.net/head/${encodeURIComponent(nick || 'MHF_Steve')}/${size || 32}`;
// /avatar is the flat face crop. The 3D render carries transparent margins, so
// it looks broken when several are tiled into one square - group avatars use
// this instead.
const faceUrl = (nick, size) => `https://mc-heads.net/avatar/${encodeURIComponent(nick || 'MHF_Steve')}/${size || 32}`;

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

// Ambient drifting particles over a hero band. Shared by the home hero and the
// shop hero so both breathe the same way.
function ambientFx(host, cv) {
  if (!host || !cv) return;
  const ctx = cv.getContext('2d');
  let W = 0, H = 0;
  const resize = () => { W = cv.width = host.clientWidth; H = cv.height = host.clientHeight; };
  new ResizeObserver(resize).observe(host);
  resize();
  const rnd = (a, b) => a + Math.random() * (b - a);
  const spawn = (y) => ({ x: rnd(0, 1), y: y != null ? y : rnd(0, 1), r: rnd(0.8, 2.3),
    s: rnd(6, 18), w: rnd(0.2, 0.9), p: rnd(0, Math.PI * 2),
    a: rnd(0.2, 0.6), g: Math.random() < 0.8 });
  const parts = Array.from({ length: 42 }, () => spawn());
  let last = performance.now();
  (function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.y -= (p.s * dt) / (H || 1);
      p.p += p.w * dt;
      if (p.y < -0.05) Object.assign(p, spawn(1.05));
      const tw = 0.6 + Math.sin(p.p * 2) * 0.4;
      ctx.beginPath();
      ctx.arc(p.x * W + Math.sin(p.p) * 14, p.y * H, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.g ? `rgba(74,222,128,${p.a * tw})` : `rgba(220,240,230,${p.a * tw * 0.8})`;
      ctx.shadowColor = 'rgba(74,222,128,.8)';
      ctx.shadowBlur = p.g ? 6 : 3;
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    requestAnimationFrame(tick);
  })(last);
}

window.ui = {
  $, el, fmtAgo, headUrl, faceUrl, flatSkin, swapCanvas, ambientFx,
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

// The splash used to hide on a timer, so it could finish before the balance,
// friends or news had arrived and you would watch them pop in afterwards. Views
// register their first load here and it waits for the lot.
const bootTasks = [];
let bootSealed = false;
window.ui.bootTask = (p) => {
  if (bootSealed || !p || typeof p.then !== 'function') return p;
  bootTasks.push(Promise.resolve(p).catch(() => {}));
  return p;
};

(async () => {
  let st = { loggedIn: false };
  try { st = await window.api.authState(); } catch {}
  gate.classList.toggle('hidden', st.loggedIn);

  // Give the view scripts a tick to register, then wait for them - but never
  // trap anyone behind a splash: a slow or dead network still lets the
  // launcher open, it just arrives with less filled in.
  await new Promise((r) => setTimeout(r, 0));
  const settled = Promise.all(bootTasks);
  const floor = new Promise((r) => setTimeout(r, Math.max(0, 900 - (Date.now() - bootAt))));
  const cap = new Promise((r) => setTimeout(r, 7000));
  await Promise.race([Promise.all([settled, floor]), cap]);
  bootSealed = true;
  splash.classList.add('hide');
})();
document.querySelectorAll('#login-gate [data-url]').forEach((b) =>
  b.addEventListener('click', (e) => { e.preventDefault(); window.api.openExternal(b.dataset.url); }));
// The same form does both jobs; registering only adds a confirm field. Every
// rule that matters is checked by the server - this end just spares people a
// round trip for the obvious mistakes.
let registerMode = false;

function setMode(register) {
  registerMode = register;
  $('lg-pass2-wrap').classList.toggle('hidden', !register);
  $('lg-submit').textContent = register ? 'Sukurti paskyrą' : 'Prisijungti';
  $('lg-swap-text').textContent = register ? 'Jau turi paskyrą?' : 'Neturi paskyros?';
  $('lg-swap').textContent = register ? 'Prisijungti' : 'Registruotis';
  $('lg-pass').setAttribute('autocomplete', register ? 'new-password' : 'current-password');
  $('lg-error').textContent = '';
  $('lg-pass2').value = '';
}
$('lg-swap').addEventListener('click', () => setMode(!registerMode));

document.getElementById('lg-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('lg-submit');
  const username = $('lg-user').value.trim();
  const password = $('lg-pass').value;

  if (registerMode) {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
      $('lg-error').textContent = 'Slapyvardis: 3-16 simbolių (raidės, skaičiai, _).';
      return;
    }
    if (password.length < 6) { $('lg-error').textContent = 'Slaptažodis - bent 6 simboliai.'; return; }
    if (password !== $('lg-pass2').value) { $('lg-error').textContent = 'Slaptažodžiai nesutampa.'; return; }
  }

  btn.disabled = true;
  btn.textContent = registerMode ? 'Kuriama...' : 'Jungiamasi...';
  // Registering logs you straight in, so there is one less form to fill.
  const r = registerMode
    ? await window.api.authRegister({ username, password })
    : await window.api.authLogin({ username, password });
  btn.disabled = false;
  btn.textContent = registerMode ? 'Sukurti paskyrą' : 'Prisijungti';
  if (!r.ok) { $('lg-error').textContent = r.error || 'Klaida.'; return; }
  $('lg-error').textContent = '';
  $('lg-pass').value = '';
  $('lg-pass2').value = '';
  gate.classList.add('hidden');
  const c = await window.api.getConfig();
  window.ui.state.cfg = c;
  document.dispatchEvent(new CustomEvent('cfg', { detail: c }));
});
window.ui.logout = async () => {
  await window.api.authLogout();
  window.ui.showView('home');
  gate.classList.remove('hidden');
  setMode(false);
  // Tell the views the account changed, the same way logging in does - the
  // handlers read fields straight off this, so it has to be a real config
  // rather than null. Without it they keep whoever just signed out on screen,
  // and the next person to sign in sees them until the next poll.
  const c = await window.api.getConfig();
  window.ui.state.cfg = c;
  document.dispatchEvent(new CustomEvent('cfg', { detail: c }));
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
window.ui.bootTask(window.api.getConfig().then((c) => {
  window.ui.state.cfg = c;
  document.dispatchEvent(new CustomEvent('cfg', { detail: c }));
}));
window.ui.bootTask(refreshStatus());
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
// mctema:// deep links, already validated in the main process: play presses
// LAUNCH, friend prefills the add-friend box, open just needed the focus the
// main process already gave the window.
function runDeepLink(l) {
  if (!l) return;
  if (l.action === 'play') {
    const play = $('btn-play');
    if (play && !play.disabled) play.click();
  } else if (l.action === 'friend') {
    window.ui.showView('home');
    const inp = $('fr-input');
    if (inp) {
      inp.value = l.nick;
      inp.focus();
    }
    document.dispatchEvent(new CustomEvent('notify', {
      detail: { text: `Spausk + kad išsiųstum draugystės prašymą ${l.nick}.`, kind: 'info' },
    }));
  }
}
window.api.onDeepLink(runDeepLink);
window.api.deepLinkPending().then(runDeepLink).catch(() => {});

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

