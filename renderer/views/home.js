(() => {
  const { $, fmtAgo } = window.ui;

  function renderCfg(c) {
    const nick = c.username || 'Tadassi';
    $('greet-nick').textContent = nick;
    $('stat-last').textContent = c.lastPlayedAt ? `MC Tema - ${fmtAgo(c.lastPlayedAt)}` : 'dar nežaista';
    $('stat-total').textContent = `${(Math.round(((c.totalPlayMs || 0) / 3600000) * 10) / 10).toLocaleString('lt-LT')} val.`;
  }
  document.addEventListener('cfg', (e) => renderCfg(e.detail));
  if (window.ui.state.cfg) renderCfg(window.ui.state.cfg);


  let charViewer = null;
  let charFlat = null;
  let charKey = '';

  async function loadChar() {
    if (!window.skinview3d) return;
    if (!charViewer && !charFlat) {
      try {
        charViewer = initViewer();
      } catch {
        charFlat = window.ui.swapCanvas($('home-char'), 210, 320);
      }
    }
    try {
      const data = await window.api.listSkins();
      const cur = data.skins.find((s) => s.id === data.current);
      const nick = (window.ui.state.cfg && window.ui.state.cfg.username) || 'MHF_Steve';
      const key = (cur ? `skin:${cur.id}` : `nick:${nick}`) + (charFlat ? ':2d' : '');
      if (key === charKey) return;
      const url = cur ? cur.url : `https://mc-heads.net/skin/${encodeURIComponent(nick)}`;
      const model = cur && cur.variant === 'slim' ? 'slim' : 'default';
      if (charViewer) await charViewer.loadSkin(url, { model });
      else await window.ui.flatSkin(charFlat, url, model);
      charKey = key;
    } catch {}
  }

  function initViewer() {
    const charViewer = new skinview3d.SkinViewer({ canvas: $('home-char'), width: 210, height: 320 });
    charViewer.controls.enableZoom = false;
    charViewer.zoom = 0.62;
    charViewer.autoRotate = true;
    charViewer.autoRotateSpeed = 0.6;
    let anim;
    try {
      const Pose = class extends skinview3d.PlayerAnimation {
        animate(player) {
          const t = this.progress * 1.4;
          const s = player.skin;
          s.leftArm.rotation.z = 0.4 + Math.sin(t) * 0.05;
          s.rightArm.rotation.z = -0.4 - Math.sin(t + 0.6) * 0.05;
          s.leftArm.rotation.x = -0.15;
          s.rightArm.rotation.x = -0.15;
          s.leftLeg.rotation.x = 0.5 + Math.sin(t * 0.9) * 0.06;
          s.rightLeg.rotation.x = -0.2 - Math.sin(t * 0.9) * 0.06;
          s.leftLeg.rotation.z = 0.12;
          s.rightLeg.rotation.z = -0.12;
          s.head.rotation.y = Math.sin(t * 0.5) * 0.25;
          s.head.rotation.x = -0.12;
          player.rotation.x = 0.1;
          player.position.y = 0.5 + Math.sin(t) * 1.2;
        }
      };
      anim = new Pose();
    } catch { anim = new skinview3d.IdleAnimation(); }
    charViewer.animation = anim;
    return charViewer;
  }
  loadChar();
  document.querySelector('.rail-btn[data-view="home"]').addEventListener('click', loadChar);
  document.addEventListener('cfg', loadChar);

  window.ui.ambientFx(document.querySelector('.hero'), $('hero-fx'));

  const btn = $('btn-play');
  const setBusy = (busy, label) => { btn.disabled = busy; btn.querySelector('.launch-word').textContent = label; };
  window.api.onProgress((p) => {
    if (!p || !p.total) return;
    $('launch-progress').classList.remove('hidden');
    const pct = Math.min(100, Math.round((p.task / p.total) * 100));
    $('lp-fill').style.width = pct + '%';
    $('lp-text').textContent = `${p.type || 'siunčiama'}: ${pct}%`;
  });
  window.api.onLaunched(() => { setBusy(true, 'ŽAIDŽIAMA'); $('launch-progress').classList.add('hidden'); });
  window.api.onClosed(() => {
    setBusy(false, 'LAUNCH');
    $('launch-progress').classList.add('hidden');
    window.api.getConfig().then((c) => { window.ui.state.cfg = c; renderCfg(c); });
  });
  btn.addEventListener('click', async () => {
    const c = window.ui.state.cfg || {};
    const nick = /^[A-Za-z0-9_]{3,16}$/.test(c.username || '') ? c.username : 'Tadassi';
    setBusy(true, 'PALEIDŽIAMA');
    const r = await window.api.play({ username: nick, ram: c.ram || 4 });
    if (!r.ok) {
      setBusy(false, 'LAUNCH');
      document.dispatchEvent(new CustomEvent('notify', { detail: { text: r.error, kind: 'error' } }));
    }
  });
  const profileCard = document.getElementById('profile-play');
  if (profileCard) profileCard.addEventListener('click', () => { if (!btn.disabled) btn.click(); });
  window.api.onLog((m) => document.dispatchEvent(new CustomEvent('mclog', { detail: m })));

  document.querySelectorAll('#view-home [data-url]').forEach((b) =>
    b.addEventListener('click', () => window.ui.openUrl(b.dataset.url)));
  document.querySelectorAll('#view-home [data-view]').forEach((b) =>
    b.addEventListener('click', () => window.ui.showView(b.dataset.view)));

  async function refreshDiscord() {
    try {
      const d = await window.api.discordStatus();
      const wrap = document.getElementById('disc-count');
      if (d && typeof d.online === 'number') {
        document.getElementById('disc-n').textContent = d.online.toLocaleString('lt-LT');
        wrap.classList.remove('hidden');
      } else {
        wrap.classList.add('hidden');
      }
    } catch {}
  }
  refreshDiscord();
  setInterval(refreshDiscord, 60000);

  (() => {
    const { el, headUrl } = window.ui;
    const row = document.getElementById('streams-row');
    if (!row) return;
    const MOCK = [
      { name: 'Tadassi', platform: 'twitch', viewers: 132, title: 'Spawn turas prieš startą', thumb: 'hero.webp', url: 'https://www.twitch.tv/' },
      { name: 'PixelKaralius', platform: 'youtube', viewers: 87, title: 'Survival pradžia LIVE', thumb: 'news-2.webp', url: 'https://www.youtube.com/' },
    ];
    MOCK.forEach((s) => {
      const c = el('button', 'stream-pill');
      const av = el('span', 'sp-av');
      const head = el('img'); head.src = headUrl(s.name, 34);
      av.append(head, el('i', 'sp-dot'));
      const mm = el('span', 'sp-meta');
      mm.append(el('b', null, s.name), el('span', null, s.title));
      const v = el('span', 'sp-count');
      v.innerHTML = `<i class="fa-brands fa-${s.platform === 'twitch' ? 'twitch' : 'youtube'}"></i> ${s.viewers}`;
      c.append(av, mm, v);
      c.addEventListener('click', () => window.ui.openUrl(s.url));
      row.append(c);
    });
  })();

  const LAUNCH_AT = new Date(2026, 7, 15, 19, 0, 0);
  function tickNews() {
    const n = document.getElementById('news-count');
    if (!n) return;
    const ms = LAUNCH_AT - Date.now();
    if (ms <= 0) { n.textContent = 'Serveris startavo - prisijunk!'; return; }
    const s = Math.floor(ms / 1000);
    n.textContent = `Iki serverio starto: ${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}val ${Math.floor((s % 3600) / 60)}min`;
  }
  tickNews();
  setInterval(tickNews, 30000);

  // Real news from mctema.lt. On any failure the bundled static cards stay -
  // the launcher must look fine fully offline.
  (async () => {
    let r;
    try { r = await window.api.newsList(); } catch { return; }
    if (!r || !r.ok || !r.posts || !r.posts.length) return;
    const { el } = window.ui;
    const grid = document.querySelector('.news-grid');
    grid.textContent = '';
    r.posts.forEach((p) => {
      const card = el('article', 'news-card');
      if (p.imageUrl) card.style.backgroundImage = `url("${p.imageUrl}")`;
      const box = el('div', 'nc-content');
      const when = p.dateIso
        ? new Date(p.dateIso).toLocaleDateString('lt-LT', { year: 'numeric', month: 'long', day: 'numeric' })
        : '';
      box.append(el('div', 'nc-title', p.title), el('div', 'nc-under', when));
      const more = el('button', 'nc-more', 'PLAČIAU');
      more.addEventListener('click', () => window.ui.openUrl(p.url));
      box.append(more);
      card.append(box);
      grid.append(card);
    });
  })();
})();
