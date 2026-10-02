(function () {
  const sb = window.sb;
  const cfg = window.ENCHANTED_CONFIG;
  const { el } = window.EnchantedAuth;
  const $ = (id) => document.getElementById(id);
  const money = (c) => (c < 0 ? '\u2212' : '') + '$' + (Math.abs(c || 0) / 100).toFixed(2);

  const state = {
    products: new Map(), spots: [], windows: [], zones: [], dates: [], taxRate: 0,
    fulfillment: 'pickup', zoneId: null, promo: null, me: null
  };

  // Same math as the order helper on Supabase; this is the estimate shown here.
  function computeTotals(lines) {
    const subtotal = lines.reduce((s, l) => s + l.unit * l.qty, 0);
    let discount = 0;
    if (state.promo && state.promo.percent_off) discount = Math.round(subtotal * state.promo.percent_off / 100);
    else if (state.promo && state.promo.amount_off_cents) discount = Math.min(state.promo.amount_off_cents, subtotal);
    const after = subtotal - discount;
    let fee = 0, blocked = null;
    if (state.fulfillment === 'delivery') {
      const z = state.zones.find((x) => x.id === state.zoneId);
      if (z) {
        if (after >= z.free_over_cents) fee = 0;
        else if (z.fee_cents == null) blocked = z;
        else fee = z.fee_cents;
      }
    }
    const taxable = lines.filter((l) => l.taxable).reduce((s, l) => s + l.unit * l.qty, 0);
    const taxableDiscount = subtotal ? Math.round(discount * taxable / subtotal) : 0;
    const tax = Math.round((taxable - taxableDiscount) * state.taxRate / 100);
    return { subtotal, discount, fee, tax, total: after + fee + tax, blocked };
  }

  // Basket lines joined with live product info (anything no longer on the menu is dropped).
  function currentLines() {
    const out = [];
    for (const l of Basket.lines()) {
      const p = state.products.get(l.productId);
      if (!p) continue;
      const o = l.optionId ? p.options.find((x) => x.id === l.optionId) : null;
      if (l.optionId && !o) continue;
      out.push({ ...l, p, o, unit: o ? o.price_cents : (p.price_cents || 0), taxable: !!p.taxable,
        name: o ? p.name + ', ' + o.label : p.name, photo: (o && o.photo_url) || p.photo_url });
    }
    return out;
  }

  function stepper(l) {
    return el('div', { class: 'stepper small-stepper' },
      el('button', { type: 'button', 'aria-label': 'Remove one ' + l.name, text: '\u2212', onclick: () => Basket.setQty(l.productId, l.optionId, l.qty - 1) }),
      el('span', { text: String(l.qty) }),
      el('button', { type: 'button', 'aria-label': 'Add one more ' + l.name, text: '+', onclick: () => Basket.setQty(l.productId, l.optionId, Math.min(20, l.qty + 1)) })
    );
  }

  function render() {
    const lines = currentLines();
    $('status').textContent = '';
    $('empty').hidden = lines.length > 0;
    $('checkout').hidden = lines.length === 0;
    if (!lines.length) return;

    $('lines').replaceChildren(...lines.map((l) => {
      const thumb = l.photo ? el('img', { class: 'line-thumb', src: l.photo, alt: '', loading: 'lazy' }) : el('div', { class: 'line-thumb', 'aria-hidden': 'true' });
      thumb.addEventListener && thumb.addEventListener('error', () => thumb.replaceWith(el('div', { class: 'line-thumb', 'aria-hidden': 'true' })), { once: true });
      return el('div', { class: 'line' },
        thumb,
        el('div', { class: 'line-info' },
          l.p.vendor ? el('span', { class: 'maker-name', text: l.p.vendor.name }) : null,
          el('span', { class: 'line-name', text: l.name }),
          el('span', { class: 'line-price' }, money(l.unit * l.qty),
            l.qty > 1 ? el('span', { class: 'muted small each', text: ' ' + money(l.unit) + ' each' }) : null)
        ),
        stepper(l)
      );
    }));

    const t = computeTotals(lines);
    const rows = [['Subtotal', money(t.subtotal)]];
    if (t.discount) rows.push(['Discount (' + state.promo.code.toUpperCase() + ')', money(-t.discount)]);
    if (state.fulfillment === 'pickup') rows.push(['Pickup', 'Free']);
    else if (!state.zoneId) rows.push(['Delivery', 'Choose your area']);
    else if (t.blocked) rows.push(['Delivery', 'From $' + (t.blocked.free_over_cents / 100).toFixed(0)]);
    else rows.push(['Delivery', t.fee ? money(t.fee) : 'Free']);
    rows.push(['Sales tax', money(t.tax)]);
    $('summary').replaceChildren(
      ...rows.map(([k, v]) => el('div', { class: 'sum-row' }, el('dt', { text: k }), el('dd', { text: v }))),
      el('div', { class: 'sum-row total' }, el('dt', { text: 'Total' }), el('dd', { text: money(t.total) }))
    );

    const payBtn = $('pay-btn');
    if (t.blocked) {
      payBtn.disabled = true;
      payBtn.textContent = 'Delivery to ' + t.blocked.name + ' starts at $' + (t.blocked.free_over_cents / 100).toFixed(0);
    } else if (!payBtn.dataset.busy) {
      payBtn.disabled = false;
      payBtn.textContent = 'Pay ' + money(t.total) + ' securely with card';
    }
    renderZones(t);
  }

  function renderZones(t) {
    const box = $('zone-choices');
    box.replaceChildren(...state.zones.map((z) => {
      const rule = z.fee_cents == null
        ? 'Free over $' + (z.free_over_cents / 100).toFixed(0) + ' (minimum order)'
        : 'Free over $' + (z.free_over_cents / 100).toFixed(0) + ', otherwise ' + money(z.fee_cents);
      const input = el('input', { type: 'radio', name: 'zone', value: z.id });
      input.checked = state.zoneId === z.id;
      input.addEventListener('change', () => { state.zoneId = z.id; render(); });
      return el('label', { class: 'zone-choice' }, input,
        el('span', {}, el('span', { class: 'check-title', text: z.name }), el('span', { class: 'muted small', text: rule })));
    }));
  }

  function fillDates(select) {
    select.replaceChildren(...state.dates.map((d) => {
      const [y, m, day] = d.split('-').map(Number);
      const label = new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
      return el('option', { value: d, text: label });
    }));
  }

  function setFulfillment(kind) {
    state.fulfillment = kind;
    $('seg-pickup').setAttribute('aria-pressed', String(kind === 'pickup'));
    $('seg-delivery').setAttribute('aria-pressed', String(kind === 'delivery'));
    $('pickup-box').hidden = kind !== 'pickup';
    $('delivery-box').hidden = kind !== 'delivery';
    render();
  }

  async function applyPromo() {
    const code = $('promo').value.trim();
    $('promo-error').hidden = true; $('promo-ok').hidden = true;
    if (!code) { state.promo = null; render(); return; }
    const { data, error } = await sb.rpc('check_promo', { p_code: code, p_email: $('email').value.trim() || null });
    const found = Array.isArray(data) ? data[0] : data;
    if (error || !found) {
      state.promo = null;
      $('promo-error').textContent = 'That code isn\u2019t valid or has expired.';
      $('promo-error').hidden = false;
    } else {
      state.promo = found;
      $('promo-ok').textContent = found.percent_off ? found.percent_off + '% off applied.' : money(found.amount_off_cents) + ' off applied.';
      $('promo-ok').hidden = false;
    }
    render();
  }

  function prefill(me) {
    if (!me) return;
    const c = me.customer || {};
    $('signin-hint').hidden = true;
    $('first').value = c.first_name || '';
    $('last').value = c.last_name || '';
    $('phone').value = c.phone || '';
    $('email').value = me.user.email || '';
    $('email').readOnly = true;
    const hasDetails = !!(c.first_name && c.phone);
    $('from-account').hidden = !hasDetails;
    $('save-title').textContent = 'Update my saved details with these';
    $('save-note').textContent = 'Handy if anything above has changed.';
    $('save-details').checked = !hasDetails;
    if (c.usual_fulfillment === 'delivery') {
      $('street').value = c.delivery_street || '';
      $('city').value = c.delivery_city || '';
      setFulfillment('delivery');
    }
    if (c.usual_pickup_spot_id && state.spots.some((s) => s.id === c.usual_pickup_spot_id)) $('spot').value = c.usual_pickup_spot_id;
  }

  function fail(msg, focusId) {
    $('pay-error').textContent = msg;
    $('pay-error').hidden = false;
    if (focusId) $(focusId).focus();
  }

  async function pay(e) {
    e.preventDefault();
    $('pay-error').hidden = true;
    const lines = currentLines();
    if (!lines.length) return;
    const first = $('first').value.trim(), phone = $('phone').value.trim(), email = $('email').value.trim();
    if (!first) return fail('Please add your first name.', 'first');
    if (phone.replace(/\D/g, '').length < 7) return fail('Please add a mobile number we can text.', 'phone');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Please add a valid email address.', 'email');
    const body = {
      items: lines.map((l) => ({ productId: l.productId, optionId: l.optionId, qty: l.qty })),
      contact: { first, last: $('last').value.trim(), phone, email },
      fulfillment: state.fulfillment,
      promoCode: state.promo ? state.promo.code : '',
      notes: $('notes').value.trim(),
      saveDetails: $('save-details').checked
    };
    if (state.fulfillment === 'pickup') {
      Object.assign(body, { pickupSpotId: $('spot').value, pickupWindowId: $('window').value, date: $('pickup-date').value });
    } else {
      if (!state.zoneId) return fail('Please choose your delivery area.');
      if (!$('street').value.trim() || !$('city').value.trim()) return fail('Please add your delivery address.', 'street');
      Object.assign(body, { deliveryZoneId: state.zoneId, street: $('street').value.trim(), city: $('city').value.trim(), date: $('delivery-date').value });
    }

    const btn = $('pay-btn');
    btn.dataset.busy = '1'; btn.disabled = true; btn.textContent = 'Opening secure payment\u2026';
    try {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(cfg.supabaseUrl + '/functions/v1/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseKey,
          Authorization: 'Bearer ' + (session ? session.access_token : cfg.supabaseKey) },
        body: JSON.stringify(body)
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.url) throw new Error(out.error || 'Something went wrong. Please try again in a moment.');
      window.location.href = out.url;
    } catch (err) {
      delete btn.dataset.busy;
      fail(err.message);
      render();
    }
  }

  async function load() {
    const ids = [...new Set(Basket.lines().map((l) => l.productId))];
    const [prod, spots, wins, zones, dates, tax] = await Promise.all([
      ids.length ? sb.from('products').select('id, name, photo_url, price_cents, taxable, vendor:vendors(name), options:product_options(id, label, price_cents, photo_url)').in('id', ids) : { data: [] },
      sb.from('pickup_spots').select('id, name, address').eq('active', true).order('sort_order'),
      sb.from('pickup_windows').select('id, label').eq('active', true).order('sort_order'),
      sb.from('delivery_zones').select('id, name, free_over_cents, fee_cents').eq('active', true).order('free_over_cents'),
      sb.rpc('available_dates', { how_many: 10 }),
      sb.from('settings').select('value').eq('key', 'tax_rate').maybeSingle()
    ]);
    for (const r of [prod, spots, wins, zones, dates]) if (r.error) throw r.error;
    (prod.data || []).forEach((p) => state.products.set(p.id, p));
    state.spots = spots.data || [];
    state.windows = wins.data || [];
    state.zones = zones.data || [];
    state.dates = dates.data || [];
    state.taxRate = Number((tax.data && tax.data.value) || 0);

    $('spot').replaceChildren(...state.spots.map((s) => el('option', { value: s.id, text: s.name + (s.address ? ' (' + s.address + ')' : '') })));
    $('window').replaceChildren(...state.windows.map((w) => el('option', { value: w.id, text: w.label })));
    fillDates($('pickup-date'));
    fillDates($('delivery-date'));
    if (!state.spots.length) {   // no pickup spots yet: delivery only
      $('seg-pickup').hidden = true;
      state.fulfillment = 'delivery';
    }
    setFulfillment(state.fulfillment);
  }

  if (new URLSearchParams(window.location.search).get('cancelled')) $('cancelled-note').hidden = false;
  $('seg-pickup').addEventListener('click', () => setFulfillment('pickup'));
  $('seg-delivery').addEventListener('click', () => setFulfillment('delivery'));
  $('promo-apply').addEventListener('click', applyPromo);
  $('promo').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyPromo(); } });
  $('checkout-form').addEventListener('submit', pay);
  window.addEventListener('basket:change', render);

  load()
    .then(() => window.EnchantedAuth.ready)
    .then((me) => { prefill(me); render(); })
    .catch((err) => {
      console.error(err);
      $('status').textContent = 'Sorry, your basket didn\u2019t load. Please refresh the page in a moment.';
    });
})();
