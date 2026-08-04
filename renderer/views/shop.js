(() => {
  const { $, el } = window.ui;
  const fmt = (n) => Number(n || 0).toLocaleString('lt-LT');
  const price = (s) => (s.salePriceCents != null ? s.salePriceCents : s.priceCents);

  let balance = 0;
  let pending = null;
  let inFlight = false;
  let allServices = [];
  // Which account's data is currently loaded (null/undefined usernames all collapse to
  // null, so a logged-out state doesn't look like a "different account" than another
  // logged-out state). Only a successful load() advances this - a failed load leaves it
  // as-is so the next cfg event or manual rail click retries.
  let loadedFor = null;

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
    loadedFor = (window.ui.state.cfg && window.ui.state.cfg.username) || null;
    setBalance(r.auksiniai);
    allServices = (r.categories || []).flatMap((c) => c.services || []);
    renderCatalog(r.categories);
  }

  function openConfirm(s) {
    pending = s;
    $('sm-title').textContent = s.name;
    $('sm-price').textContent = fmt(price(s));
    $('sm-after').textContent = fmt(balance - price(s));
    $('sm-err').classList.add('hidden');
    // Every modal open starts from a known-enabled state, regardless of how the previous
    // one ended (success left sm-cancel disabled otherwise - see task-9 fix report).
    $('sm-buy').disabled = false;
    $('sm-cancel').disabled = false;
    $('shop-modal').classList.remove('hidden');
  }

  function closeConfirm() {
    // A purchase is in flight for the currently pending item - ignore cancel/overlay
    // dismissal until it settles, so its resolution can't stomp a different modal state.
    if (inFlight) return;
    pending = null;
    $('shop-modal').classList.add('hidden');
  }

  $('sm-cancel').addEventListener('click', closeConfirm);
  $('shop-modal').addEventListener('click', (e) => {
    if (e.target === $('shop-modal')) closeConfirm();
  });

  $('sm-buy').addEventListener('click', async () => {
    if (!pending || inFlight) return;
    const s = pending;
    inFlight = true;
    $('sm-buy').disabled = true;
    $('sm-cancel').disabled = true;

    let r;
    try {
      r = await window.api.shopPurchase({ serviceId: s.id, expectedPriceCents: price(s) });
    } catch {
      r = null;
    }

    // Cancel/overlay clicks are ignored while inFlight, so pending cannot have moved on -
    // but only ever touch the modal for the request that's actually still pending.
    if (pending !== s) { inFlight = false; $('sm-cancel').disabled = false; return; }

    if (r && r.ok) {
      setBalance(r.auksiniai);
      inFlight = false;
      $('sm-cancel').disabled = false;
      closeConfirm();
      document.dispatchEvent(new CustomEvent('notify', {
        detail: { text: `Nupirkta: ${s.name}. Pristatoma žaidime.`, kind: 'info' },
      }));
      return;
    }

    const err = $('sm-err');

    if (r && r.code === 'PRICE') {
      // The server refused a stale price: refresh the catalog, then ask the player to
      // confirm the new price rather than silently resubmitting the old one.
      await load();
      if (pending !== s) { inFlight = false; $('sm-cancel').disabled = false; return; }
      const fresh = allServices.find((x) => x.id === s.id);
      inFlight = false;
      $('sm-cancel').disabled = false;
      if (fresh) {
        openConfirm(fresh);
        err.textContent = 'Kaina pasikeitė - patvirtink naują kainą.';
        err.classList.remove('hidden');
      } else {
        closeConfirm();
      }
      return;
    }

    inFlight = false;
    $('sm-cancel').disabled = false;
    $('sm-buy').disabled = false;
    err.textContent = (r && r.code === 'BALANCE')
      ? 'Nepakanka auksinių - papildyk balansą svetainėje.'
      : (r && r.error) || 'Kažkas nepavyko.';
    err.classList.remove('hidden');
  });

  $('shop-topup').addEventListener('click', () => window.ui.openUrl('https://mctema.lt/parduotuve'));
  document.querySelectorAll('#view-shop [data-url]').forEach((b) =>
    b.addEventListener('click', () => window.ui.openUrl(b.dataset.url)));

  // Manual refresh path: always reloads, regardless of whether the account already
  // matches loadedFor. If nobody is logged in this fails into the retry-button state,
  // which is fine - it's an explicit click, not something firing on every keystroke.
  document.querySelector('.rail-btn[data-view="shop"]').addEventListener('click', load);
  // cfg fires on startup config load, after login, and on every settings mutation (RAM
  // slider, toggles, JVM args, friend prefs) - reload only when it signals a different
  // account than what's currently loaded, not on every firing (that would needlessly
  // re-GET and blank the balance on unrelated settings changes, and double-fetch at
  // startup alongside this same cfg dispatch). loadedFor and the event's username both
  // collapse null/undefined to null so two logged-out firings compare equal.
  document.addEventListener('cfg', (e) => {
    const username = (e.detail && e.detail.username) || null;
    if (username === loadedFor) return;
    $('shop-auks').textContent = '-';
    const hero = $('co-auks');
    if (hero) hero.textContent = '-';
    load();
  });
})();
