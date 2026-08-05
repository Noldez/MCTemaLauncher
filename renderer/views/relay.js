(() => {
  const { el, headUrl, faceUrl, fmtAgo } = window.ui;
  const listBox = document.getElementById('rl-list');
  const chatPane = document.getElementById('rl-chat');
  const railRelay = document.querySelector('.rail-btn[data-view="relay"]');
  const SITE = 'https://mctema.lt/api';

  let inbox = [];
  let groups = [];
  let pins = [];
  let friends = [];
  let inboxOk = true;
  // The open conversation: {kind:'dm', nick} or {kind:'group', id}. Both go
  // through the same render path, they differ only in where messages come from.
  let current = null;
  let lastId = 0;
  let msgsBox = null;
  let lastDay = '';
  let listFilter = '';
  const collapsed = {};
  // Loaded messages by id, so a reply can quote the line it answers.
  const byId = new Map();
  let theyReadUpTo = 0;
  let replyTo = null;
  let editing = null;
  let typingBox = null;
  let setReplyTo = () => {};
  let startEdit = () => {};
  let showTyping = () => {};
  // Points at the open conversation's uploader. The drop listeners below are
  // wired once against the pane, which outlives every conversation - binding
  // them per conversation stacked a handler each time and sent the same file
  // once per reopen.
  let sendImageFile = () => {};

  const dropZone = el('div', 'rl-drop hidden');
  dropZone.append(el('i', 'fa-solid fa-image'), el('span', null, 'Paleisk, kad išsiųstum'));
  const hasFile = (e) => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files');
  let dragDepth = 0;
  chatPane.addEventListener('dragenter', (e) => {
    if (!current || !hasFile(e)) return;
    e.preventDefault();
    dragDepth++;
    dropZone.classList.remove('hidden');
  });
  chatPane.addEventListener('dragover', (e) => { if (current && hasFile(e)) e.preventDefault(); });
  chatPane.addEventListener('dragleave', () => {
    // dragleave fires for every child crossed, so count instead of hiding on
    // the first one.
    if (--dragDepth <= 0) { dragDepth = 0; dropZone.classList.add('hidden'); }
  });
  chatPane.addEventListener('drop', (e) => {
    if (!current || !hasFile(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dropZone.classList.add('hidden');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    sendImageFile(file);
  });

  const relayActive = () => document.getElementById('view-relay').classList.contains('active');
  const isDm = (c) => c && c.kind === 'dm';
  const sameConvo = (a, b) => !!a && !!b && a.kind === b.kind &&
    (a.kind === 'dm' ? a.nick.toLowerCase() === b.nick.toLowerCase() : Number(a.id) === Number(b.id));
  const pinnedDm = (nick) => pins.some((p) => p.kind === 'dm' && p.target.toLowerCase() === nick.toLowerCase());
  const pinnedGroup = (id) => pins.some((p) => p.kind === 'group' && Number(p.target) === Number(id));
  const groupById = (id) => groups.find((g) => Number(g.id) === Number(id));
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

    // A row is the same shape for a person and for a group; only the avatar
    // and what a click opens differ.
    // Groups wear their members' heads, like the reference, rather than a
    // generic icon - at a glance you can tell one group from another.
    function convoRow(conv, opts) {
      const r = el('div', 'rl-row' + (sameConvo(current, conv) ? ' active' : ''));
      const av = el('span', 'rl-av');
      if (opts.group) {
        av.append(groupAvatar(opts.members, opts.icon));
      } else {
        const img = el('img', 'rl-head');
        img.src = headUrl(opts.title, 38);
        av.append(img);
        // Always show the dot - grey reads as "offline", missing reads as a bug.
        av.append(el('i', 'rl-dot' + (opts.online ? ' on' : '')));
      }
      if (opts.unread) av.append(el('span', 'rl-unread', String(opts.unread)));
      r.append(av);

      const m = el('div', 'rl-meta');
      const top = el('div', 'rl-top');
      top.append(el('b', null, opts.title));
      if (opts.at) top.append(el('em', null, fmtAgo(opts.at).replace('prieš ', '')));
      const sub = el('span');
      // An icon, not an emoji - the UI font has no glyph for 📷 and it renders
      // as an empty box.
      if (opts.image) sub.append(el('i', 'fa-solid fa-image rl-sub-ic'));
      sub.append(document.createTextNode(opts.sub));
      m.append(top, sub);
      r.append(m);

      const pin = el('button', 'rl-pin' + (opts.pinned ? ' on' : ''));
      pin.title = opts.pinned ? 'Atsegti' : 'Prisegti';
      pin.append(el('i', 'fa-solid fa-thumbtack'));
      pin.addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.api.chatPin({
          kind: conv.kind, target: conv.kind === 'dm' ? conv.nick : String(conv.id), pinned: !opts.pinned,
        });
        refreshInbox();
      });
      r.append(pin);
      r.addEventListener('click', () => openConvo(conv));
      return r;
    }

    // A group wears its own picture when it has one, otherwise its members'
    // faces. Flat faces, not the 3D render - those tile badly.
    function groupAvatar(members, icon) {
      const box = el('span', 'rl-gav');
      if (icon) {
        const img = el('img');
        img.src = icon.startsWith('http') ? icon : SITE + icon;
        box.append(img);
        box.classList.add('n1', 'custom');
        return box;
      }
      (members || []).slice(0, 4).forEach((nick) => {
        const h = el('img');
        h.src = faceUrl(nick, 20);
        box.append(h);
      });
      if (!box.children.length) box.append(el('i', 'fa-solid fa-user-group'));
      box.classList.add('n' + Math.min(4, (members || []).length || 1));
      return box;
    }

    const dmRow = (c) => convoRow({ kind: 'dm', nick: c.nick }, {
      title: c.nick,
      sub: c.lastBody,
      image: c.lastKind === 'image',
      at: c.lastAt, unread: c.unread, online: isOn(c.nick), pinned: pinnedDm(c.nick),
    });
    const groupRow = (g) => convoRow({ kind: 'group', id: g.id }, {
      group: true,
      members: g.members,
      icon: g.icon,
      title: g.name,
      sub: g.lastFrom ? `${g.lastFrom}: ${g.lastBody}` : `${g.members.length} nariai`,
      at: g.lastAt, unread: g.unread, pinned: pinnedGroup(g.id),
    });

    const convos = inbox.filter((c) => match(c.nick));
    const grps = groups.filter((g) => !listFilter || g.name.toLowerCase().includes(listFilter));

    // Collapsible section, remembered while the launcher is open.
    function section(key, label, rows) {
      if (!rows.length) return;
      const head = el('button', 'rl-sect' + (collapsed[key] ? ' off' : ''));
      head.append(el('i', 'fa-solid fa-chevron-down'), el('span', null, label));
      const body = el('div', 'rl-sect-body' + (collapsed[key] ? ' hidden' : ''));
      rows.forEach((r) => body.append(r));
      head.addEventListener('click', () => {
        collapsed[key] = !collapsed[key];
        head.classList.toggle('off', collapsed[key]);
        body.classList.toggle('hidden', collapsed[key]);
      });
      listBox.append(head, body);
    }

    section('pinned', 'Prisegta', [
      ...grps.filter((g) => pinnedGroup(g.id)).map(groupRow),
      ...convos.filter((c) => pinnedDm(c.nick)).map(dmRow),
    ]);
    section('groups', 'Grupės', grps.filter((g) => !pinnedGroup(g.id)).map(groupRow));
    section('dms', 'Žinutės', convos.filter((c) => !pinnedDm(c.nick)).map(dmRow));
    const rest = friends.filter((f) => !convoNicks.has(f.nick.toLowerCase()) && match(f.nick));
    if (rest.length) {
      listBox.append(el('div', 'rl-sect plain', 'Draugai'));
      rest.forEach((f) => {
        const r = el('div', 'rl-row');
        const av = el('span', 'rl-av');
        const img = el('img', 'rl-head');
        img.src = headUrl(f.nick, 34);
        av.append(img, el('i', 'rl-dot' + (f.online || f.inLauncher ? ' on' : '')));
        const m = el('div', 'rl-meta');
        const top = el('div', 'rl-top');
        top.append(el('b', null, f.nick));
        m.append(top, el('span', null,
          f.online ? 'Žaidžia: MC Tema' : f.inLauncher ? 'Launcheryje' : 'Parašyk žinutę'));
        r.append(av, m);
        r.addEventListener('click', () => openConvo({ kind: 'dm', nick: f.nick }));
        listBox.append(r);
      });
    }
    if (!convos.length && !rest.length && !grps.length) {
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
        const reading = focused && isDm(current) && current.nick.toLowerCase() === key;
        const toastsOn = !window.ui.state.cfg || window.ui.state.cfg.toasts !== false;
        if ((c.unread || 0) > (prevUnread[key] || 0) && !reading) {
          if (toastsOn) window.api.nativeNotify({
            title: c.nick,
            body: c.lastKind === 'image' ? 'Nuotrauka' : c.lastBody,
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

  // Groups notify too, and a message that names you says so.
  let prevGroupUnread = null;
  function toastGroupMessages() {
    const focused = document.hasFocus();
    if (prevGroupUnread && !window.ui.state.gameRunning) {
      for (const g of groups) {
        const reading = focused && !isDm(current) && current && Number(current.id) === Number(g.id);
        const toastsOn = !window.ui.state.cfg || window.ui.state.cfg.toasts !== false;
        if ((g.unread || 0) > (prevGroupUnread[g.id] || 0) && !reading) {
          const mention = mentionsMe(g.lastBody);
          const text = mention
            ? `${g.lastFrom} paminėjo tave grupėje ${g.name}`
            : `${g.name}: ${g.lastFrom}`;
          if (toastsOn) window.api.nativeNotify({ title: g.name, body: `${g.lastFrom}: ${g.lastBody}`, nick: g.lastFrom });
          document.dispatchEvent(new CustomEvent('notify', {
            detail: { text, kind: mention ? 'error' : 'info' },
          }));
        }
      }
    }
    prevGroupUnread = Object.fromEntries(groups.map((g) => [g.id, g.unread || 0]));
  }

  async function refreshInbox() {
    const [ir, fr] = await Promise.all([window.api.chatInbox(), window.api.friendsList()]);
    inboxOk = !!ir.ok;
    if (ir.ok) {
      inbox = (ir.inbox || []).sort((a, b) => b.lastAt - a.lastAt);
      groups = (ir.groups || []).sort((a, b) => b.lastAt - a.lastAt);
      pins = ir.pins || [];
    }
    if (fr.ok) friends = fr.friends || [];
    const unread = inbox.reduce((s, c) => s + (c.unread || 0), 0) +
      groups.reduce((s, g) => s + (g.unread || 0), 0);
    railRelay.classList.toggle('badged', unread > 0);
    if (ir.ok) { toastNewMessages(); toastGroupMessages(); }
    renderInbox();
  }

  const myNick = () => (window.ui.state.cfg && window.ui.state.cfg.username) || '';
  const MENTION_RE = /@([A-Za-z0-9_]{3,16})/g;
  const mentionsMe = (text) => {
    const me = myNick().toLowerCase();
    if (!me) return false;
    return [...String(text || '').matchAll(MENTION_RE)].some((m) => m[1].toLowerCase() === me);
  };

  // Mentions and links in one pass, so neither can swallow the other.
  const TOKEN_RE = /(@[A-Za-z0-9_]{3,16})|(https?:\/\/[^\s<>"']+)/g;

  /**
   * Message text with @nicks and links picked out. Built from text nodes
   * rather than innerHTML - the body is whatever another player typed, and a
   * link opens in the system browser rather than anywhere in here.
   */
  function renderBody(text) {
    const box = el('span', 'bub-body');
    const src = String(text || '');
    const me = myNick().toLowerCase();
    let last = 0;
    for (const match of src.matchAll(TOKEN_RE)) {
      if (match.index > last) box.append(document.createTextNode(src.slice(last, match.index)));
      if (match[1]) {
        const hit = match[1].slice(1).toLowerCase() === me;
        box.append(el('span', 'mention' + (hit ? ' me' : ''), match[1]));
      } else {
        // Trailing punctuation is almost never part of the address.
        const raw = match[2];
        const trimmed = raw.replace(/[).,!?;:]+$/, '');
        const a = el('span', 'msg-link', trimmed);
        a.title = trimmed;
        a.addEventListener('click', (e) => { e.stopPropagation(); window.ui.openUrl(trimmed); });
        box.append(a);
        if (raw.length > trimmed.length) {
          box.append(document.createTextNode(raw.slice(trimmed.length)));
        }
      }
      last = match.index + match[0].length;
    }
    if (last < src.length) box.append(document.createTextNode(src.slice(last)));
    return box;
  }

  // Link previews. The metadata is fetched by mctema.lt, not here - see the
  // comment on the IPC handler - and the thumbnail comes back through our own
  // proxy so the CSP stays as tight as it is.
  const previewCache = new Map();

  function linkCard(text, host) {
    const match = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
    if (!match) return null;
    const url = match[0].replace(/[).,!?]+$/, '');

    const card = el('button', 'link-card');
    let hostname;
    try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }

    const body = el('span', 'lc-body');
    const site = el('span', 'lc-site', hostname);
    const title = el('b', null, url.length > 70 ? url.slice(0, 70) + '…' : url);
    const desc = el('span', 'lc-desc');
    body.append(site, title, desc);
    card.append(body);
    card.addEventListener('click', (e) => { e.stopPropagation(); window.ui.openUrl(url); });

    const fill = (p) => {
      if (!p) return;
      if (p.site) site.textContent = p.site;
      if (p.title) title.textContent = p.title;
      if (p.description) desc.textContent = p.description;
      if (p.image) {
        const thumb = el('img', 'lc-thumb');
        thumb.src = SITE.replace('/api', '') + p.image;
        thumb.addEventListener('error', () => thumb.remove());
        card.prepend(thumb);
      }
      card.classList.add('rich');

      // Video and audio links get the big poster instead of the small thumb.
      // Nothing from the other site runs in here - the card is a picture of the
      // link, and clicking it hands the whole thing to the system browser.
      if (p.embed) {
        card.classList.add('media', p.shape || 'video');
        const stage = el('div', 'lc-stage');
        if (p.image) {
          const poster = el('img', 'lc-poster');
          poster.src = SITE.replace('/api', '') + p.image;
          poster.addEventListener('error', () => poster.remove());
          stage.append(poster);
        }
        const play = el('span', 'lc-play');
        play.innerHTML = '<i class="fa-solid fa-play"></i>';
        stage.append(play);
        card.prepend(stage);
        const thumb = card.querySelector('.lc-thumb');
        if (thumb) thumb.remove();
      }
    };

    if (previewCache.has(url)) {
      fill(previewCache.get(url));
    } else {
      window.api.chatUnfurl(url).then((r) => {
        const p = r && r.ok ? r.preview : null;
        previewCache.set(url, p);
        // The conversation may have moved on while we waited.
        if (host && host.isConnected) fill(p);
      }).catch(() => {});
    }
    return card;
  }

  // Discord-style rows rather than bubbles: avatar, name, then the lines. A
  // run of messages from the same person within a few minutes collapses into
  // one block, which is what makes a busy conversation readable.
  let lastAuthor = '';
  let lastStamp = 0;

  function messageActions(m, mine) {
    const acts = el('div', 'dm-acts');
    const reply = el('button', null);
    reply.title = 'Atsakyti';
    reply.innerHTML = '<i class="fa-solid fa-reply"></i>';
    reply.addEventListener('click', () => setReplyTo(m));
    acts.append(reply);
    if (mine) {
      if (m.kind !== 'image') {
        const edit = el('button', null);
        edit.title = 'Redaguoti';
        edit.innerHTML = '<i class="fa-solid fa-pen"></i>';
        edit.addEventListener('click', () => startEdit(m));
        acts.append(edit);
      }
      const del = el('button', 'danger');
      del.title = 'Ištrinti';
      del.innerHTML = '<i class="fa-solid fa-trash"></i>';
      del.addEventListener('click', async () => {
        const r = await window.api.chatDelete(m.id);
        if (!r.ok) document.dispatchEvent(new CustomEvent('notify', { detail: { text: r.error, kind: 'error' } }));
        reloadAll();
      });
      acts.append(del);
    }
    return acts;
  }

  function replyQuote(m) {
    const src = byId.get(m.replyTo);
    const q = el('div', 'dm-reply');
    q.append(el('i', 'fa-solid fa-reply'));
    q.append(el('b', null, src ? src.from : 'žinutė'));
    q.append(el('span', null, src
      ? (src.deleted ? 'ištrinta' : (src.kind === 'image' ? 'nuotrauka' : src.body))
      : 'ištrinta'));
    q.addEventListener('click', () => {
      const node = msgsBox.querySelector(`[data-mid="${m.replyTo}"]`);
      if (!node) return;
      node.scrollIntoView({ block: 'center' });
      node.classList.add('flash');
      setTimeout(() => node.classList.remove('flash'), 900);
    });
    return q;
  }

  function imageBlock(m) {
    const src = SITE + m.body;
    const name = m.fileName || 'nuotrauka';
    const when = time(m.at);
    const fig = el('figure', 'msg-img');
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
    cap.append(el('em', null, name));
    fig.append(frame, cap);
    return fig;
  }

  function appendMessage(m) {
    // A deleted message leaves nothing behind. The row still exists server-side
    // so replies pointing at it resolve, and those show "ištrinta" in the quote.
    if (m.deleted) return;
    const me = myNick().toLowerCase();
    const mine = m.from.toLowerCase() === me;

    const d = dayOf(m.at);
    if (d !== lastDay) {
      lastDay = d;
      lastAuthor = '';
      const div = el('div', 'rl-date');
      div.append(el('span', null, new Date(m.at).toLocaleDateString('lt-LT', { month: 'long', day: 'numeric' })));
      msgsBox.append(div);
    }

    // A reply always starts a fresh block: it needs its own quote above it.
    const runOn = m.from === lastAuthor && !m.replyTo && (m.at - lastStamp) < 5 * 60 * 1000;
    const row = el('div', 'dm-msg' + (mine ? ' mine' : '') + (runOn ? ' cont' : '')
      + (mentionsMe(m.body) ? ' hit' : ''));
    row.dataset.mid = String(m.id);

    const gutter = el('div', 'dm-gutter');
    if (runOn) {
      gutter.append(el('span', 'dm-hovertime', time(m.at)));
    } else {
      const av = el('img', 'dm-av');
      av.src = headUrl(m.from, 40);
      av.addEventListener('click', () => { if (!mine) openConvo({ kind: 'dm', nick: m.from }); });
      gutter.append(av);
    }
    row.append(gutter);

    const body = el('div', 'dm-body');
    if (m.replyTo) body.append(replyQuote(m));
    if (!runOn) {
      const head = el('div', 'dm-head');
      head.append(el('b', 'dm-name' + (mine ? ' me' : ''), m.from), el('em', null, time(m.at)));
      body.append(head);
    }

    if (m.kind === 'image') {
      body.append(imageBlock(m));
    } else {
      const line = el('div', 'dm-line');
      line.append(renderBody(m.body));
      if (m.edited) line.append(el('i', 'dm-edited', 'redaguota'));
      body.append(line);
      const card = linkCard(m.body, body);
      if (card) body.append(card);
    }

    row.append(body, messageActions(m, mine));
    msgsBox.append(row);
    lastAuthor = m.from;
    lastStamp = m.at;
  }

  /** One "Matyta" under the newest of my messages they have read, not a tick
   *  on every bubble. */
  function updateSeenLine() {
    if (!msgsBox) return;
    const old = msgsBox.querySelector('.rl-seen');
    if (old) old.remove();
    if (!isDm(current) || !theyReadUpTo) return;
    const bubbles = [...msgsBox.querySelectorAll('.dm-msg')].filter((n) => { const b = byId.get(Number(n.dataset.mid)); return b && b.from.toLowerCase() === myNick().toLowerCase(); });
    const last = bubbles.reverse().find((n) => {
      return Number(n.dataset.mid) <= theyReadUpTo;
    });
    if (!last) return;
    // Sits on the timestamp line rather than on a line of its own.
    const meta = last.querySelector('.dm-body');
    if (!meta) return;
    const seen = el('div', 'rl-seen');
    seen.append(el('i', 'fa-solid fa-check-double'), el('span', null, 'Matyta'));
    meta.append(seen);
  }

  /** Ask which friend to add, then add them. Friends-only is enforced server-side too. */
  function addMemberPrompt(group) {
    const inGroup = new Set(group.members.map((n) => n.toLowerCase()));
    const options = friends.filter((f) => !inGroup.has(f.nick.toLowerCase()));
    if (!options.length) {
      document.dispatchEvent(new CustomEvent('notify', {
        detail: { text: 'Visi tavo draugai jau grupėje.', kind: 'info' },
      }));
      return;
    }
    pickNicks({
      title: `Pridėti į ${group.name}`,
      options,
      single: true,
      onPick: async (picked) => {
        const r = await window.api.groupAddMember({ id: group.id, nick: picked[0] });
        if (!r.ok) {
          document.dispatchEvent(new CustomEvent('notify', { detail: { text: r.error, kind: 'error' } }));
          return;
        }
        await refreshInbox();
        const fresh = groupById(group.id);
        if (fresh) openConvo({ kind: 'group', id: fresh.id });
      },
    });
  }

  /** Small modal for choosing friends, shared by group creation and adding. */
  function pickNicks({ title, options, single, confirmLabel, onPick, nameField }) {
    const chosen = new Set();
    const overlay = el('div', 'rl-modal');
    const box = el('div', 'rl-modal-box');
    box.append(el('div', 'rl-modal-title', title));

    let nameInput = null;
    if (nameField) {
      nameInput = el('input', 'rl-modal-name');
      nameInput.placeholder = 'Grupės pavadinimas';
      nameInput.maxLength = 40;
      box.append(nameInput);
    }

    const list = el('div', 'rl-modal-list');
    options.forEach((f) => {
      const row = el('button', 'rl-modal-row');
      const img = el('img', 'rl-head');
      img.src = headUrl(f.nick, 28);
      row.append(img, el('b', null, f.nick));
      row.addEventListener('click', () => {
        if (single) {
          chosen.clear();
          [...list.children].forEach((c) => c.classList.remove('on'));
        }
        if (chosen.has(f.nick)) chosen.delete(f.nick);
        else chosen.add(f.nick);
        row.classList.toggle('on', chosen.has(f.nick));
      });
      list.append(row);
    });
    box.append(list);

    const acts = el('div', 'rl-modal-acts');
    const cancel = el('button', null, 'Atšaukti');
    const ok = el('button', 'primary', confirmLabel || 'Pridėti');
    cancel.addEventListener('click', () => overlay.remove());
    ok.addEventListener('click', async () => {
      if (!chosen.size && !nameField) return;
      const name = nameInput ? nameInput.value.trim() : null;
      if (nameField && !name) { nameInput.focus(); return; }
      overlay.remove();
      await onPick([...chosen], name);
    });
    acts.append(cancel, ok);
    box.append(acts);

    overlay.append(box);
    document.body.append(overlay);
    if (nameInput) nameInput.focus();
  }

  /** Rename a group and give it a picture. Any member may do both. */
  function editGroupPrompt(group) {
    const overlay = el('div', 'rl-modal');
    const box = el('div', 'rl-modal-box');
    box.append(el('div', 'rl-modal-title', 'Grupės nustatymai'));

    const iconRow = el('div', 'rl-icon-row');
    const preview = el('span', 'rl-icon-prev');
    const drawPreview = (src) => {
      preview.textContent = '';
      if (src) {
        const img = el('img');
        img.src = src.startsWith('http') ? src : SITE + src;
        preview.append(img);
      } else {
        group.members.slice(0, 4).forEach((nick) => {
          const h = el('img');
          h.src = faceUrl(nick, 20);
          preview.append(h);
        });
        preview.className = 'rl-icon-prev rl-gav n' + Math.min(4, group.members.length || 1);
      }
    };
    drawPreview(group.icon);

    const pick = el('input');
    pick.type = 'file';
    pick.accept = 'image/*';
    pick.hidden = true;
    const pickBtn = el('button', 'shop-topup');
    pickBtn.innerHTML = '<i class="fa-solid fa-image"></i> Keisti paveikslėlį';
    pickBtn.addEventListener('click', () => pick.click());
    let pendingIcon = null;
    pick.addEventListener('change', async () => {
      const file = pick.files[0];
      pick.value = '';
      if (!file) return;
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      const CH = 0x8000;
      for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
      const b64 = btoa(bin);
      pendingIcon = { name: file.name, data: b64 };
      preview.className = 'rl-icon-prev';
      preview.textContent = '';
      const img = el('img');
      // A data: URL, not createObjectURL - the CSP allows data: but not blob:,
      // so an object URL is blocked and the preview silently stays empty.
      img.src = `data:${file.type || 'image/png'};base64,${b64}`;
      preview.append(img);
    });
    iconRow.append(preview, pickBtn, pick);
    box.append(iconRow);

    const nameInput = el('input', 'rl-modal-name');
    nameInput.placeholder = 'Grupės pavadinimas';
    nameInput.maxLength = 40;
    nameInput.value = group.name;
    box.append(nameInput);

    const acts = el('div', 'rl-modal-acts');
    const cancel = el('button', null, 'Atšaukti');
    const save = el('button', 'primary', 'Išsaugoti');
    cancel.addEventListener('click', () => overlay.remove());
    save.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      save.disabled = true;
      if (name !== group.name) {
        const r = await window.api.groupRename({ id: group.id, name });
        if (!r.ok) {
          save.disabled = false;
          document.dispatchEvent(new CustomEvent('notify', { detail: { text: r.error, kind: 'error' } }));
          return;
        }
      }
      if (pendingIcon) {
        const r = await window.api.groupIcon({ id: group.id, ...pendingIcon });
        if (!r.ok) {
          save.disabled = false;
          document.dispatchEvent(new CustomEvent('notify', { detail: { text: r.error, kind: 'error' } }));
          return;
        }
      }
      overlay.remove();
      await refreshInbox();
      const fresh = groupById(group.id);
      if (fresh) openConvo({ kind: 'group', id: fresh.id });
    });
    acts.append(cancel, save);
    box.append(acts);

    overlay.append(box);
    document.body.append(overlay);
    nameInput.focus();
  }

  function createGroupPrompt() {
    pickNicks({
      title: 'Nauja grupė',
      options: friends,
      nameField: true,
      confirmLabel: 'Sukurti',
      onPick: async (members, name) => {
        const r = await window.api.groupCreate({ name, members });
        if (!r.ok) {
          document.dispatchEvent(new CustomEvent('notify', { detail: { text: r.error, kind: 'error' } }));
          return;
        }
        await refreshInbox();
        openConvo({ kind: 'group', id: r.id });
      },
    });
  }

  async function fetchHistory(after) {
    return isDm(current)
      ? window.api.chatHistory({ with: current.nick, after })
      : window.api.groupHistory({ id: current.id, after });
  }

  async function loadNew() {
    if (!current) return;
    const r = await fetchHistory(lastId);
    if (!r.ok || !msgsBox) return;
    theyReadUpTo = r.theyReadUpTo || theyReadUpTo;
    showTyping(r.typing || []);
    const nearBottom = msgsBox.scrollHeight - msgsBox.scrollTop - msgsBox.clientHeight < 120;
    for (const m of (r.messages || [])) {
      byId.set(m.id, m);
      appendMessage(m);
      lastId = Math.max(lastId, m.id);
    }
    updateSeenLine();
    if ((r.messages || []).length && nearBottom) msgsBox.scrollTop = msgsBox.scrollHeight;
  }

  /**
   * Edits and deletes rewrite existing lines, so redraw the whole thread.
   * Rendered into a detached node and swapped in one go - clearing first left
   * the pane blank for as long as the request took.
   */
  async function reloadAll() {
    if (!current || !msgsBox) return;
    const conv = current;
    const keepScroll = msgsBox.scrollTop;
    const wasBottom = msgsBox.scrollHeight - msgsBox.scrollTop - msgsBox.clientHeight < 120;
    const r = await fetchHistory(0);
    if (!r.ok || !msgsBox || !sameConvo(conv, current)) return;

    const live = msgsBox;
    const holder = el('div');
    msgsBox = holder;
    byId.clear();
    lastDay = '';
    lastAuthor = '';
    lastStamp = 0;
    lastId = 0;
    theyReadUpTo = r.theyReadUpTo || 0;
    for (const m of (r.messages || [])) {
      byId.set(m.id, m);
      appendMessage(m);
      lastId = Math.max(lastId, m.id);
    }
    msgsBox = live;
    live.replaceChildren(...holder.childNodes);
    updateSeenLine();
    live.scrollTop = wasBottom ? live.scrollHeight : keepScroll;
    refreshInbox();
  }

  async function openConvo(conv) {
    current = conv;
    lastId = 0;
    lastDay = '';
    chatPane.textContent = '';
    const group = isDm(conv) ? null : groupById(conv.id);
    if (!isDm(conv) && !group) return;
    const title = isDm(conv) ? conv.nick : group.name;

    const head = el('div', 'rl-chat-head');
    if (isDm(conv)) {
      const hImg = el('img', 'rl-head');
      hImg.src = headUrl(conv.nick, 34);
      const hMeta = el('div', 'rl-meta');
      const f = friends.find((x) => x.nick.toLowerCase() === conv.nick.toLowerCase());
      hMeta.append(el('b', null, conv.nick),
        el('span', f && (f.online || f.inLauncher) ? 'fr-st on' : 'fr-st',
          f && f.online ? 'Žaidžia: MC Tema' : f && f.inLauncher ? 'Launcheryje' : 'Neprisijungęs'));
      head.append(hImg, hMeta);
    } else {
      const av = el('span', 'rl-gav big');
      if (group.icon) {
        const gi = el('img');
        gi.src = group.icon.startsWith('http') ? group.icon : SITE + group.icon;
        av.append(gi);
        av.classList.add('n1', 'custom');
      } else {
        av.classList.add('n' + Math.min(4, group.members.length || 1));
        group.members.slice(0, 4).forEach((nick) => {
          const h = el('img');
          h.src = faceUrl(nick, 22);
          av.append(h);
        });
      }
      const hMeta = el('div', 'rl-meta');
      hMeta.append(el('b', null, group.name), el('span', 'fr-st', group.members.join(', ')));
      head.append(av, hMeta);

    }

    // Search inside the open conversation: hides lines that do not match,
    // which is enough without a server-side search endpoint.
    const find = el('label', 'rl-find');
    find.append(el('i', 'fa-solid fa-magnifying-glass'));
    const findInp = el('input');
    findInp.placeholder = 'Ieškoti pokalbyje...';
    findInp.addEventListener('input', () => {
      const q = findInp.value.trim().toLowerCase();
      [...msgsBox.children].forEach((node) => {
        if (node.classList.contains('rl-date')) return;
        const hit = !q || (node.textContent || '').toLowerCase().includes(q);
        node.classList.toggle('hidden', !hit);
      });
    });
    find.append(findInp);
    head.append(find);

    const acts = el('div', 'rl-gacts');
    const pinned = isDm(conv) ? pinnedDm(conv.nick) : pinnedGroup(conv.id);
    const pinBtn = el('button', 'rl-ic' + (pinned ? ' on' : ''));
    pinBtn.title = pinned ? 'Atsegti' : 'Prisegti';
    pinBtn.innerHTML = '<i class="fa-solid fa-thumbtack"></i>';
    pinBtn.addEventListener('click', async () => {
      await window.api.chatPin({
        kind: conv.kind, target: isDm(conv) ? conv.nick : String(conv.id), pinned: !pinned,
      });
      await refreshInbox();
      openConvo(conv);
    });
    acts.append(pinBtn);

    if (!isDm(conv)) {
      const cog = el('button', 'rl-ic');
      cog.title = 'Grupės nustatymai';
      cog.innerHTML = '<i class="fa-solid fa-pen"></i>';
      cog.addEventListener('click', () => editGroupPrompt(group));
      acts.append(cog);
      const add = el('button', 'rl-ic');
      add.title = 'Pridėti draugą';
      add.innerHTML = '<i class="fa-solid fa-user-plus"></i>';
      add.addEventListener('click', () => addMemberPrompt(group));
      const leave = el('button', 'rl-ic danger');
      leave.title = 'Išeiti iš grupės';
      leave.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i>';
      leave.addEventListener('click', async () => {
        const r = await window.api.groupLeave(group.id);
        if (!r.ok) {
          document.dispatchEvent(new CustomEvent('notify', { detail: { text: r.error, kind: 'error' } }));
          return;
        }
        current = null;
        chatPane.textContent = '';
        chatPane.append(el('div', 'fr-empty', 'Išėjai iš grupės.'));
        refreshInbox();
      });
      acts.append(add, leave);
    } else {
      const gal = el('button', 'rl-ic');
      gal.title = 'Nuotraukos pokalbyje';
      gal.innerHTML = '<i class="fa-regular fa-image"></i>';
      gal.addEventListener('click', () => {
        findInp.value = '';
        const imgs = [...msgsBox.querySelectorAll('.msg-img')];
        const showAll = imgs.some((n) => n.classList.contains('hidden'));
        [...msgsBox.children].forEach((node) => {
          if (node.classList.contains('rl-date')) return;
          node.classList.toggle('hidden', !showAll && !node.classList.contains('msg-img'));
        });
      });
      acts.append(gal);
    }
    head.append(acts);

    msgsBox = el('div', 'rl-msgs');

    const inputRow = el('div', 'rl-input');
    const inp = el('textarea', 'rl-ta');
    inp.placeholder = `Rašyk žinutę ${title}...`;
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

    // One upload path for the picker and for a dropped file.
    async function sendImage(file) {
      if (!file || !/^image\//.test(file.type)) return;
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      const CH = 0x8000;
      for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
      const payload = { name: file.name, data: btoa(bin) };
      if (isDm(conv)) payload.to = conv.nick;
      else payload.groupId = conv.id;
      const r = await window.api.chatSendImage(payload);
      if (!r.ok) document.dispatchEvent(new CustomEvent('notify', { detail: { text: r.error, kind: 'error' } }));
      loadNew();
      refreshInbox();
    }
    filePick.addEventListener('change', () => {
      const file = filePick.files[0];
      filePick.value = '';
      sendImage(file);
    });
    const send = el('button', 'rl-send');
    send.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i>';
    // Sits above the input and shows what is being answered or rewritten.
    const context = el('div', 'rl-context hidden');
    const ctxLabel = el('div', 'rl-context-txt');
    const ctxClose = el('button', 'rl-context-x');
    ctxClose.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    ctxClose.addEventListener('click', () => clearContext());
    context.append(ctxLabel, ctxClose);

    function clearContext() {
      replyTo = null;
      editing = null;
      context.classList.add('hidden');
      inp.value = '';
      inp.style.height = 'auto';
    }
    setReplyTo = (m) => {
      editing = null;
      replyTo = m;
      ctxLabel.textContent = '';
      ctxLabel.append(el('b', null, `Atsakai ${m.from}`),
        el('span', null, m.kind === 'image' ? 'nuotrauka' : m.body));
      context.classList.remove('hidden');
      inp.focus();
    };
    startEdit = (m) => {
      replyTo = null;
      editing = m;
      ctxLabel.textContent = '';
      ctxLabel.append(el('b', null, 'Redaguoji žinutę'), el('span', null, m.body));
      context.classList.remove('hidden');
      inp.value = m.body;
      inp.focus();
    };

    async function submit() {
      const v = inp.value.trim();
      if (!v || !current) return;
      const wasEditing = editing;
      const wasReply = replyTo;
      inp.value = '';
      inp.style.height = 'auto';
      clearContext();
      let r;
      if (wasEditing) {
        r = await window.api.chatEdit({ id: wasEditing.id, body: v });
        if (r.ok) { reloadAll(); return; }
      } else {
        const payload = { body: v, replyTo: wasReply ? wasReply.id : null };
        r = isDm(conv)
          ? await window.api.chatSend({ to: conv.nick, ...payload })
          : await window.api.groupSend({ id: conv.id, ...payload });
      }
      if (!r.ok) document.dispatchEvent(new CustomEvent('notify', { detail: { text: r.error, kind: 'error' } }));
      loadNew();
      refreshInbox();
    }
    send.addEventListener('click', submit);
    inp.addEventListener('keydown', (e) => {
      // While the mention list is open it owns the arrows, Enter and Tab.
      if (mentionHits.length) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          mentionIdx = (mentionIdx + (e.key === 'ArrowDown' ? 1 : mentionHits.length - 1)) % mentionHits.length;
          drawMentions();
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          applyMention(mentionHits[mentionIdx]);
          return;
        }
        if (e.key === 'Escape') { e.preventDefault(); closeMentions(); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
      if (e.key === 'Escape') clearContext();
    });

    // @nick completion, groups only - there is nobody to disambiguate in a DM.
    const mentionPop = el('div', 'rl-mention-pop hidden');
    let mentionIdx = 0;
    let mentionHits = [];

    function closeMentions() {
      mentionHits = [];
      mentionPop.classList.add('hidden');
    }

    function applyMention(nick) {
      const upto = inp.value.slice(0, inp.selectionStart);
      const start = upto.lastIndexOf('@');
      if (start < 0) return;
      const after = inp.value.slice(inp.selectionStart);
      inp.value = `${inp.value.slice(0, start)}@${nick} ${after}`;
      const caret = start + nick.length + 2;
      inp.setSelectionRange(caret, caret);
      closeMentions();
      inp.focus();
    }

    function refreshMentions() {
      if (isDm(conv)) return closeMentions();
      const upto = inp.value.slice(0, inp.selectionStart);
      const m = upto.match(/@([A-Za-z0-9_]*)$/);
      if (!m) return closeMentions();
      const q = m[1].toLowerCase();
      const g = groupById(conv.id);
      mentionHits = ((g && g.members) || [])
        .filter((n) => n.toLowerCase() !== myNick().toLowerCase() && n.toLowerCase().startsWith(q))
        .slice(0, 6);
      if (!mentionHits.length) return closeMentions();
      mentionIdx = 0;
      drawMentions();
      mentionPop.classList.remove('hidden');
    }

    function drawMentions() {
      mentionPop.textContent = '';
      mentionHits.forEach((nick, i) => {
        const row = el('button', 'rl-mention-row' + (i === mentionIdx ? ' on' : ''));
        const img = el('img');
        img.src = headUrl(nick, 24);
        row.append(img, el('b', null, nick));
        row.addEventListener('click', () => applyMention(nick));
        mentionPop.append(row);
      });
    }

    // Typing beat, throttled - one call every few seconds while writing, not
    // one per keystroke.
    let lastBeat = 0;
    inp.addEventListener('input', () => {
      refreshMentions();
      const now = Date.now();
      if (now - lastBeat < 3000 || !inp.value.trim()) return;
      lastBeat = now;
      window.api.chatTyping(isDm(conv) ? { to: conv.nick } : { groupId: conv.id });
    });
    inp.addEventListener('blur', () => setTimeout(closeMentions, 150));

    typingBox = el('div', 'rl-typing hidden');
    showTyping = (who) => {
      if (!typingBox) return;
      const names = (who || []).filter(Boolean);
      typingBox.classList.toggle('hidden', !names.length);
      if (names.length) {
        typingBox.textContent = names.length === 1
          ? `${names[0]} rašo...`
          : `${names.length} rašo...`;
      }
    };

    inputRow.append(inp, attach, send);

    sendImageFile = sendImage;
    inputRow.append(mentionPop);
    chatPane.append(dropZone, head, msgsBox, typingBox, context, inputRow);
    byId.clear();
    lastAuthor = '';
    lastStamp = 0;
    theyReadUpTo = 0;
    replyTo = null;
    editing = null;
    await loadNew();
    msgsBox.scrollTop = msgsBox.scrollHeight;
    renderInbox();
    refreshInbox();
    inp.focus();
  }

  /**
   * Pick a conversation and send a screenshot into it. Called from the gallery,
   * which knows about files but nothing about who you talk to.
   */
  window.relayShareShot = (shotPath) => {
    const overlay = el('div', 'rl-modal');
    const box = el('div', 'rl-modal-box');
    box.append(el('div', 'rl-modal-title', 'Siųsti į pokalbį'));
    const list = el('div', 'rl-modal-list');

    const send = async (target) => {
      overlay.remove();
      const r = await window.api.chatSendShot({ path: shotPath, ...target });
      document.dispatchEvent(new CustomEvent('notify', {
        detail: r.ok ? { text: 'Nuotrauka išsiųsta.', kind: 'info' } : { text: r.error, kind: 'error' },
      }));
      if (r.ok) refreshInbox();
    };

    groups.forEach((g) => {
      const row = el('button', 'rl-modal-row');
      const av = el('span', 'rl-gav n' + Math.min(4, g.members.length || 1));
      if (g.icon) {
        const gi = el('img');
        gi.src = g.icon.startsWith('http') ? g.icon : SITE + g.icon;
        av.append(gi);
        av.className = 'rl-gav n1 custom';
      } else {
        g.members.slice(0, 4).forEach((n) => {
          const h = el('img');
          h.src = faceUrl(n, 20);
          av.append(h);
        });
      }
      row.append(av, el('b', null, g.name));
      row.addEventListener('click', () => send({ groupId: g.id }));
      list.append(row);
    });

    const seen = new Set();
    [...inbox.map((c) => c.nick), ...friends.map((f) => f.nick)].forEach((nick) => {
      if (seen.has(nick.toLowerCase())) return;
      seen.add(nick.toLowerCase());
      const row = el('button', 'rl-modal-row');
      const img = el('img', 'rl-head');
      img.src = headUrl(nick, 28);
      row.append(img, el('b', null, nick));
      row.addEventListener('click', () => send({ to: nick }));
      list.append(row);
    });

    if (!list.children.length) list.append(el('div', 'fr-empty', 'Nėra su kuo pasidalinti.'));
    box.append(list);
    const acts = el('div', 'rl-modal-acts');
    const cancel = el('button', null, 'Atšaukti');
    cancel.addEventListener('click', () => overlay.remove());
    acts.append(cancel);
    box.append(acts);
    overlay.append(box);
    document.body.append(overlay);
  };

  // Called from the friends panel and from clicking a message toast, both of
  // which only ever mean a person.
  window.openRelay = (nick) => {
    window.ui.showView('relay');
    openConvo({ kind: 'dm', nick });
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
    const mkGroup = el('div', 'rl-row rl-newgroup');
    const gav = el('span', 'rl-mk');
    const gm = el('div', 'rl-meta');
    const gtop = el('div', 'rl-top');
    gtop.append(el('b', null, 'Nauja grupė'));
    gm.append(gtop, el('span', null, 'Susirašinėk su keliais iš karto'));
    mkGroup.append(gav, gm);
    mkGroup.addEventListener('click', () => { newPop.classList.add('hidden'); createGroupPrompt(); });
    newPop.append(mkGroup);

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
      r.addEventListener('click', () => {
        newPop.classList.add('hidden');
        openConvo({ kind: 'dm', nick: f.nick });
      });
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

  window.ui.bootTask(refreshInbox());
  setInterval(refreshInbox, 8000);
  setInterval(() => { if (current && relayActive() && document.hasFocus()) loadNew(); }, 2500);
  window.addEventListener('focus', () => { if (current && relayActive()) { loadNew(); refreshInbox(); } });
  railRelay.addEventListener('click', refreshInbox);
})();
