(() => {
  const { el, headUrl, fmtAgo } = window.ui;
  const listBox = document.getElementById('rl-list');
  const chatPane = document.getElementById('rl-chat');
  const railRelay = document.querySelector('.rail-btn[data-view="relay"]');
  const SITE = 'https://mctema.lt/api';

  let inbox = [];
  let friends = [];
  let inboxOk = true;
  let current = null;
  let lastId = 0;
  let msgsBox = null;
  let lastDay = '';
  let listFilter = '';

  const relayActive = () => document.getElementById('view-relay').classList.contains('active');
  const time = (ms) => new Date(ms).toLocaleTimeString('lt-LT', { hour: '2-digit', minute: '2-digit' });
  const dayOf = (ms) => new Date(ms).toDateString();

  const light = el('div', 'lightbox hidden');
  document.body.append(light);
  function openLight(src, name, when) {
    light.textContent = '';
    const img = el('img');
    img.src = src;
    const cap = el('div', 'lb-bar');
    cap.append(el('span', 'lb-nick', `${when} · ${name}`));
    const dl = el('button', 'ghost');
    dl.innerHTML = '<i class="fa-solid fa-download"></i> Atsisiųsti';
    dl.addEventListener('click', (e) => { e.stopPropagation(); saveImage(src, name); });
    cap.append(dl);
    light.append(img, cap);
    light.classList.remove('hidden');
    light.addEventListener('click', () => light.classList.add('hidden'), { once: true });
  }
  function saveImage(src, name) {
    const a = document.createElement('a');
    a.href = src;
    a.download = name || 'nuotrauka.png';
    a.click();
  }

  function renderInbox() {
    listBox.textContent = '';
    if (!inboxOk) {
      listBox.append(el('div', 'fr-empty', 'Nepavyko pasiekti mctema.lt.'));
      return;
    }
    const convoNicks = new Set(inbox.map((c) => c.nick.toLowerCase()));
    const isOn = (nick) => {
      const f = friends.find((x) => x.nick.toLowerCase() === nick.toLowerCase());
      return !!(f && (f.online || f.inLauncher));
    };
    const match = (nick) => !listFilter || nick.toLowerCase().includes(listFilter);
    const convos = inbox.filter((c) => match(c.nick));
    if (convos.length) {
      listBox.append(el('div', 'rl-sect', 'Žinutės'));
      convos.forEach((c) => {
        const r = el('div', 'rl-row' + (current && current.toLowerCase() === c.nick.toLowerCase() ? ' active' : ''));
        const img = el('img', 'rl-head');
        img.src = headUrl(c.nick, 34);
        const m = el('div', 'rl-meta');
        const name = el('b', null, c.nick);
        if (isOn(c.nick)) name.append(el('i', 'rl-on'));
        m.append(name, el('span', null, (c.lastKind === 'image' ? '📷 ' : '') + c.lastBody));
        r.append(img, m, el('em', null, fmtAgo(c.lastAt).replace('prieš ', '')));
        if (c.unread) r.append(el('span', 'rl-unread', String(c.unread)));
        r.addEventListener('click', () => openConvo(c.nick));
        listBox.append(r);
      });
    }
    const rest = friends.filter((f) => !convoNicks.has(f.nick.toLowerCase()) && match(f.nick));
    if (rest.length) {
      listBox.append(el('div', 'rl-sect', 'Draugai'));
      rest.forEach((f) => {
        const r = el('div', 'rl-row');
        const img = el('img', 'rl-head');
        img.src = headUrl(f.nick, 34);
        const m = el('div', 'rl-meta');
        const name = el('b', null, f.nick);
        if (f.online || f.inLauncher) name.append(el('i', 'rl-on'));
        m.append(name, el('span', null,
          f.online ? 'Žaidžia: MC Tema' : f.inLauncher ? 'Launcheryje' : 'Parašyk žinutę'));
        r.append(img, m);
        r.addEventListener('click', () => openConvo(f.nick));
        listBox.append(r);
      });
    }
    if (!convos.length && !rest.length) {
      listBox.append(el('div', 'fr-empty',
        listFilter ? 'Nieko nerasta.' : 'Pridėk draugų, kad galėtum susirašinėti.'));
    }
  }

  let prevUnread = null;
  function toastNewMessages() {
    const focused = document.hasFocus();
    if (prevUnread && !window.ui.state.gameRunning) {
      for (const c of inbox) {
        const key = c.nick.toLowerCase();
        const reading = focused && current && current.toLowerCase() === key;
        const toastsOn = !window.ui.state.cfg || window.ui.state.cfg.toasts !== false;
        if ((c.unread || 0) > (prevUnread[key] || 0) && !reading) {
          if (toastsOn) window.api.nativeNotify({
            title: c.nick,
            body: c.lastKind === 'image' ? '📷 Nuotrauka' : c.lastBody,
            nick: c.nick,
          });
          document.dispatchEvent(new CustomEvent('notify', {
            detail: { text: `Nauja žinutė nuo ${c.nick}`, kind: 'info' },
          }));
        }
      }
    }
    prevUnread = Object.fromEntries(inbox.map((c) => [c.nick.toLowerCase(), c.unread || 0]));
  }

  async function refreshInbox() {
    const [ir, fr] = await Promise.all([window.api.chatInbox(), window.api.friendsList()]);
    inboxOk = !!ir.ok;
    if (ir.ok) inbox = (ir.inbox || []).sort((a, b) => b.lastAt - a.lastAt);
    if (fr.ok) friends = fr.friends || [];
    const unread = inbox.reduce((s, c) => s + (c.unread || 0), 0);
    railRelay.classList.toggle('badged', unread > 0);
    if (ir.ok) toastNewMessages();
    renderInbox();
  }

  function appendMessage(m) {
    const me = ((window.ui.state.cfg && window.ui.state.cfg.username) || '').toLowerCase();
    const mine = m.from.toLowerCase() === me;
    const d = dayOf(m.at);
    if (d !== lastDay) {
      lastDay = d;
      const div = el('div', 'rl-date');
      div.append(el('span', null, new Date(m.at).toLocaleDateString('lt-LT', { month: 'long', day: 'numeric' })));
      msgsBox.append(div);
    }
    if (m.kind === 'image') {
      const src = SITE + m.body;
      const name = m.fileName || 'nuotrauka';
      const when = time(m.at);
      const fig = el('figure', 'msg-img' + (mine ? ' mine' : ''));
      const frame = el('div', 'mi-frame');
      const img = el('img');
      img.src = src;
      img.addEventListener('click', (e) => { e.stopPropagation(); openLight(src, name, when); });
      const tools = el('div', 'mi-tools');
      const zoom = el('button', 'mi-tool');
      zoom.innerHTML = '<i class="fa-solid fa-magnifying-glass-plus"></i>';
      zoom.addEventListener('click', (e) => { e.stopPropagation(); openLight(src, name, when); });
      const dl = el('button', 'mi-tool');
      dl.innerHTML = '<i class="fa-solid fa-download"></i>';
      dl.addEventListener('click', (e) => { e.stopPropagation(); saveImage(src, name); });
      tools.append(zoom, dl);
      frame.append(img, tools);
      const cap = el('figcaption');
      cap.append(el('span', null, when), el('em', null, name));
      fig.append(frame, cap);
      msgsBox.append(fig);
    } else {
      msgsBox.append(el('div', 'bub' + (mine ? ' mine' : ''), m.body));
    }
  }

  async function loadNew() {
    if (!current) return;
    const r = await window.api.chatHistory({ with: current, after: lastId });
    if (!r.ok || !msgsBox) return;
    const nearBottom = msgsBox.scrollHeight - msgsBox.scrollTop - msgsBox.clientHeight < 120;
    for (const m of (r.messages || [])) {
      appendMessage(m);
      lastId = Math.max(lastId, m.id);
    }
    if ((r.messages || []).length && nearBottom) msgsBox.scrollTop = msgsBox.scrollHeight;
  }

  async function openConvo(nick) {
    current = nick;
    lastId = 0;
    lastDay = '';
    chatPane.textContent = '';

    const head = el('div', 'rl-chat-head');
    const hImg = el('img', 'rl-head');
    hImg.src = headUrl(nick, 34);
    const hMeta = el('div', 'rl-meta');
    const f = friends.find((x) => x.nick.toLowerCase() === nick.toLowerCase());
    const on = f && (f.online || f.inLauncher);
    hMeta.append(el('b', null, nick),
      el('span', on ? 'fr-st on' : 'fr-st',
        f && f.online ? 'Žaidžia: MC Tema' : f && f.inLauncher ? 'Launcheryje' : 'Neprisijungęs'));
    head.append(hImg, hMeta);

    msgsBox = el('div', 'rl-msgs');

    const inputRow = el('div', 'rl-input');
    const inp = el('textarea', 'rl-ta');
    inp.placeholder = `Rašyk žinutę ${nick}...`;
    inp.maxLength = 1000;
    inp.rows = 1;
    inp.addEventListener('input', () => {
      inp.style.height = 'auto';
      inp.style.height = Math.min(120, inp.scrollHeight) + 'px';
    });
    const filePick = el('input');
    filePick.type = 'file';
    filePick.accept = 'image/*';
    filePick.hidden = true;
    const attach = el('button', 'rl-ic');
    attach.innerHTML = '<i class="fa-solid fa-paperclip"></i>';
    attach.addEventListener('click', () => filePick.click());
    filePick.addEventListener('change', async () => {
      const file = filePick.files[0];
      filePick.value = '';
      if (!file) return;
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      const CH = 0x8000;
      for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
      const r = await window.api.chatSendImage({ to: current, name: file.name, data: btoa(bin) });
      if (!r.ok) document.dispatchEvent(new CustomEvent('notify', { detail: { text: r.error, kind: 'error' } }));
      loadNew();
      refreshInbox();
    });
    const send = el('button', 'rl-send');
    send.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i>';
    async function submit() {
      const v = inp.value.trim();
      if (!v || !current) return;
      inp.value = '';
      inp.style.height = 'auto';
      const r = await window.api.chatSend({ to: current, body: v });
      if (!r.ok) document.dispatchEvent(new CustomEvent('notify', { detail: { text: r.error, kind: 'error' } }));
      loadNew();
      refreshInbox();
    }
    send.addEventListener('click', submit);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    inputRow.append(inp, attach, send);

    chatPane.append(head, msgsBox, inputRow);
    await loadNew();
    msgsBox.scrollTop = msgsBox.scrollHeight;
    renderInbox();
    refreshInbox();
    inp.focus();
  }

  window.openRelay = (nick) => {
    window.ui.showView('relay');
    openConvo(nick);
  };
  window.api.onRelayOpen((nick) => window.openRelay(nick));

  const searchInp = document.getElementById('rl-search-inp');
  searchInp.addEventListener('input', () => {
    listFilter = searchInp.value.trim().toLowerCase();
    renderInbox();
  });

  const newBtn = document.getElementById('rl-new');
  const newPop = el('div', 'rl-new-pop hidden');
  document.getElementById('view-relay').append(newPop);
  function renderNewPop() {
    newPop.textContent = '';
    newPop.append(el('div', 'rl-sect', 'Nauja žinutė'));
    if (!friends.length) {
      newPop.append(el('div', 'fr-empty', 'Pirmiausia pridėk draugų.'));
      return;
    }
    friends.forEach((f) => {
      const r = el('div', 'rl-row');
      const img = el('img', 'rl-head');
      img.src = headUrl(f.nick, 34);
      const m = el('div', 'rl-meta');
      m.append(el('b', null, f.nick));
      r.append(img, m);
      r.addEventListener('click', () => { newPop.classList.add('hidden'); openConvo(f.nick); });
      newPop.append(r);
    });
  }
  newBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    renderNewPop();
    newPop.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!newPop.contains(e.target) && !newBtn.contains(e.target)) newPop.classList.add('hidden');
  });

  refreshInbox();
  setInterval(refreshInbox, 15000);
  setInterval(() => { if (current && relayActive() && document.hasFocus()) loadNew(); }, 4000);
  window.addEventListener('focus', () => { if (current && relayActive()) { loadNew(); refreshInbox(); } });
  railRelay.addEventListener('click', refreshInbox);
})();
