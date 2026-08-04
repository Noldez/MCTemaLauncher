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

  // Same art convention as the website shop (src/pages/shop/index.tsx): emblem art by
  // card order within the category, icon fallback elsewhere, accent glow cycled per card.
  // Art is bundled so the shop looks right offline; a server-set imageUrl still wins.
  const ART = {
    rangai: ['shop/rank-knight.png', 'shop/rank-mage.png', 'shop/rank-king.png', 'shop/rank-god.png'],
    raktai: ['shop/key-green.png', 'shop/key-gold.png', 'shop/key-diamond.png'],
  };
  const ICONS = { kosmetika: ['fa-palette', 'fa-wand-magic-sparkles'] };
  const GLOWS = ['rgba(74,222,128,.4)', 'rgba(255,196,77,.45)', 'rgba(110,231,183,.4)', 'rgba(192,132,252,.45)'];
  const serviceArt = new Map();

  const coinImg = () => {
    const c = el('img', 'coin-ic');
    c.src = 'shop/coin.png';
    c.alt = 'auksiniai';
    return c;
  };

  // Descriptions come from the site as one perk per line.
  const splitPerks = (s) => String(s.description || '').split('\n').map((t) => t.trim()).filter(Boolean);

  function itemCard(s, slug, i) {
    const glow = GLOWS[i % GLOWS.length];
    const src = s.imageUrl || (ART[slug] || [])[i] || null;
    const icon = src ? null : (ICONS[slug] || ['fa-gem'])[i % (ICONS[slug] || ['fa-gem']).length];
    serviceArt.set(s.id, { src, icon, glow });

    const card = el('button', 'shop-card');
    card.style.setProperty('--glow', glow);
    card.style.setProperty('--bob', `${(i % 4) * -1.15}s`);
    const art = el('span', 'sc-art');
    if (src) {
      const img = el('img');
      img.src = src;
      img.alt = '';
      art.append(img);
    } else {
      art.append(el('i', `fa-solid ${icon} sc-ic`));
    }
    art.append(el('i', 'sc-pad'));
    if (s.salePriceCents != null) card.append(el('span', 'sc-sale', 'AKCIJA'));
    const pr = el('span', 'sc-price');
    if (s.salePriceCents != null) pr.append(el('s', null, fmt(s.priceCents)));
    pr.append(el('b', null, fmt(price(s))), coinImg());
    card.append(art, el('b', 'sc-name', s.name), pr);
    const perks = splitPerks(s);
    if (perks.length > 1) {
      const pv = el('span', 'sc-perks');
      perks.slice(0, 3).forEach((p) => pv.append(el('span', 'sc-perk', p)));
      if (perks.length > 3) pv.append(el('span', 'sc-perk more', `+${perks.length - 3} daugiau`));
      card.append(pv);
    }
    card.addEventListener('click', () => openConfirm(s));
    return card;
  }

  function renderCatalog(categories) {
    const list = $('shop-list');
    list.textContent = '';
    serviceArt.clear();
    categories.filter((c) => (c.services || []).length).forEach((c) => {
      list.append(el('div', 'shop-cat', c.name));
      const grid = el('div', 'shop-grid');
      c.services.forEach((s, i) => grid.append(itemCard(s, c.slug, i)));
      list.append(grid);
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
    const art = serviceArt.get(s.id) || {};
    $('sm-art').style.setProperty('--glow', art.glow || 'rgba(74,222,128,.35)');
    const img = $('sm-art-img');
    const ic = $('sm-art-ic');
    if (art.src) {
      img.src = art.src;
      img.className = '';
      ic.className = 'hidden';
    } else {
      img.className = 'hidden';
      ic.className = `fa-solid ${art.icon || 'fa-gem'}`;
    }
    $('sm-title').textContent = s.name;
    const desc = $('sm-desc');
    desc.textContent = '';
    const perks = splitPerks(s);
    if (perks.length > 1) {
      perks.forEach((p) => {
        const row = el('div', 'sm-perk');
        row.append(el('i', 'fa-solid fa-check'), el('span', null, p));
        desc.append(row);
      });
    } else {
      desc.textContent = perks[0] || '';
    }
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

  window.ui.ambientFx(document.querySelector('.shop-hero'), $('shop-fx'));

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
