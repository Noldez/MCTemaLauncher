(() => {
  const { $, el, headUrl } = window.ui;
  const fmt = (n) => Number(n || 0).toLocaleString('lt-LT');

  // Same labels and playtime convention as the website's topai page.
  const CATS = [
    ['kills', 'Nužudymai'],
    ['deaths', 'Mirtys'],
    ['blocksBroken', 'Iškasti blokai'],
    ['blocksPlaced', 'Padėti blokai'],
    ['playtime', 'Žaidimo laikas'],
    ['fishing', 'Žvejyba'],
    ['mobKills', 'Mobų nužudymai'],
  ];
  const fmtValue = (cat, v) => (cat === 'playtime' ? `${fmt(Math.round(v / 60))} val.` : fmt(v));
  const bodyUrl = (nick, w) => `https://mc-heads.net/body/${encodeURIComponent(nick || 'MHF_Steve')}/${w}`;

  let data = null;
  let cat = 'kills';
  let loadedFor = null;
  let loading = false;

  function chipBar() {
    const bar = $('tops-cats');
    bar.textContent = '';
    CATS.forEach(([key, label]) => {
      const b = el('button', 'tc-chip' + (key === cat ? ' on' : ''), label);
      b.addEventListener('click', () => { cat = key; render(); });
      bar.append(b);
    });
  }

  function podiumCol(entry, place) {
    const col = el('div', `tp-col p${place}`);
    const img = el('img', 'tp-body');
    img.src = bodyUrl(entry.playerName, place === 1 ? 90 : 70);
    img.alt = '';
    col.append(img, el('b', 'tp-place', `#${entry.rank}`), el('span', 'tp-nick', entry.playerName),
      el('span', 'tp-val', fmtValue(cat, entry.value)));
    if (data && entry.playerName === data.me.name) col.classList.add('me');
    return col;
  }

  function render() {
    chipBar();
    const body = $('tops-body');
    body.textContent = '';
    if (!data) {
      const retry = el('button', 'shop-btn', 'Nepavyko užkrauti - bandyti dar kartą');
      retry.addEventListener('click', () => load(true));
      body.append(retry);
      return;
    }
    const entries = data.boards[cat] || [];
    if (!entries.length) {
      body.append(el('div', 'tops-empty', 'Šis topas dar tuščias - jis pildosi žaidžiant.'));
      return;
    }
    // Winner in the middle, same as the site: render order 2-1-3.
    const podium = entries.slice(0, 3);
    const ordered = [podium[1], podium[0], podium[2]].filter(Boolean);
    const pd = el('div', 'tops-podium');
    ordered.forEach((e) => pd.append(podiumCol(e, e.rank)));
    body.append(pd);

    const list = el('div', 'tops-list');
    entries.slice(3).forEach((e) => {
      const row = el('div', 'tr-row' + (e.playerName === data.me.name ? ' me' : ''));
      const head = el('img', 'tr-head');
      head.src = headUrl(e.playerName, 28);
      head.alt = '';
      row.append(el('b', 'tr-rank', `#${e.rank}`), head, el('span', 'tr-nick', e.playerName),
        el('span', 'tr-val', fmtValue(cat, e.value)));
      list.append(row);
    });
    body.append(list);

    // Outside the visible board: still tell the player where they stand.
    const myRank = data.me.ranks && data.me.ranks[cat];
    const shown = entries.some((e) => e.playerName === data.me.name);
    if (myRank && !shown) {
      body.append(el('div', 'tops-mine', `Tavo vieta: #${fmt(myRank)}`));
    }
  }

  async function load(force) {
    if (loading) return;
    const username = (window.ui.state.cfg && window.ui.state.cfg.username) || null;
    if (!force && data && username === loadedFor) return;
    loading = true;
    let r;
    try { r = await window.api.topsData(); } catch { r = null; }
    loading = false;
    data = r && r.ok ? r : null;
    if (data) loadedFor = username;
    render();
  }

  render();
  document.querySelector('.rail-btn[data-view="topai"]').addEventListener('click', () => load(true));
  document.addEventListener('cfg', () => {
    const username = (window.ui.state.cfg && window.ui.state.cfg.username) || null;
    if (username !== loadedFor) { data = null; render(); }
  });
})();
