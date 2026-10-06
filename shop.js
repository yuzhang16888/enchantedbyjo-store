(function () {
  const sb = window.sb;

  const els = {
    grid: document.getElementById('grid'),
    chips: document.getElementById('chips'),
    status: document.getElementById('status'),
    search: document.getElementById('search'),
    count: document.getElementById('basket-count'),
    link: document.getElementById('basket-link'),
    bar: document.getElementById('basket-bar'),
    barText: document.getElementById('basket-bar-text'),
    dialog: document.getElementById('added'),
    addedItem: document.getElementById('added-item'),
    recs: document.getElementById('recs'),
    recsWrap: document.getElementById('recs-wrap')
  };

  const state = {
    products: [],          // in shop order
    byId: new Map(),
    categories: [],
    cat: 'all',
    query: '',
    chosen: new Map()      // productId -> optionId
  };

  const BADGES = { new: 'New', popular: 'Popular', seasonal: 'Seasonal', popup: 'Pop-up' };

  // ---------- helpers ----------
  const money = (cents) => '$' + (cents / 100).toFixed(2);
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid) n.append(kid);
    return n;
  }
  function initials(name) {
    if (!name) return '';
    return name.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  }
  function unitText(u) {
    if (!u) return '';
    if (/^\d+$/.test(u)) return Number(u) > 1 ? 'Pack of ' + u : '';
    return u;
  }
  function optionsOf(p) { return p.options; }
  // A picture that fails to load turns into a soft placeholder instead of a broken image.
  function photoEl(src, alt, fallbackText, cls) {
    const ph = () => el('div', { class: cls === 'thumb' ? 'thumb' : 'ph', 'aria-hidden': 'true', text: fallbackText || '' });
    if (!src) return ph();
    const img = el('img', { src, alt: alt || '', loading: 'lazy', class: cls || null });
    img.addEventListener('error', () => img.replaceWith(ph()), { once: true });
    return img;
  }
  function chosenOption(p) {
    const opts = optionsOf(p);
    if (!opts.length) return null;
    const id = state.chosen.get(p.id);
    return opts.find((o) => o.id === id) || opts[0];
  }
  function priceOf(p, opt) { return opt ? opt.price_cents : (p.price_cents || 0); }
  function photoOf(p, opt) { return (opt && opt.photo_url) || p.photo_url || null; }
  function lineName(p, opt) { return opt ? p.name + ', ' + opt.label : p.name; }

  // ---------- load ----------
  async function load() {
    const [prodRes, catRes] = await Promise.all([
      sb.from('products')
        .select('id, name, description, photo_url, price_cents, unit_label, badge, sold_out, sort_order, ' +
                'vendor:vendors(id, name, logo_url), category:categories(slug, name, sort_order), ' +
                'options:product_options(id, label, price_cents, photo_url, sort_order), ' +
                'pairings:pairings!pairings_product_id_fkey(paired_product_id, position)')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      sb.from('categories').select('slug, name, sort_order').order('sort_order')
    ]);
    if (prodRes.error || catRes.error) throw (prodRes.error || catRes.error);

    state.products = prodRes.data.map((p) => ({
      ...p,
      options: (p.options || []).slice().sort((a, b) => a.sort_order - b.sort_order),
      pairings: (p.pairings || []).slice().sort((a, b) => a.position - b.position)
    }));
    state.products.forEach((p) => state.byId.set(p.id, p));
    const used = new Set(state.products.map((p) => p.category && p.category.slug));
    state.categories = catRes.data.filter((c) => used.has(c.slug));
  }

  // ---------- render ----------
  function renderChips() {
    els.chips.replaceChildren(
      ...[{ slug: 'all', name: 'All' }, ...state.categories].map((c) =>
        el('button', {
          type: 'button', class: 'chip', text: c.name,
          'aria-pressed': String(state.cat === c.slug),
          onclick: () => { state.cat = c.slug; renderChips(); renderGrid(); }
        }))
    );
  }

  function visibleProducts() {
    const q = state.query.trim().toLowerCase();
    return state.products.filter((p) => {
      if (state.cat !== 'all' && (!p.category || p.category.slug !== state.cat)) return false;
      if (!q) return true;
      const hay = [p.name, p.description, p.vendor && p.vendor.name, ...p.options.map((o) => o.label)].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function productCard(p) {
    const opt = chosenOption(p);
    const photo = photoOf(p, opt);
    const vendorName = p.vendor ? p.vendor.name : '';

    const photoBox = el('div', { class: 'photo' },
      photoEl(photo, lineName(p, opt), initials(vendorName || p.name)),
      p.badge && BADGES[p.badge] ? el('span', { class: 'badge ' + p.badge, text: BADGES[p.badge] }) : null
    );

    const maker = vendorName ? el('div', { class: 'maker' },
      p.vendor.logo_url ? el('img', { class: 'maker-logo', src: p.vendor.logo_url, alt: '', loading: 'lazy' })
                        : el('span', { class: 'maker-initials', 'aria-hidden': 'true', text: initials(vendorName) }),
      el('span', { class: 'maker-name', text: vendorName })
    ) : null;

    // Every card has the same slots, so all cards line up at the same size.
    const options = el('div', { class: 'options', role: p.options.length ? 'group' : null,
        'aria-label': p.options.length ? 'Choose an option for ' + p.name : null },
      p.options.map((o) => el('button', {
        type: 'button', class: 'opt', text: o.label,
        'aria-pressed': String(opt && o.id === opt.id),
        onclick: () => { state.chosen.set(p.id, o.id); refreshCard(p.id); }
      }))
    );
    const desc = el('p', { class: 'desc', text: p.description || '' });
    const hasMore = !!(p.description && p.description.length > 60);
    const more = el('button', {
      type: 'button', class: 'more', text: 'Read more',
      'data-empty': hasMore ? null : 'true', 'aria-hidden': hasMore ? null : 'true', tabindex: hasMore ? null : '-1',
      'aria-haspopup': 'dialog', onclick: () => openInfo(p)
    });

    const unit = unitText(p.unit_label);
    const priceRow = el('div', { class: 'price-row' },
      el('span', { class: 'price', text: money(priceOf(p, opt)) }),
      unit ? el('span', { class: 'unit', text: unit }) : null
    );

    const qty = Basket.qty(p.id, opt && opt.id);
    let action;
    if (p.sold_out) {
      action = el('button', { type: 'button', class: 'add', disabled: true, text: 'Sold out' });
    } else if (qty > 0) {
      action = el('div', { class: 'stepper' },
        el('button', { type: 'button', 'aria-label': 'Remove one ' + lineName(p, opt), text: '−',
          onclick: () => Basket.setQty(p.id, opt && opt.id, qty - 1) }),
        el('span', { 'aria-live': 'polite', text: String(qty) }),
        el('button', { type: 'button', 'aria-label': 'Add one more ' + lineName(p, opt), text: '+',
          onclick: () => addAndShow(p, opt) })
      );
    } else {
      action = el('button', { type: 'button', class: 'add', text: 'Add to basket', onclick: () => addAndShow(p, opt) });
    }

    return el('article', { class: 'product', 'data-id': p.id },
      photoBox,
      el('div', { class: 'body' }, maker, el('h3', { text: p.name }), options, desc, more, priceRow, action)
    );
  }

  function refreshCard(id) {
    const old = els.grid.querySelector('[data-id="' + id + '"]');
    if (old) old.replaceWith(productCard(state.byId.get(id)));
  }

  function renderGrid() {
    const list = visibleProducts();
    els.status.textContent = list.length ? '' : (state.query ? 'Nothing matches “' + state.query + '” this week.' : 'Nothing here this week.');
    els.grid.replaceChildren(...list.map(productCard));
  }

  function renderBasketBits() {
    const lines = Basket.lines();
    const n = lines.reduce((s, l) => s + l.qty, 0);
    let subtotal = 0;
    for (const l of lines) {
      const p = state.byId.get(l.productId);
      if (!p) continue;
      const o = l.optionId ? p.options.find((x) => x.id === l.optionId) : null;
      subtotal += priceOf(p, o) * l.qty;
    }
    els.count.hidden = n === 0;
    els.count.textContent = String(n);
    els.link.setAttribute('aria-label', n ? 'Basket, ' + n + (n === 1 ? ' item' : ' items') : 'Basket, empty');
    els.bar.hidden = n === 0;
    els.barText.textContent = n + (n === 1 ? ' item, ' : ' items, ') + money(subtotal);
  }

  // ---------- pop-up ----------
  function recommendations(p) {
    const picked = p.pairings.map((x) => state.byId.get(x.paired_product_id)).filter(Boolean);
    const pool = [
      ...picked,
      ...state.products.filter((x) => p.vendor && x.vendor && x.vendor.id === p.vendor.id),
      ...state.products.filter((x) => p.category && x.category && x.category.slug === p.category.slug)
    ];
    const seen = new Set([p.id]);
    const out = [];
    for (const x of pool) {
      if (seen.has(x.id) || x.sold_out) continue;
      seen.add(x.id);
      out.push(x);
      if (out.length === 3) break;
    }
    return out;
  }

  function addAndShow(p, opt) {
    Basket.add(p.id, opt && opt.id, 1);
    const photo = photoOf(p, opt);
    els.addedItem.replaceChildren(
      photoEl(photo, '', '', 'thumb'),
      el('div', {},
        p.vendor ? el('span', { class: 'maker-name', text: p.vendor.name }) : null,
        el('span', { style: 'font-size:16px;font-weight:500', text: lineName(p, opt) }),
        el('span', { style: 'font-size:15px;font-weight:600', text: money(priceOf(p, opt)) })
      )
    );
    const recs = recommendations(p);
    els.recsWrap.hidden = recs.length === 0;
    els.recs.replaceChildren(...recs.map((r) => {
      const ro = r.options[0] || null;
      const rp = photoOf(r, ro);
      return el('article', { class: 'rec' },
        photoEl(rp, '', ''),
        el('div', { class: 'rec-body' },
          r.vendor ? el('span', { class: 'maker-name', text: r.vendor.name }) : null,
          el('span', { class: 'rec-name', text: r.name }),
          el('span', { class: 'price', text: (r.options.length > 1 ? 'From ' : '') + money(priceOf(r, ro)) }),
          el('button', { type: 'button', class: 'add', text: 'Add',
            onclick: (e) => { Basket.add(r.id, ro && ro.id, 1); e.currentTarget.textContent = 'Added'; e.currentTarget.disabled = true; } })
        )
      );
    }));
    if (!els.dialog.open) els.dialog.showModal();
  }

  // ---------- product details pop-up ("Read more") ----------
  const info = el('dialog', { class: 'info', 'aria-labelledby': 'info-h' });
  document.body.append(info);
  info.addEventListener('click', (e) => { if (e.target === info) info.close(); });
  function openInfo(p) {
    const opt = chosenOption(p);
    const unit = unitText(p.unit_label);
    info.replaceChildren(
      el('div', { class: 'info-photo' },
        photoEl(photoOf(p, opt), lineName(p, opt), initials((p.vendor && p.vendor.name) || p.name)),
        el('button', { type: 'button', class: 'close', 'aria-label': 'Close', onclick: () => info.close() }, closeIcon())
      ),
      el('div', { class: 'info-body' },
        p.vendor ? el('span', { class: 'maker-name', text: p.vendor.name }) : null,
        el('h2', { id: 'info-h', text: lineName(p, opt) }),
        el('div', { class: 'price-row' },
          el('span', { class: 'price', text: money(priceOf(p, opt)) }),
          unit ? el('span', { class: 'unit', text: unit }) : null),
        el('p', { text: p.description || '' }),
        p.sold_out ? el('button', { type: 'button', class: 'add', disabled: true, text: 'Sold out' })
          : el('button', { type: 'button', class: 'add', text: 'Add to basket',
              onclick: () => { info.close(); addAndShow(p, opt); } })
      )
    );
    info.showModal();
  }
  function closeIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('width', '18'); s.setAttribute('height', '18'); s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('aria-hidden', 'true');
    for (const d of ['M6 6l12 12', 'M18 6L6 18']) { const pth = document.createElementNS(ns, 'path'); pth.setAttribute('d', d); s.append(pth); }
    return s;
  }

  function closeDialog() { if (els.dialog.open) els.dialog.close(); }
  document.getElementById('added-close').addEventListener('click', closeDialog);
  document.getElementById('keep-shopping').addEventListener('click', closeDialog);
  els.dialog.addEventListener('click', (e) => { if (e.target === els.dialog) closeDialog(); });

  // ---------- wire up ----------
  let searchTimer;
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = els.search.value; renderGrid(); }, 120);
  });
  window.addEventListener('basket:change', () => { renderBasketBits(); renderGrid(); });
  window.addEventListener('storage', () => { renderBasketBits(); renderGrid(); });

  // Delivery panel: read the free-delivery rules and fees from the back room's Delivery zones.
  async function renderZones() {
    const box = document.getElementById('zones');
    if (!box) return;
    const { data, error } = await sb.from('delivery_zones').select('name, free_over_cents, fee_cents').eq('active', true).order('free_over_cents');
    if (error || !data || !data.length) return;   // keep the built-in text
    const dollars = (c) => '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100));
    box.replaceChildren(...data.map((z) => el('div', { class: 'zone' },
      el('span', { class: 'zone-name', text: z.name }),
      el('span', { class: 'zone-rule', text: 'Orders over ' + dollars(z.free_over_cents) }),
      el('span', { class: 'zone-fee', text: z.fee_cents != null ? money(z.fee_cents) + ' delivery below that' : 'Minimum order for delivery' }))));
  }
  renderZones().catch(() => {});

  load()
    .then(() => { renderChips(); renderGrid(); renderBasketBits(); })
    .catch((err) => {
      console.error(err);
      els.status.textContent = 'Sorry, this week’s items didn’t load. Please refresh the page in a moment.';
    });
})();
