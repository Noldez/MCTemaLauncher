(() => {
  const { $, el, fmtAgo } = window.ui;
  let viewer = null, flat = null, data = { current: null, skins: [] };
  let capeData = { current: null, capes: [] };

  function ensureViewer() {
    if (viewer || flat || !window.skinview3d) return;
    try {
      viewer = new skinview3d.SkinViewer({ canvas: $('lk-canvas'), width: 260, height: 400 });
      viewer.controls.enableZoom = false;
      viewer.animation = new skinview3d.WalkingAnimation();
      viewer.animation.speed = 0.6;
    } catch {
      viewer = null;
      flat = window.ui.swapCanvas($('lk-canvas'), 260, 400);
    }
  }

  async function load() {
    data = await window.api.listSkins();
    ensureViewer();
    const cur = data.skins.find((s) => s.id === data.current);
    $('lk-viewer-hint').classList.add('hidden');
    const nick = (window.ui.state.cfg && window.ui.state.cfg.username) || 'MHF_Steve';
    const url = cur ? cur.url : `https://mc-heads.net/skin/${encodeURIComponent(nick)}`;
    const model = cur && cur.variant === 'slim' ? 'slim' : 'default';
    if (viewer) {
      viewer.loadSkin(url, { model }).catch(() => $('lk-viewer-hint').classList.remove('hidden'));
    } else if (flat) {
      window.ui.flatSkin(flat, url, model).catch(() => $('lk-viewer-hint').classList.remove('hidden'));
    }
    renderRows();
    loadCapes();
  }

  // ---- capes ---------------------------------------------------------------
  //
  // A cape sheet is 64x32 per frame, and an animated one stacks its frames
  // downwards. Everything below works in "64-space" units so an HD sheet needs
  // no special case: the front of the cape is always the 10x16 patch at (1,1)
  // of a frame, whatever the real pixel size is.

  const FRAME_H = 32, FRONT = { x: 1, y: 1, w: 10, h: 16 };
  let capeTimer = null;      // one timer drives every animated tile
  let viewerFrames = null;   // the selected cape, pre-cut into frames
  let viewerTimer = null;

  // Tiles are sized in CSS; measuring them here would read 0 while the locker
  // is still hidden, and every cape would render at the wrong scale until the
  // view was opened a second time.
  const TILE_W = 80;

  /** Point a tile at frame `k` of its sheet. */
  function showFrame(tile, k) {
    const scale = TILE_W / FRONT.w;
    const frames = Number(tile.dataset.frames) || 1;
    tile.style.backgroundSize = `${64 * scale}px ${FRAME_H * frames * scale}px`;
    tile.style.backgroundPosition = `${-FRONT.x * scale}px ${-(FRAME_H * k + FRONT.y) * scale}px`;
  }

  /** A tile is the cape art plus its name, so the row reads as a list. */
  function capeTile(c) {
    const cell = el('div', 'cape-cell' + (c.id === capeData.current ? ' on' : ''));
    const t = el('div', 'cape');
    t.style.backgroundImage = `url("${c.url}")`;
    t.dataset.frames = String(c.frames || 1);
    t.dataset.fps = String(c.fps || 0);
    showFrame(t, 0);
    if ((c.frames || 1) > 1) t.append(el('span', 'cape-anim', 'ANIM'));

    // Capes carry their own elytra art in the same sheet, and plenty do not
    // bother. Saying so on the tile beats finding out mid-flight.
    const wings = el('span', 'cape-ely' + (c.elytra ? ' yes' : ''));
    wings.innerHTML = '<i class="fa-solid fa-feather-pointed"></i>';
    t.append(wings);

    cell.append(t, el('span', 'cape-name', c.name));
    cell.title = c.elytra
      ? `${c.name} - turi savo elytra tekstūrą`
      : `${c.name} - elytra liks įprastas`;
    cell.addEventListener('click', async () => { await window.api.setCape(c.id); loadCapes(); });
    return cell;
  }

  function renderCapes() {
    const row = $('lk-capes');
    row.textContent = '';

    // "No cape" is a choice, so it is a tile rather than a separate button.
    const none = el('div', 'cape-cell' + (capeData.current ? '' : ' on'));
    const box = el('div', 'cape none');
    box.innerHTML = '<i class="fa-solid fa-ban"></i>';
    none.append(box, el('span', 'cape-name', 'Be cape\'o'));
    none.addEventListener('click', async () => { await window.api.setCape(null); loadCapes(); });
    row.append(none);

    capeData.capes.forEach((c) => row.append(capeTile(c)));
    startCapeAnimation();
  }

  /** One interval steps every animated tile, rather than a timer per tile. */
  function startCapeAnimation() {
    if (capeTimer) clearInterval(capeTimer);
    const tiles = [...$('lk-capes').querySelectorAll('.cape[data-fps]')]
      .filter((t) => Number(t.dataset.fps) > 0);
    if (!tiles.length) { capeTimer = null; return; }
    let tick = 0;
    capeTimer = setInterval(() => {
      tick += 1;
      for (const t of tiles) {
        const fps = Number(t.dataset.fps), frames = Number(t.dataset.frames);
        // The interval runs at 24Hz; each tile advances at its own rate.
        if (tick % Math.max(1, Math.round(24 / fps)) === 0) {
          const k = (Number(t.dataset.k || 0) + 1) % frames;
          t.dataset.k = String(k);
          showFrame(t, k);
        }
      }
    }, 1000 / 24);
  }

  /**
   * Cut a sheet into one image per frame. skinview3d takes a whole texture, so
   * animating means handing it a different one each tick - doing the cutting
   * once here keeps that to a texture swap.
   */
  function cutFrames(url, frames) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = img.width, h = img.height / frames;
        const out = [];
        for (let k = 0; k < frames; k += 1) {
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, k * h, w, h, 0, 0, w, h);
          out.push(cv.toDataURL('image/png'));
        }
        resolve(out);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  async function applyCapeToViewer() {
    if (viewerTimer) { clearInterval(viewerTimer); viewerTimer = null; }
    viewerFrames = null;
    if (!viewer) return;
    const cur = capeData.capes.find((c) => c.id === capeData.current);
    if (!cur) { viewer.loadCape(null); return; }
    const frames = cur.frames || 1;
    if (frames === 1) { viewer.loadCape(cur.url).catch(() => {}); return; }
    try {
      viewerFrames = await cutFrames(cur.url, frames);
    } catch {
      viewer.loadCape(cur.url).catch(() => {});
      return;
    }
    let k = 0;
    viewer.loadCape(viewerFrames[0]).catch(() => {});
    viewerTimer = setInterval(() => {
      // The view can be swapped out from under us; stop rather than churn.
      if (!viewerFrames || !viewer) return;
      k = (k + 1) % viewerFrames.length;
      viewer.loadCape(viewerFrames[k]).catch(() => {});
    }, 1000 / (cur.fps || 10));
  }

  async function loadCapes() {
    capeData = await window.api.listCapes();
    renderCapes();
    applyCapeToViewer();
  }

  // ---- skins ---------------------------------------------------------------

  function card(s) {
    const c = el('div', 'lk-card' + (s.id === data.current ? ' cur' : ''));
    // The character, not the texture sheet: nobody recognises their skin from
    // the flat PNG. Front view is enough at this size and costs no WebGL.
    const cv = el('canvas', 'lk-shot');
    cv.width = 108;
    cv.height = 150;
    window.ui.flatSkin(cv, s.url, s.variant).catch(() => {});
    c.append(cv);
    const star = el('button', 'lk-star' + (s.favorite ? ' on' : ''));
    star.title = s.favorite ? 'Atsegti' : 'Prisegti į priekį';
    star.innerHTML = `<i class="fa-solid fa-thumbtack"></i>`;
    star.addEventListener('click', async (e) => { e.stopPropagation(); await window.api.favSkin({ id: s.id, favorite: !s.favorite }); load(); });
    const dele = el('button', 'lk-del');
    dele.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    dele.addEventListener('click', async (e) => { e.stopPropagation(); await window.api.deleteSkin(s.id); load(); });
    c.append(star, dele, el('div', 'lk-cap', s.name), el('div', 'lk-age', fmtAgo(s.addedAt).replace('prieš ', '')));
    c.addEventListener('click', async () => { await window.api.setSkin(s.id); load(); });
    return c;
  }

  // One list. A favourite is a pin: it sits at the front, and everything else
  // follows by newest. A separate favourites row only meant seeing the same
  // skin twice.
  function renderRows() {
    const row = $('lk-skins');
    row.textContent = '';
    if (!data.skins.length) {
      row.append(el('div', 'lk-none', 'Dar neįkėlei skinų'));
      return;
    }
    [...data.skins]
      .sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || b.addedAt - a.addedAt)
      .forEach((s) => row.append(card(s)));
  }

  // The two arm widths Minecraft actually has. Steve is the 4px classic model,
  // Alex the 3px slim one - naming them after the models is what people know,
  // and seeing the skin on both is the only way to tell which one it was drawn
  // for: on the wrong model an arm texture is either stretched or cut off.
  const MODELS = [
    { id: 'wide', name: 'Steve', note: 'Klasikinis - 4 px rankos' },
    { id: 'slim', name: 'Alex', note: 'Plonas - 3 px rankos' },
  ];
  let modalViewers = [];

  function closeModal() {
    modalViewers.forEach((v) => { try { v.dispose(); } catch { /* already gone */ } });
    modalViewers = [];
    $('lk-modal').classList.add('hidden');
  }

  /** A rotating preview of the skin on one model, which is also the picker. */
  function modelCard(dataUrl, model, onPick) {
    const cell = el('button', 'lkm-model' + (model.id === 'wide' ? ' on' : ''));
    cell.dataset.variant = model.id;
    const stage = el('div', 'lkm-stage');
    const canvas = el('canvas');
    stage.append(canvas);
    const head = el('div', 'lkm-model-head');
    head.append(el('b', null, model.name), el('span', null, model.note));
    cell.append(stage, head);
    cell.addEventListener('click', () => onPick(model.id));

    // Turning slowly shows front and back, so a skin is judged whole rather
    // than from the one angle that happens to face you.
    try {
      const v = new skinview3d.SkinViewer({ canvas, width: 150, height: 220 });
      v.controls.enableZoom = false;
      v.autoRotate = true;
      v.autoRotateSpeed = 1.4;
      v.loadSkin(dataUrl, { model: model.id === 'slim' ? 'slim' : 'default' });
      modalViewers.push(v);
    } catch {
      const flatCv = window.ui.swapCanvas(canvas, 150, 220);
      window.ui.flatSkin(flatCv, dataUrl, model.id).catch(() => {});
    }
    return cell;
  }

  function openModal(dataUrl, fileName) {
    const M = $('lk-modal');
    M.textContent = '';
    M.classList.remove('hidden');
    let variant = 'wide';

    const box = el('div', 'lk-modal-box');
    const head = el('div', 'lkm-head');
    head.append(el('b', null, 'Naujas skinas'), el('span', null, fileName));
    const x = el('button', 'lk-modal-x');
    x.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    head.append(x);

    const models = el('div', 'lkm-models');
    const pick = (id) => {
      variant = id;
      models.querySelectorAll('.lkm-model').forEach((n) => {
        n.classList.toggle('on', n.dataset.variant === id);
      });
    };
    MODELS.forEach((m) => models.append(modelCard(dataUrl, m, pick)));

    const form = el('div', 'lk-form');
    const nameWrap = el('label', 'lkm-field', 'Pavadinimas');
    const name = el('input');
    name.maxLength = 24;
    name.value = fileName.replace(/\.png$/i, '').slice(0, 24);
    nameWrap.append(name);
    const err = el('span', 'lkm-err');
    const save = el('button', 'lk-save');
    save.innerHTML = '<i class="fa-solid fa-check"></i> Išsaugoti';
    const actions = el('div', 'lk-modal-actions');
    actions.append(err, save);
    form.append(nameWrap, actions);

    box.append(head, models, form);
    M.append(box);

    x.addEventListener('click', closeModal);
    save.addEventListener('click', async () => {
      const r = await window.api.saveSkin({ name: name.value.trim(), variant, dataUrl });
      if (!r.ok) { err.textContent = r.error; return; }
      closeModal();
      load();
    });
    // Escape closes it, a click beside it does not: pressing a key is a
    // decision, clipping the edge of a dialog with the mouse is not.
    document.addEventListener('keydown', function esc(e) {
      if (e.key !== 'Escape') return;
      document.removeEventListener('keydown', esc);
      closeModal();
    });
    name.focus();
    name.select();
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

  // ---- viewer controls and row scrolling -----------------------------------

  $('lk-rotate').addEventListener('click', (e) => {
    if (!viewer) return;
    viewer.autoRotate = !viewer.autoRotate;
    e.currentTarget.classList.toggle('on', viewer.autoRotate);
  });
  $('lk-walk').addEventListener('click', (e) => {
    if (!viewer || !viewer.animation) return;
    viewer.animation.paused = !viewer.animation.paused;
    e.currentTarget.classList.toggle('on', !viewer.animation.paused);
    e.currentTarget.innerHTML = viewer.animation.paused
      ? '<i class="fa-solid fa-play"></i>' : '<i class="fa-solid fa-pause"></i>';
  });

  /** Nudge a row by roughly one screenful, the way the arrows imply. */
  function wireNav(prevId, nextId, rowId) {
    const row = $(rowId);
    const step = () => Math.max(160, row.clientWidth - 80);
    $(prevId).addEventListener('click', () => row.scrollBy({ left: -step(), behavior: 'smooth' }));
    $(nextId).addEventListener('click', () => row.scrollBy({ left: step(), behavior: 'smooth' }));
  }
  wireNav('lk-cape-prev', 'lk-cape-next', 'lk-capes');
  wireNav('lk-skin-prev', 'lk-skin-next', 'lk-skins');

  document.querySelector('[data-view="locker"]').addEventListener('click', load);
  document.addEventListener('cfg', load);
  window.ui.bootTask(load());
})();
