(() => {
  const { $, el } = window.ui;
  const fmt = (n) => Number(n || 0).toLocaleString('lt-LT');
  const price = (s) => (s.salePriceCents != null ? s.salePriceCents : s.priceCents);

  let balance = 0;
  let haveData = false;
  let pending = null;

  function setBalance(n) {
    balance = n;
    $('shop-auks').textContent = fmt(n);
    const hero = $('co-auks');
    if (hero) hero.textContent = fmt(n);
  }

  function itemCard(s) {
    const card = el('button', 'shop-item');
    const art = el('span', 'si-art');
    if (s.imageUrl) {
      const img = el('img');
      img.src = s.imageUrl;
      img.alt = '';
      art.append(img);
    }
    const meta = el('span', 'si-meta');
    meta.append(el('b', null, s.name), el('span', 'si-desc', s.description || ''));
    const tag = el('span', 'si-price');
    if (s.salePriceCents != null) tag.append(el('s', null, fmt(s.priceCents)));
    tag.append(el('b', null, fmt(price(s))), el('i', null, 'auksinių'));
    card.append(art, meta, tag);
    card.addEventListener('click', () => openConfirm(s));
    return card;
  }

  function renderCatalog(categories) {
    const list = $('shop-list');
    list.textContent = '';
    categories.filter((c) => (c.services || []).length).forEach((c) => {
      list.append(el('div', 'shop-cat', c.name));
      const row = el('div', 'shop-row');
      c.services.forEach((s) => row.append(itemCard(s)));
      list.append(row);
    });
    if (!list.children.length) list.append(el('div', 'shop-empty', 'Parduotuvė tuščia.'));
  }

  async function load() {
    let r;
    try { r = await window.api.shopData(); } catch { r = null; }
    if (!r || !r.ok) {
      const list = $('shop-list');
      list.textContent = '';
      const retry = el('button', 'shop-btn', 'Nepavyko užkrauti - bandyti dar kartą');
      retry.addEventListener('click', load);
      list.append(retry);
      return;
    }
    haveData = true;
    setBalance(r.auksiniai);
    renderCatalog(r.categories);
  }

  function openConfirm(s) {
    pending = s;
    $('sm-title').textContent = s.name;
    $('sm-price').textContent = fmt(price(s));
    $('sm-after').textContent = fmt(balance - price(s));
    $('sm-err').classList.add('hidden');
    $('sm-buy').disabled = false;
    $('shop-modal').classList.remove('hidden');
  }

  function closeConfirm() {
    pending = null;
    $('shop-modal').classList.add('hidden');
  }

  $('sm-cancel').addEventListener('click', closeConfirm);
  $('shop-modal').addEventListener('click', (e) => {
    if (e.target === $('shop-modal')) closeConfirm();
  });

  $('sm-buy').addEventListener('click', async () => {
    if (!pending) return;
    const s = pending;
    $('sm-buy').disabled = true;
    const r = await window.api.shopPurchase({ serviceId: s.id, expectedPriceCents: price(s) });
    if (r && r.ok) {
      setBalance(r.auksiniai);
      closeConfirm();
      document.dispatchEvent(new CustomEvent('notify', {
        detail: { text: `Nupirkta: ${s.name}. Pristatoma žaidime.`, kind: 'info' },
      }));
      return;
    }
    $('sm-buy').disabled = false;
    const err = $('sm-err');
    err.textContent = (r && r.code === 'BALANCE')
      ? 'Nepakanka auksinių - papildyk balansą svetainėje.'
      : (r && r.error) || 'Kažkas nepavyko.';
    err.classList.remove('hidden');
    // The server refused a stale price; show the current catalog immediately.
    if (r && r.code === 'PRICE') load();
  });

  $('shop-topup').addEventListener('click', () => window.ui.openUrl('https://mctema.lt/parduotuve'));
  document.querySelectorAll('#view-shop [data-url]').forEach((b) =>
    b.addEventListener('click', () => window.ui.openUrl(b.dataset.url)));

  document.querySelector('.rail-btn[data-view="shop"]').addEventListener('click', load);
  // Fill the hero balance callout without opening the view; retry after login
  // (the cfg event fires once credentials land).
  document.addEventListener('cfg', () => { if (!haveData) load(); });
  load();
})();
