(() => {
  const { $, el } = window.ui;
  let shots = [], q = '', sort = 'new', view = 'grid', day = null;
  const dkey = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  async function load() { shots = await window.api.listShots(); renderCal(); render(); }

  function filtered() {
    let a = shots.filter((s) => s.name.toLowerCase().includes(q));
    if (day) a = a.filter((s) => dkey(s.mtime) === day);
    a.sort((x, y) => sort === 'new' ? y.mtime - x.mtime : sort === 'old' ? x.mtime - y.mtime : y.size - x.size);
    return a;
  }

  function render() {
    const g = $('gal-grid');
    g.className = 'gal-grid' + (view === 'list' ? ' as-list' : '');
    g.textContent = '';
    const a = filtered();
    if (!a.length) {
      const e = el('div', 'gal-empty');
      e.append(el('b', null, 'Nuotraukų nėra'), el('span', null, 'Spausk F2 žaidime - nuotraukos atsiras čia.'));
      const b = el('button', 'ghost', 'Atidaryti aplanką');
      b.addEventListener('click', () => window.api.openShotsFolder());
      e.append(b);
      g.append(e);
      return;
    }
    const fmtDate = (ms) => {
      const d = new Date(ms);
      return d.toLocaleDateString('lt-LT', { month: 'long', day: 'numeric' }) + ', '
        + d.toLocaleTimeString('lt-LT', { hour: '2-digit', minute: '2-digit' });
    };
    a.forEach((s) => {
      const c = el('figure', 'gal-item');
      const img = el('img');
      img.src = s.url;
      img.loading = 'lazy';
      c.append(img);
      if (view === 'list') c.append(el('figcaption', null, `${s.name} - ${fmtDate(s.mtime)} - ${(s.size / 1048576).toFixed(1)} MB`));
      else c.append(el('div', 'gal-date', fmtDate(s.mtime)));
      c.addEventListener('click', () => lightbox(s));
      g.append(c);
    });
  }

  function lightbox(s) {
    const L = $('gal-light');
    L.textContent = '';
    L.classList.remove('hidden');
    const img = el('img');
    img.src = s.url;
    const bar = el('div', 'lb-bar');
    const mk = (ic, txt, fn) => {
      const b = el('button', 'ghost');
      b.innerHTML = `<i class="fa-solid ${ic}"></i> ${txt}`;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    bar.append(
      mk('fa-copy', 'Kopijuoti', () => window.api.copyShot(s.path)),
      mk('fa-paper-plane', 'Siųsti draugui', () => {
        L.classList.add('hidden');
        if (window.relayShareShot) window.relayShareShot(s.path);
      }),
      mk('fa-up-right-from-square', 'Atidaryti', () => window.api.openShot(s.path)),
      mk('fa-share-nodes', 'Į bendruomenės galeriją', () => {
        bar.textContent = '';
        bar.append(el('span', 'lb-nick', 'Kategorija:'));
        Object.entries(CAT_LABELS).forEach(([key, label]) => {
          const cb = el('button', 'ghost', label);
          cb.addEventListener('click', async (e) => {
            e.stopPropagation();
            const nick = (window.ui.state.cfg && window.ui.state.cfg.username) || 'Tadassi';
            const r = await window.api.submitShot({ path: s.path, nick, category: key });
            document.dispatchEvent(new CustomEvent('notify', {
              detail: r.ok
                ? { text: 'Nuotrauka pateikta - laukia patvirtinimo.', kind: 'info' }
                : { text: r.error || 'Nepavyko pateikti.', kind: 'error' },
            }));
            L.classList.add('hidden');
          });
          bar.append(cb);
        });
      }),
      mk('fa-trash-can', 'Ištrinti', async () => { await window.api.deleteShot(s.path); L.classList.add('hidden'); load(); }),
    );
    L.append(img, bar);
    L.addEventListener('click', () => L.classList.add('hidden'), { once: true });
  }

  function renderCal() {
    const days = new Set(shots.map((s) => dkey(s.mtime)));
    const cal = $('gal-cal');
    cal.textContent = '';
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    cal.append(el('div', 'cal-title', now.toLocaleDateString('lt-LT', { month: 'long', year: 'numeric' })));
    const grid = el('div', 'cal-grid');
    const first = (new Date(y, m, 1).getDay() + 6) % 7;
    for (let i = 0; i < first; i++) grid.append(el('span'));
    for (let d = 1; d <= new Date(y, m + 1, 0).getDate(); d++) {
      const k = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const b = el('button', 'cal-d' + (days.has(k) ? ' has' : '') + (day === k ? ' sel' : ''), String(d));
      b.addEventListener('click', () => { day = day === k ? null : k; renderCal(); render(); });
      grid.append(b);
    }
    cal.append(grid);
  }

  const CAT_LABELS = { bendra: 'Bendra', statybos: 'Statybos', peizazai: 'Peizažai', renginys: 'Renginys' };
  const myVotes = (() => {
    try { return JSON.parse(localStorage.galVotes || '{}'); } catch { return {}; }
  })();
  let commRows = [], commCat = 'all', commPlayer = '', commQ = '';

  function renderCommSide() {
    const players = {};
    commRows.forEach((r) => { players[r.nick] = (players[r.nick] || 0) + 1; });
    const list = $('comm-players');
    list.textContent = '';
    Object.entries(players)
      .filter(([n]) => n.toLowerCase().includes(commQ))
      .sort((a, b) => b[1] - a[1])
      .forEach(([nick, count]) => {
        const b = el('button', 'comm-player' + (commPlayer === nick ? ' on' : ''));
        const img = el('img');
        img.src = window.ui.headUrl(nick, 20);
        b.append(img, el('b', null, nick), el('span', null, String(count)));
        b.addEventListener('click', () => {
          commPlayer = commPlayer === nick ? '' : nick;
          renderCommSide(); renderCommGrid();
        });
        list.append(b);
      });
    const cats = $('comm-cats');
    cats.textContent = '';
    const counts = { all: commRows.length };
    commRows.forEach((r) => { counts[r.category] = (counts[r.category] || 0) + 1; });
    [['all', 'Visos'], ...Object.entries(CAT_LABELS)].forEach(([key, label]) => {
      const b = el('button', commCat === key ? 'on' : '');
      b.textContent = `${label} (${counts[key] || 0})`;
      b.addEventListener('click', () => { commCat = key; renderCommSide(); renderCommGrid(); });
      cats.append(b);
    });
  }

  function commLightbox(r) {
    const L = $('gal-light');
    L.textContent = '';
    L.classList.remove('hidden');
    const img = el('img');
    img.src = r.url;
    const bar = el('div', 'lb-bar');
    const who = el('span', 'cg-nick lb-nick');
    const head = el('img', 'cg-head');
    head.src = window.ui.headUrl(r.nick, 20);
    who.append(head, document.createTextNode(`${r.nick} · ${CAT_LABELS[r.category] || r.category}`));
    bar.append(who, voteBtn(r, 1), voteBtn(r, -1));
    bar.addEventListener('click', (e) => e.stopPropagation());
    L.append(img, bar);
    L.addEventListener('click', () => L.classList.add('hidden'), { once: true });
  }

  function renderCommGrid() {
    const grid = $('comm-grid');
    grid.textContent = '';
    const rows = commRows.filter((r) =>
      (commCat === 'all' || r.category === commCat) &&
      (!commPlayer || r.nick === commPlayer));
    if (!rows.length) {
      grid.append(el('div', 'cg-empty', commRows.length ? 'Pagal filtrą nieko nerasta.' : 'Dar tuščia - pateik savo kadrą iš skilties Mano!'));
      return;
    }
    const sorted = [...rows].sort((a, b) => (b.up - b.down) - (a.up - a.down));
    const spot = sorted[0];
    grid.append(card(spot, true));
    rows.filter((r) => r.id !== spot.id).forEach((r) => grid.append(card(r, false)));
  }

  async function renderCommunity() {
    try { commRows = await window.api.featuredGallery(); } catch { commRows = []; }
    renderCommSide();
    renderCommGrid();
  }

  function voteBtn(r, value) {
    const b = el('button', 'cg-vote' + (myVotes[r.id] === value ? ' on' : ''));
    b.innerHTML = `<i class="fa-solid fa-chevron-${value === 1 ? 'up' : 'down'}"></i><span>${value === 1 ? r.up : r.down}</span>`;
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (myVotes[r.id] === value) return;
      const nick = (window.ui.state.cfg && window.ui.state.cfg.username) || 'Tadassi';
      const res = await window.api.voteShot({ id: r.id, value, nick });
      if (!res.ok) return;
      if (value === 1) { r.up += 1; if (myVotes[r.id] === -1) r.down -= 1; }
      else { r.down += 1; if (myVotes[r.id] === 1) r.up -= 1; }
      myVotes[r.id] = value;
      localStorage.galVotes = JSON.stringify(myVotes);
      renderCommSide();
      renderCommGrid();
    });
    return b;
  }

  function card(r, spotlight) {
    const c = el('figure', 'cg-card' + (spotlight ? ' spot' : ''));
    const frame = el('div', 'cg-frame');
    const img = el('img');
    img.src = r.url;
    img.loading = 'lazy';
    frame.append(img);
    if (spotlight) frame.append(el('span', 'cg-top', 'SAVAITĖS KADRAS'));
    if (r.category && r.category !== 'bendra') frame.append(el('span', 'cg-cat', CAT_LABELS[r.category] || r.category));
    const cap = el('figcaption', 'cg-cap');
    const who = el('span', 'cg-nick');
    const head = el('img', 'cg-head');
    head.src = window.ui.headUrl(r.nick, 20);
    who.append(head, document.createTextNode(r.nick));
    const votes = el('span', 'cg-votes');
    votes.append(voteBtn(r, 1), voteBtn(r, -1));
    cap.append(who, votes);
    c.append(frame, cap);
    c.addEventListener('click', () => commLightbox(r));
    return c;
  }

  $('comm-q').addEventListener('input', (e) => { commQ = e.target.value.trim().toLowerCase(); renderCommSide(); });

  let galTab = 'mine';
  document.querySelectorAll('.gal-tabs .gt').forEach((b) => b.addEventListener('click', () => {
    galTab = b.dataset.g;
    document.querySelectorAll('.gal-tabs .gt').forEach((x) => x.classList.toggle('on', x === b));
    const mine = galTab === 'mine';
    $('gal-grid').classList.toggle('hidden', !mine);
    $('comm-grid').classList.toggle('hidden', mine);
    $('mine-side').classList.toggle('hidden', !mine);
    $('comm-side').classList.toggle('hidden', mine);
    document.querySelector('.gal-search').classList.toggle('hidden', !mine);
    $('gal-folder').classList.toggle('hidden', !mine);
    if (!mine) renderCommunity();
  }));

  $('gal-q').addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); render(); });
  $('gal-folder').addEventListener('click', () => window.api.openShotsFolder());
  $('gal-view').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    view = b.dataset.v;
    [...$('gal-view').children].forEach((x) => x.classList.toggle('on', x === b));
    render();
  });
  $('gal-sort').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    sort = b.dataset.s;
    [...$('gal-sort').children].forEach((x) => x.classList.toggle('on', x === b));
    render();
  });
  document.querySelector('[data-view="gallery"]').addEventListener('click', load);
  load();
})();
