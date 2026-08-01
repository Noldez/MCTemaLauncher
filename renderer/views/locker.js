(() => {
  const { $, el, fmtAgo } = window.ui;
  let viewer = null, data = { current: null, skins: [] };

  function ensureViewer() {
    if (viewer || !window.skinview3d) return;
    viewer = new skinview3d.SkinViewer({ canvas: $('lk-canvas'), width: 260, height: 400 });
    viewer.controls.enableZoom = false;
    viewer.animation = new skinview3d.WalkingAnimation();
    viewer.animation.speed = 0.6;
  }

  async function load() {
    data = await window.api.listSkins();
    ensureViewer();
    const cur = data.skins.find((s) => s.id === data.current);
    $('lk-viewer-hint').classList.add('hidden');
    if (viewer) {
      const nick = (window.ui.state.cfg && window.ui.state.cfg.username) || 'MHF_Steve';
      if (cur) viewer.loadSkin(cur.url, { model: cur.variant === 'slim' ? 'slim' : 'default' });
      else viewer.loadSkin(`https://mc-heads.net/skin/${encodeURIComponent(nick)}`).catch(() => $('lk-viewer-hint').classList.remove('hidden'));
    }
    renderRows();
  }

  function card(s) {
    const c = el('div', 'lk-card' + (s.id === data.current ? ' cur' : ''));
    const img = el('img');
    img.src = s.url;
    c.append(img);
    const star = el('button', 'lk-star' + (s.favorite ? ' on' : ''));
    star.innerHTML = '<i class="fa-solid fa-star"></i>';
    star.addEventListener('click', async (e) => { e.stopPropagation(); await window.api.favSkin({ id: s.id, favorite: !s.favorite }); load(); });
    const dele = el('button', 'lk-del');
    dele.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    dele.addEventListener('click', async (e) => { e.stopPropagation(); await window.api.deleteSkin(s.id); load(); });
    c.append(star, dele, el('div', 'lk-cap', s.name), el('div', 'lk-age', fmtAgo(s.addedAt).replace('prieš ', '')));
    c.addEventListener('click', async () => { await window.api.setSkin(s.id); load(); });
    return c;
  }

  function renderRows() {
    const favs = $('lk-favs'), latest = $('lk-latest');
    favs.textContent = '';
    latest.textContent = '';
    const f = data.skins.filter((s) => s.favorite);
    if (f.length) f.forEach((s) => favs.append(card(s)));
    else favs.append(el('div', 'lk-none', 'Pažymėk skiną žvaigždute'));
    const l = [...data.skins].sort((a, b) => b.addedAt - a.addedAt);
    if (l.length) l.forEach((s) => latest.append(card(s)));
    else latest.append(el('div', 'lk-none', 'Dar neįkėlei skinų'));
  }

  function openModal(dataUrl, fileName) {
    const M = $('lk-modal');
    M.textContent = '';
    M.classList.remove('hidden');
    const box = el('div', 'lk-modal-box');
    const x = el('button', 'lk-modal-x', '✕');
    const prev = el('img', 'lk-modal-prev');
    prev.src = dataUrl;
    const form = el('div', 'lk-form');
    form.innerHTML = `
      <label>Pavadinimas<input id="lkm-name" maxlength="24"></label>
      <label>Failas<input id="lkm-file" disabled></label>
      <div class="lk-variant">Modelis
        <label><input type="radio" name="lkm-v" value="wide" checked> Platus</label>
        <label><input type="radio" name="lkm-v" value="slim"> Siauras</label>
      </div>
      <div class="lk-modal-actions"><span id="lkm-err"></span><button id="lkm-save" class="lk-save"><i class="fa-solid fa-check"></i> Išsaugoti</button></div>`;
    box.append(x, prev, form);
    M.append(box);
    x.addEventListener('click', () => M.classList.add('hidden'));
    form.querySelector('#lkm-name').value = fileName.replace(/\.png$/i, '').slice(0, 24);
    form.querySelector('#lkm-file').value = fileName;
    form.querySelector('#lkm-save').addEventListener('click', async () => {
      const r = await window.api.saveSkin({
        name: form.querySelector('#lkm-name').value.trim(),
        variant: form.querySelector('input[name="lkm-v"]:checked').value,
        dataUrl,
      });
      if (!r.ok) { form.querySelector('#lkm-err').textContent = r.error; return; }
      M.classList.add('hidden');
      load();
    });
  }

  function pick(file) {
    if (!file || file.type !== 'image/png') return;
    const rd = new FileReader();
    rd.onload = () => openModal(rd.result, file.name);
    rd.readAsDataURL(file);
  }
  $('lk-file').addEventListener('change', (e) => { pick(e.target.files[0]); e.target.value = ''; });
  const drop = $('lk-drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); pick(e.dataTransfer.files[0]); });
  document.querySelector('[data-view="locker"]').addEventListener('click', load);
  document.addEventListener('cfg', load);
  load();
})();
