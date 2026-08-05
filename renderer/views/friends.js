(() => {
  const { el, headUrl, fmtAgo } = window.ui;
  const body = document.getElementById('fr-body');
  const input = document.getElementById('fr-input');
  let tab = 'friends', filter = '';

  let live = { friends: [], received: [], sent: [] };
  let liveOk = false;
  let loading = true;

  const prefs = () => (window.ui.state.cfg && window.ui.state.cfg.friendPrefs) || {};
  const prefOf = (nick) => prefs()[nick.toLowerCase()] || {};
  const setPref = (nick, patch) => window.ui.setCfg({
    friendPrefs: { ...prefs(), [nick.toLowerCase()]: { ...prefOf(nick), ...patch } },
  });

  const sample = () => new Set(((window.ui.state.status && window.ui.state.status.sample) || []).map((n) => n.toLowerCase()));

  let seenReqIds = null;
  function toastNewRequests() {
    const ids = new Set(live.received.map((r) => r.id));
    if (seenReqIds && !window.ui.state.gameRunning) {
      const toastsOn = !window.ui.state.cfg || window.ui.state.cfg.toasts !== false;
      for (const r of live.received) {
        if (seenReqIds.has(r.id)) continue;
        if (toastsOn) window.api.nativeNotify({ title: r.from, body: 'Nori tapti draugu' });
        document.dispatchEvent(new CustomEvent('notify', {
          detail: { text: `${r.from} nori tapti draugu`, kind: 'info' },
        }));
      }
    }
    seenReqIds = ids;
  }

  async function refresh() {
    const r = await window.api.friendsList();
    loading = false;
    if (r.ok) {
      live = { friends: r.friends || [], received: r.received || [], sent: r.sent || [] };
      liveOk = true;
      toastNewRequests();
    } else {
      liveOk = false;
    }
    render();
  }

  let editingAlias = null;

  function row(f, online) {
    const p = prefOf(f.nick);
    const r = el('div', 'fr-row');
    const img = el('img', 'fr-head-img');
    img.src = headUrl(f.nick, 26);
    img.onerror = () => { img.style.visibility = 'hidden'; };
    const meta = el('div', 'fr-meta');
    if (editingAlias === f.nick) {
      const inp = el('input', 'fr-alias-input');
      inp.maxLength = 20;
      inp.value = p.alias || f.nick;
      const commit = async () => {
        editingAlias = null;
        const v = inp.value.trim();
        await setPref(f.nick, { alias: (v && v !== f.nick) ? v : undefined });
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') inp.blur();
        if (ev.key === 'Escape') { editingAlias = null; render(); }
      });
      meta.append(inp);
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
    } else {
      const b = el('b', null, p.alias || f.nick);
      if (p.best) b.prepend(el('i', 'fa-solid fa-star fr-best'));
      meta.append(b);
    }
    meta.append(el('span', online ? 'fr-st on' : 'fr-st',
      f.online ? 'Žaidžia: MC Tema'
        : online ? 'Launcheryje'
          : (f.lastSeenAt ? `Neprisijungęs ${fmtAgo(f.lastSeenAt)}` : 'Neprisijungęs')));
    const chat = el('button', 'fr-chat');
    chat.title = 'Rašyti žinutę';
    chat.innerHTML = '<i class="fa-regular fa-comment"></i>';
    chat.addEventListener('click', () => window.openRelay && window.openRelay(f.nick));
    r.append(img, meta, chat);
    r.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(e, f); });
    return r;
  }

  function reqRow(r0, received) {
    const rr = el('div', 'fr-row');
    const nick = received ? r0.from : r0.to;
    const img = el('img', 'fr-head-img');
    img.src = headUrl(nick, 26);
    img.onerror = () => { img.style.visibility = 'hidden'; };
    const meta = el('div', 'fr-meta');
    meta.append(el('b', null, nick),
      el('span', 'fr-st', `${received ? 'Gauta' : 'Išsiųsta'} ${fmtAgo(new Date(r0.at).getTime())}`));
    const acts = el('div', 'fr-req-acts');
    if (received) {
      const ok = el('button', 'fr-acc');
      ok.innerHTML = '<i class="fa-solid fa-check"></i>';
      ok.title = 'Priimti';
      ok.addEventListener('click', async () => { await window.api.friendRespond({ id: r0.id, accept: true }); refresh(); });
      acts.append(ok);
    }
    const no = el('button', 'fr-dec');
    no.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    no.title = received ? 'Atmesti' : 'Atšaukti';
    no.addEventListener('click', async () => {
      if (received) await window.api.friendRespond({ id: r0.id, accept: false });
      else await window.api.friendCancel(r0.id);
      refresh();
    });
    acts.append(no);
    rr.append(img, meta, acts);
    return rr;
  }

  function render() {
    body.textContent = '';
    const reqTab = document.querySelector('.fr-tab[data-tab="requests"]');
    if (reqTab) reqTab.classList.toggle('badged', live.received.length > 0);

    if (loading) { body.append(el('div', 'fr-empty', 'Kraunama...')); return; }
    if (!liveOk) {
      const e = el('div', 'fr-empty', 'Nepavyko pasiekti mctema.lt.');
      const retry = el('button', 'ghost', 'Bandyti dar kartą');
      retry.style.marginTop = '10px';
      retry.addEventListener('click', () => { loading = true; render(); refresh(); });
      body.append(e, retry);
      return;
    }

    if (tab === 'requests') {
      if (!live.received.length && !live.sent.length) { body.append(el('div', 'fr-empty', 'Prašymų nėra')); return; }
      if (live.received.length) {
        body.append(el('div', 'fr-sect', `${live.received.length} Gauti`));
        live.received.forEach((r0) => body.append(reqRow(r0, true)));
      }
      if (live.sent.length) {
        body.append(el('div', 'fr-sect', `${live.sent.length} Išsiųsti`));
        live.sent.forEach((r0) => body.append(reqRow(r0, false)));
      }
      return;
    }

    const on = sample();
    const byBest = (a, b) => (prefOf(b.nick).best ? 1 : 0) - (prefOf(a.nick).best ? 1 : 0);
    const list = live.friends.filter((f) => {
      const alias = prefOf(f.nick).alias || '';
      return f.nick.toLowerCase().includes(filter) || alias.toLowerCase().includes(filter);
    });
    const isOn = (f) => f.online || f.inLauncher || on.has(f.nick.toLowerCase());
    const onL = list.filter(isOn).sort(byBest);
    const offL = list.filter((f) => !isOn(f)).sort(byBest);
    if (onL.length) body.append(el('div', 'fr-sect', `${onL.length} Online`));
    onL.forEach((f) => body.append(row(f, true)));
    if (offL.length) body.append(el('div', 'fr-sect', `${offL.length} Offline`));
    offL.forEach((f) => body.append(row(f, false)));
    if (!list.length) body.append(el('div', 'fr-empty', 'Pridėk draugą paieškos laukelyje - jam ateis prašymas.'));
  }

  async function addFriend() {
    const v = input.value.trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(v)) return;
    input.value = '';
    filter = '';
    const r = await window.api.friendRequest(v);
    document.dispatchEvent(new CustomEvent('notify', {
      detail: r.ok
        ? { text: r.accepted ? `Jūs su ${v} dabar draugai!` : `Prašymas ${v} išsiųstas.`, kind: 'info' }
        : { text: r.error, kind: 'error' },
    }));
    refresh();
  }
  document.getElementById('fr-add').addEventListener('click', addFriend);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addFriend(); });
  input.addEventListener('input', () => { filter = input.value.trim().toLowerCase(); render(); });
  document.querySelectorAll('.fr-tab').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    document.querySelectorAll('.fr-tab').forEach((x) => x.classList.toggle('active', x === b));
    render();
  }));

  document.addEventListener('status', render);
  // Signing in as someone else has to refetch, not redraw. Rendering again
  // just painted the previous account's friends until the 30s poll came
  // round, which looked like the list had frozen. Clearing first means their
  // names are never on screen under your account, even for one frame.
  document.addEventListener('cfg', () => {
    live = { friends: [], received: [], sent: [] };
    seenReqIds = null;
    loading = true;
    render();
    refresh();
  });

  const menu = document.getElementById('fr-menu');
  function openMenu(e, f) {
    const p = prefOf(f.nick);
    menu.textContent = '';
    const item = (txt, ic, cls, fn) => {
      const b = el('button', 'ctx-item' + (cls ? ' ' + cls : ''));
      b.innerHTML = `<i class="fa-solid ${ic}"></i>${txt}`;
      if (fn) b.addEventListener('click', () => { fn(); hide(); }); else b.disabled = true;
      menu.append(b);
    };
    item('Join Server', 'fa-circle-play', 'accent', null);
    item('Send Message', 'fa-comment', null, () => window.openRelay && window.openRelay(f.nick));
    item('Add to Group', 'fa-user-group', null, null);
    menu.append(el('div', 'ctx-div'));
    item(p.best ? 'Remove Best Friend' : 'Add Best Friend', 'fa-heart', 'gold', () => setPref(f.nick, { best: !p.best }));
    item('Set Nickname', 'fa-id-card', null, () => { editingAlias = f.nick; render(); });
    item('Copy IGN', 'fa-copy', null, () => navigator.clipboard.writeText(f.nick));
    menu.append(el('div', 'ctx-div'));
    item('Unfriend', 'fa-user-minus', 'danger', async () => { await window.api.friendRemove(f.nick); refresh(); });
    item('Block', 'fa-ban', 'danger', null);
    menu.classList.remove('hidden');
    menu.style.left = Math.min(e.clientX, window.innerWidth - 210) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8) + 'px';
  }
  const hide = () => menu.classList.add('hidden');
  document.addEventListener('click', hide);

  render();
  refresh();
  setInterval(refresh, 30000);
})();
