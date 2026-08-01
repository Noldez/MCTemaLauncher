(() => {
  const { $, el } = window.ui;
  let q = '';
  let busy = new Set();

  const REQ_META = {
    'mctemaclient.jar': { name: 'MC Tema Client', author: 'ただし', discord: 'noldez', desc: 'Oficialus klientas - apsauga ir auto-login' },
    'fabric-api.jar': { name: 'Fabric API', author: 'FabricMC', desc: 'Bazinė modų biblioteka' },
  };

  const fmtSize = (b) => b ? `${(b / 1048576).toFixed(2)}MB` : '';

  function row({ icon, faIcon, name, author, discord, version, size, locked, enabled, installed, available, id }) {
    const r = el('div', 'modrow');
    const ic = el('span', 'mr-ic');
    if (icon) {
      const img = el('img');
      img.src = icon;
      img.onerror = () => { ic.textContent = ''; ic.innerHTML = '<i class="fa-solid fa-cube"></i>'; };
      ic.append(img);
    } else {
      ic.innerHTML = `<i class="fa-solid ${faIcon || 'fa-cube'}"></i>`;
    }
    const meta = el('div', 'mr-meta');
    const by = el('span', null, `Sukūrė ${author}`);
    if (discord) by.title = `Discord: ${discord}`;
    meta.append(el('b', null, name), by);
    const info = el('span', 'mr-info', [version ? `v${version}` : '', fmtSize(size)].filter(Boolean).join('  ·  '));
    r.append(ic, meta, info);

    const state = el('span', 'mr-state', locked ? 'Privalomas' : 'Enabled');
    const check = el('button', 'mr-check' + ((locked || enabled) ? ' on' : '') + (busy.has(id) ? ' busy' : ''));
    check.innerHTML = busy.has(id) ? '<i class="fa-solid fa-spinner fa-spin"></i>' : '<i class="fa-solid fa-check"></i>';
    if (locked) {
      check.disabled = true;
      check.title = 'Privalomas modas';
    } else {
      check.title = enabled ? 'Išjungti' : (installed ? 'Įjungti' : 'Atsisiųsti ir įjungti');
      if (!available && !installed) { check.disabled = true; check.title = 'Nepasiekiamas'; }
      check.addEventListener('click', async () => {
        if (busy.has(id)) return;
        busy.add(id);
        render();
        const res = await window.api.toggleOMod({ id, enabled: !enabled });
        busy.delete(id);
        if (!res.ok) document.dispatchEvent(new CustomEvent('notify', { detail: { text: res.error, kind: 'error' } }));
        load();
      });
    }
    r.append(state, check);

    const gear = el('button', 'mr-gear');
    gear.innerHTML = '<i class="fa-solid fa-gear"></i>';
    gear.disabled = true;
    r.append(gear);

    if (!locked) {
      const del = el('button', 'mr-del');
      del.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
      del.title = 'Pašalinti atsisiųstą modą';
      del.disabled = !installed;
      del.addEventListener('click', async () => { await window.api.removeOMod(id); load(); });
      r.append(del);
    }
    return r;
  }

  const match = (n) => n.toLowerCase().includes(q);

  async function load() {
    const [req, opt] = await Promise.all([window.api.listMods(), window.api.listOMods()]);
    $('mods-count').textContent = `${req.length + opt.filter((m) => m.enabled).length} modų įkelta`;

    const sugg = $('mods-sugg');
    sugg.textContent = '';
    opt.filter((m) => !m.third && !m.installed).forEach((m) => {
      const c = el('button', 'sugg' + (busy.has(m.id) ? ' busy' : ''));
      const ic = el('span', 'sugg-ic');
      if (m.icon) { const img = el('img'); img.src = m.icon; ic.append(img); }
      else ic.innerHTML = '<i class="fa-solid fa-cube"></i>';
      c.append(ic, el('b', null, m.name));
      c.append(el('i', busy.has(m.id) ? 'fa-solid fa-spinner fa-spin sugg-plus' : 'fa-solid fa-plus sugg-plus'));
      c.title = m.available ? `Įdiegti ${m.name}` : 'Nepasiekiamas';
      c.disabled = !m.available || busy.has(m.id);
      c.addEventListener('click', async () => {
        busy.add(m.id);
        load();
        const res = await window.api.toggleOMod({ id: m.id, enabled: true });
        busy.delete(m.id);
        if (!res.ok) document.dispatchEvent(new CustomEvent('notify', { detail: { text: res.error, kind: 'error' } }));
        load();
      });
      sugg.append(c);
    });
    if (!sugg.children.length) sugg.append(el('span', 'sugg-none', 'Visi įdiegti'));

    const box = $('mods-installed');
    box.textContent = '';
    req.filter((m) => match(m.file)).forEach((m) => {
      const meta = REQ_META[m.file] || { name: m.file.replace(/\.jar$/, ''), author: 'MC Tema' };
      box.append(row({ faIcon: 'fa-shield-halved', name: meta.name, author: meta.author, discord: meta.discord, size: m.size, locked: true }));
    });
    opt.filter((m) => m.installed && match(m.name)).forEach((m) => box.append(row(m)));
    if (!box.children.length) box.append(el('div', 'mr-empty', 'Nieko nerasta.'));
  }
  function render() { load(); }

  let mrTimer = null;
  async function searchModrinth() {
    const box = $('mods-mr');
    if (q.length < 2) { box.textContent = ''; return; }
    const hits = await window.api.searchModrinth(q);
    box.textContent = '';
    if (!hits.length) return;
    box.append(el('div', 'mr-src', 'Modrinth paieška'));
    hits.forEach((h) => {
      const r = el('div', 'modrow');
      const ic = el('span', 'mr-ic');
      if (h.icon) { const img = el('img'); img.src = h.icon; ic.append(img); }
      else ic.innerHTML = '<i class="fa-solid fa-cube"></i>';
      const meta = el('div', 'mr-meta');
      meta.append(el('b', null, h.name), el('span', null, `Sukūrė ${h.author} · ${h.downloads.toLocaleString('lt-LT')} atsisiuntimų`));
      const add = el('button', 'mr-add');
      add.innerHTML = '<i class="fa-solid fa-plus"></i>';
      add.title = 'Pridėti (1.21.11 Fabric)';
      add.addEventListener('click', async () => {
        add.disabled = true;
        add.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        const res = await window.api.addModrinthMod({ slug: h.slug, name: h.name, author: h.author, icon: h.icon });
        if (!res.ok) {
          document.dispatchEvent(new CustomEvent('notify', { detail: { text: `${h.name}: ${res.error}`, kind: 'error' } }));
          add.disabled = false;
          add.innerHTML = '<i class="fa-solid fa-plus"></i>';
          return;
        }
        load();
      });
      r.append(ic, meta, add);
      box.append(r);
    });
  }

  const drop = $('mods-drop');
  const filePick = $('mods-file');
  async function addFileList(files) {
    for (const f of Array.from(files)) {
      if (!f.name.toLowerCase().endsWith('.jar')) {
        document.dispatchEvent(new CustomEvent('notify', { detail: { text: `${f.name}: tik .jar failai`, kind: 'error' } }));
        continue;
      }
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = '';
      const CH = 0x8000;
      for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
      const res = await window.api.addLocalMod({ name: f.name, data: btoa(bin) });
      document.dispatchEvent(new CustomEvent('notify', {
        detail: res.ok ? { text: `${f.name} pridėtas.`, kind: 'info' } : { text: `${f.name}: ${res.error}`, kind: 'error' },
      }));
    }
    load();
  }
  drop.addEventListener('click', () => filePick.click());
  filePick.addEventListener('change', (e) => { addFileList(e.target.files); e.target.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    addFileList(e.dataTransfer.files);
  });

  $('mod-q').addEventListener('input', (e) => {
    q = e.target.value.trim().toLowerCase();
    load();
    clearTimeout(mrTimer);
    mrTimer = setTimeout(searchModrinth, 350);
  });
  $('mods-refresh').addEventListener('click', load);
  $('mods-folder').addEventListener('click', () => window.api.openFolder());
  document.querySelector('.rail-btn[data-view="mods"]').addEventListener('click', load);
  load();
})();
