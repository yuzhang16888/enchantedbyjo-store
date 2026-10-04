// Enchanted by Jo: the back room.
// Everything here talks to Supabase as the signed-in admin; the database's own
// rules (row level security) make sure only admins can read or change this data.
(function () {
  const sb = window.sb;
  const { el } = window.EnchantedAuth;
  const main = document.getElementById('admin-main');
  const BUCKET = 'product-photos';

  // ---------- small helpers ----------
  const money = (c) => (c < 0 ? '\u2212' : '') + '$' + (Math.abs(c || 0) / 100).toFixed(2);
  const toCents = (v) => { const n = Number(String(v).replace(/[^0-9.]/g, '')); return Number.isFinite(n) && String(v).trim() !== '' ? Math.round(n * 100) : null; };
  const dollars = (c) => (c == null ? '' : (c / 100).toFixed(2));
  const dayLabel = (d) => {
    if (!d) return '';
    const [y, m, day] = d.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  const when = (ts) => new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const shortDate = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  let toastTimer;
  function toast(msg, bad) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 2500);
  }
  async function run(promise, okMsg) {
    const { data, error } = await promise;
    if (error) { console.error(error); toast('That didn\u2019t save: ' + (error.message || 'please try again'), true); throw error; }
    if (okMsg) toast(okMsg);
    return data;
  }
  function field(label, input, hint) {
    const id = input.id || ('f' + Math.random().toString(36).slice(2, 8));
    input.id = id;
    return el('div', { class: 'field' }, el('label', { for: id, text: label }), input, hint ? el('span', { class: 'muted small', text: hint }) : null);
  }
  const input = (attrs) => el('input', Object.assign({ class: 'a-input' }, attrs));
  function select(options, value, attrs = {}) {
    const s = el('select', Object.assign({ class: 'a-input' }, attrs),
      options.map(([v, label]) => { const o = el('option', { value: v, text: label }); if (String(v) === String(value ?? '')) o.selected = true; return o; }));
    return s;
  }
  function toggle(label, checked, onChange) {
    const box = el('input', { type: 'checkbox', role: 'switch' });
    box.checked = !!checked;
    if (onChange) box.addEventListener('change', () => onChange(box.checked, box));
    return el('label', { class: 'a-toggle' }, box, el('span', { text: label }));
  }
  function header(title, sub, ...actions) {
    return el('div', { class: 'a-head' },
      el('div', {}, el('h1', { text: title }), sub ? el('p', { class: 'muted', text: sub }) : null),
      actions.length ? el('div', { class: 'a-actions' }, actions) : null);
  }
  function statCard(label, value, note) {
    return el('div', { class: 'a-stat' }, el('span', { class: 'muted small', text: label }),
      el('strong', { text: String(value) }), note ? el('span', { class: 'muted small', text: note }) : null);
  }
  function loading() { main.replaceChildren(el('p', { class: 'status', text: 'Loading\u2026' })); }

  // Shrink photos before upload (max 1200px, JPEG) so the shop stays fast.
  async function shrink(file, max) {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
  }
  async function uploadPhoto(file, folder, max = 1200) {
    const blob = await shrink(file, max);
    const path = folder + '/' + crypto.randomUUID() + '.jpg';
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) { toast('Photo upload failed: ' + error.message, true); throw error; }
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }
  // A photo box with Upload / Remove. onChange(url or null)
  function photoPicker(url, folder, onChange, opts = {}) {
    const box = el('div', { class: 'a-photo' + (opts.small ? ' small' : '') });
    const fileIn = el('input', { type: 'file', accept: 'image/*', class: 'sr' });
    function draw(u) {
      box.replaceChildren(
        u ? el('img', { src: u, alt: '' }) : el('span', { class: 'muted small', text: opts.small ? 'No photo' : 'No photo yet' }),
        el('div', { class: 'a-photo-actions' },
          el('button', { type: 'button', class: 'a-btn small', text: u ? 'Change' : 'Upload', onclick: () => fileIn.click() }),
          u ? el('button', { type: 'button', class: 'a-btn small quiet', text: 'Remove', onclick: () => { onChange(null); draw(null); } }) : null),
        fileIn);
    }
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0]; if (!f) return;
      box.classList.add('busy');
      try { const u = await uploadPhoto(f, folder, opts.max || 1200); onChange(u); draw(u); toast('Photo uploaded'); }
      catch (e) { /* toast already shown */ }
      finally { box.classList.remove('busy'); fileIn.value = ''; }
    });
    draw(url);
    return box;
  }

  // ---------- ORDERS ----------
  const STATUS = {
    new: ['New', 'st-new', 'preparing', 'Start preparing'],
    preparing: ['Preparing', 'st-prep', 'ready', 'Mark ready'],
    ready: ['Ready', 'st-ready', 'completed', 'Mark completed'],
    completed: ['Completed', 'st-done', null, null],
    cancelled: ['Cancelled', 'st-done', null, null]
  };
  function statusLabel(o) {
    const st = STATUS[o.status] || STATUS.new;
    if (o.fulfillment !== 'delivery') return st;
    if (o.status === 'preparing') return [st[0], st[1], st[2], 'Mark out for delivery'];
    if (o.status === 'ready') return ['Out for delivery', st[1], st[2], 'Mark delivered'];
    return st;
  }
  let orderFilter = 'upcoming';
  async function viewOrders() {
    loading();
    const orders = await run(sb.from('orders').select('*, order_items(*)').eq('payment_status', 'paid')
      .order('pickup_date', { ascending: true }).order('id', { ascending: true }).limit(500));
    const weekAgo = Date.now() - 7 * 864e5;
    const thisWeek = orders.filter((o) => new Date(o.created_at).getTime() >= weekAgo && o.status !== 'cancelled');
    const open = orders.filter((o) => ['new', 'preparing'].includes(o.status));
    const ready = orders.filter((o) => o.status === 'ready');
    const search = input({ type: 'search', placeholder: 'Search name, phone, email or order #', 'aria-label': 'Search orders' });
    const list = el('div', { class: 'a-list' });
    const chips = el('div', { class: 'a-chips', role: 'group', 'aria-label': 'Filter orders' });

    function matches(o) {
      if (orderFilter === 'upcoming' && !['new', 'preparing', 'ready'].includes(o.status)) return false;
      if (orderFilter === 'completed' && o.status !== 'completed') return false;
      if (orderFilter === 'cancelled' && o.status !== 'cancelled') return false;
      const q = search.value.trim().toLowerCase();
      if (!q) return true;
      return [o.id, o.contact_first_name, o.contact_last_name, o.contact_phone, o.contact_email].join(' ').toLowerCase().includes(q.replace(/^#/, ''));
    }
    function drawChips() {
      chips.replaceChildren(...[['upcoming', 'Upcoming'], ['all', 'All paid'], ['completed', 'Completed'], ['cancelled', 'Cancelled']].map(([k, label]) =>
        el('button', { type: 'button', class: 'chip', 'aria-pressed': String(orderFilter === k), text: label,
          onclick: () => { orderFilter = k; drawChips(); drawList(); } })));
    }
    function orderCard(o) {
      const [label, cls, next, nextLabel] = statusLabel(o);
      const where = o.fulfillment === 'pickup'
        ? 'Pickup: ' + (o.pickup_spot_name || '') + (o.pickup_window_label ? ', ' + o.pickup_window_label : '')
        : 'Delivery: ' + [o.delivery_street, o.delivery_city].filter(Boolean).join(', ') + (o.delivery_zone_name ? ' (' + o.delivery_zone_name + ')' : '');
      const items = (o.order_items || []).map((i) => el('li', {},
        el('strong', { text: i.quantity + ' \u00d7 ' }), (i.product_name + (i.option_label ? ', ' + i.option_label : '')),
        i.vendor_name ? el('span', { class: 'muted small', text: '  ' + i.vendor_name }) : null));
      const card = el('article', { class: 'a-card a-order' },
        el('div', { class: 'a-order-top' },
          el('div', {},
            el('div', { class: 'a-order-date', text: dayLabel(o.pickup_date) }),
            el('strong', { text: '#' + o.id + '  ' + o.contact_first_name + ' ' + (o.contact_last_name || '') }),
            el('div', { class: 'muted small' },
              el('a', { href: 'tel:' + o.contact_phone.replace(/[^\d+]/g, ''), text: o.contact_phone }), '  ',
              el('a', { href: 'mailto:' + o.contact_email, text: o.contact_email }))),
          el('span', { class: 'status-pill ' + cls, text: label })),
        el('p', { class: 'a-where', text: where }),
        el('ul', { class: 'a-items' }, items),
        o.notes ? el('p', { class: 'a-notes', text: 'Note: ' + o.notes }) : null,
        el('div', { class: 'a-order-foot' },
          el('span', { class: 'muted small', text: 'Paid ' + money(o.total_cents) + (o.discount_cents ? ' (incl. ' + money(-o.discount_cents) + ' discount)' : '') + ', ordered ' + when(o.created_at) }),
          el('div', { class: 'a-actions' },
            next ? el('button', { type: 'button', class: 'a-btn primary', text: nextLabel + (['ready', 'completed'].includes(next) ? ' \u2709' : ''),
              title: ['ready', 'completed'].includes(next) ? 'Also emails the customer' : null, onclick: (e) => { e.currentTarget.disabled = true; setStatus(o, next); } }) : null,
            ['new', 'preparing'].includes(o.status) ? el('button', { type: 'button', class: 'a-btn quiet', text: 'Cancel order', onclick: () => {
              if (confirm('Cancel order #' + o.id + '? This doesn\u2019t refund the card; refund it in Stripe if needed.')) setStatus(o, 'cancelled');
            } }) : null)));
      return card;
    }
    // Status changes go through the order-status helper, which also emails the customer.
    async function setStatus(o, status) {
      const cfg = window.ENCHANTED_CONFIG;
      const { data: { session } } = await sb.auth.getSession();
      try {
        const res = await fetch(cfg.supabaseUrl + '/functions/v1/order-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseKey, Authorization: 'Bearer ' + (session ? session.access_token : '') },
          body: JSON.stringify({ orderId: o.id, status })
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok || !out.ok) throw new Error(out.error || out.message || ('the helper answered ' + res.status));
        o.status = status; drawList();
        const label = statusLabel(o)[0];
        if (String(out.email).startsWith('sent')) toast('Order #' + o.id + ': ' + label + '. Email ' + out.email + '.');
        else if (String(out.email).startsWith('not sent')) toast('Order #' + o.id + ': ' + label + ', but the email was ' + out.email + '.', true);
        else toast('Order #' + o.id + ': ' + label);
      } catch (e) {
        toast('Couldn\u2019t update order #' + o.id + ': ' + e.message, true);
      }
    }
    function drawList() {
      const shown = orders.filter(matches);
      if (orderFilter !== 'upcoming') shown.sort((a, b) => b.id - a.id);
      list.replaceChildren(...(shown.length ? shown.map(orderCard) : [el('p', { class: 'muted', text: 'No orders here.' })]));
    }
    search.addEventListener('input', drawList);

    // Prep list: everything due on one day, added up and grouped by maker.
    const dueDays = [...new Set(orders.filter((o) => ['new', 'preparing', 'ready'].includes(o.status) && o.pickup_date).map((o) => o.pickup_date))].sort();
    const daySel = select(dueDays.length ? dueDays.map((d) => [d, dayLabel(d)]) : [['', 'No upcoming days']], dueDays[0] || '', { 'aria-label': 'Prep list day' });
    const prepBox = el('div', { class: 'a-prep' });
    function drawPrep() {
      const day = daySel.value;
      const todays = orders.filter((o) => o.pickup_date === day && o.status !== 'cancelled');
      const byVendor = {};
      todays.forEach((o) => (o.order_items || []).forEach((i) => {
        const v = i.vendor_name || 'Other';
        const k = i.product_name + (i.option_label ? ', ' + i.option_label : '');
        (byVendor[v] = byVendor[v] || {})[k] = ((byVendor[v] || {})[k] || 0) + i.quantity;
      }));
      const pickups = todays.filter((o) => o.fulfillment === 'pickup');
      const spots = {};
      pickups.forEach((o) => { const k = (o.pickup_spot_name || 'Pickup') + (o.pickup_window_label ? ', ' + o.pickup_window_label : ''); spots[k] = (spots[k] || 0) + 1; });
      prepBox.replaceChildren(
        todays.length ? el('p', { class: 'muted small', text: todays.length + ' orders: ' + pickups.length + ' pickup, ' + (todays.length - pickups.length) + ' delivery.' }) : el('p', { class: 'muted small', text: 'Nothing due that day.' }),
        ...Object.keys(byVendor).sort().map((v) => el('div', { class: 'a-prep-group' }, el('h3', { text: v }),
          el('ul', {}, Object.entries(byVendor[v]).sort().map(([k, n]) => el('li', {}, el('strong', { text: n + ' \u00d7 ' }), k))))),
        Object.keys(spots).length ? el('div', { class: 'a-prep-group' }, el('h3', { text: 'Pickups by spot' }),
          el('ul', {}, Object.entries(spots).map(([k, n]) => el('li', {}, el('strong', { text: n + ' \u00d7 ' }), k)))) : null);
    }
    daySel.addEventListener('change', drawPrep);
    drawPrep();

    main.replaceChildren(
      header('Orders', 'Paid orders, sorted by pickup or delivery date.'),
      el('div', { class: 'a-stats' },
        statCard('To prepare', open.length, 'New or preparing'),
        statCard('Ready', ready.length, 'Waiting for pickup or delivery'),
        statCard('Orders this week', thisWeek.length, 'Last 7 days'),
        statCard('Sales this week', money(thisWeek.reduce((s, o) => s + o.total_cents, 0)), 'Including tax and delivery')),
      el('details', { class: 'a-card a-pad a-prep-wrap' },
        el('summary', { text: 'Prep list: what to get from each maker' }),
        el('div', { class: 'a-row' }, el('label', { class: 'a-inline' }, 'For ', daySel),
          el('button', { type: 'button', class: 'a-btn small', text: 'Print', onclick: () => window.print() })),
        prepBox),
      el('div', { class: 'a-toolbar' }, chips, search),
      list);
    drawChips(); drawList();
  }

  // ---------- PRODUCTS ----------
  let cache = { vendors: [], categories: [], products: [] };
  async function loadCatalog() {
    const [v, c, p] = await Promise.all([
      run(sb.from('vendors').select('*').order('name')),
      run(sb.from('categories').select('*').order('sort_order')),
      run(sb.from('products').select('*, vendor:vendors(id, name), category:categories(id, name), options:product_options(*)').order('sort_order').order('name'))
    ]);
    cache = { vendors: v, categories: c, products: p };
  }
  let productFilter = { q: '', cat: '', showOff: true };
  async function viewProducts() {
    loading();
    await loadCatalog();
    const search = input({ type: 'search', placeholder: 'Search products or makers', 'aria-label': 'Search products', value: productFilter.q });
    const catSel = select([['', 'All categories'], ...cache.categories.map((c) => [c.id, c.name])], productFilter.cat, { 'aria-label': 'Category' });
    const offToggle = toggle('Show off-menu items', productFilter.showOff, (v) => { productFilter.showOff = v; draw(); });
    const list = el('div', { class: 'a-list' });
    function priceText(p) {
      const opts = (p.options || []).filter((o) => o.active);
      if (!opts.length) return money(p.price_cents);
      const lo = Math.min(...opts.map((o) => o.price_cents));
      return (opts.length > 1 ? 'From ' : '') + money(lo);
    }
    function row(p) {
      return el('div', { class: 'a-card a-prod' + (p.on_menu ? '' : ' off') },
        p.photo_url ? el('img', { class: 'a-thumb', src: p.photo_url, alt: '', loading: 'lazy' }) : el('div', { class: 'a-thumb' }),
        el('div', { class: 'a-prod-info' },
          el('strong', { text: p.name }),
          el('span', { class: 'muted small', text: [p.vendor && p.vendor.name, p.category && p.category.name].filter(Boolean).join(', ') || 'No maker or category yet' }),
          el('span', { class: 'small', text: priceText(p) + (p.taxable ? '  \u00b7 taxed' : '') + ((p.options || []).length ? '  \u00b7 ' + p.options.length + ' options' : '') })),
        el('div', { class: 'a-prod-switches' },
          toggle('On menu', p.on_menu, async (v, box) => {
            try { await run(sb.from('products').update({ on_menu: v }).eq('id', p.id), v ? 'Back on the menu' : 'Taken off the menu'); p.on_menu = v; draw(); }
            catch (e) { box.checked = !v; }
          }),
          toggle('Sold out', p.sold_out, async (v, box) => {
            try { await run(sb.from('products').update({ sold_out: v }).eq('id', p.id), v ? 'Marked sold out' : 'Available again'); p.sold_out = v; }
            catch (e) { box.checked = !v; }
          })),
        el('a', { class: 'a-btn', href: '#product/' + p.id, text: 'Edit' }));
    }
    function draw() {
      productFilter.q = search.value; productFilter.cat = catSel.value;
      const q = search.value.trim().toLowerCase();
      const shown = cache.products.filter((p) =>
        (productFilter.showOff || p.on_menu) &&
        (!catSel.value || (p.category && p.category.id === catSel.value)) &&
        (!q || (p.name + ' ' + (p.vendor ? p.vendor.name : '')).toLowerCase().includes(q)));
      list.replaceChildren(...(shown.length ? shown.map(row) : [el('p', { class: 'muted', text: 'No products match.' })]));
    }
    search.addEventListener('input', draw);
    catSel.addEventListener('change', draw);
    const onMenu = cache.products.filter((p) => p.on_menu).length;
    main.replaceChildren(
      header('Products', onMenu + ' on the menu, ' + (cache.products.length - onMenu) + ' off the menu. Switches save instantly.',
        el('a', { class: 'a-btn primary', href: '#product/new', text: '+ New product' })),
      el('div', { class: 'a-toolbar' }, search, catSel, offToggle),
      list);
    draw();
  }

  async function viewProductEditor(id) {
    loading();
    if (!cache.products.length) await loadCatalog();
    const isNew = id === 'new';
    let p = isNew ? { name: '', description: '', price_cents: 0, unit_label: '', badge: null, taxable: false, on_menu: true, sold_out: false, sort_order: 100, photo_url: null, vendor_id: null, category_id: null, options: [] }
      : cache.products.find((x) => x.id === id);
    if (!p) { main.replaceChildren(el('p', { text: 'That product wasn\u2019t found. ' }, el('a', { href: '#products', text: 'Back to products' }))); return; }
    p = JSON.parse(JSON.stringify(p));
    let options = (p.options || []).slice().sort((a, b) => a.sort_order - b.sort_order).map((o) => ({ ...o }));
    const removedOptions = [];
    let pairs = [];
    if (!isNew) {
      const pr = await run(sb.from('pairings').select('paired_product_id, position').eq('product_id', p.id).order('position'));
      pairs = pr.map((x) => x.paired_product_id);
    }
    let photo = p.photo_url;

    const name = input({ value: p.name, required: true });
    const vendor = select([['', 'Choose a maker'], ...cache.vendors.map((v) => [v.id, v.name])], p.vendor_id);
    const category = select([['', 'Choose a category'], ...cache.categories.map((c) => [c.id, c.name])], p.category_id);
    const desc = el('textarea', { class: 'a-input', rows: '5' }); desc.value = p.description || '';
    const unit = input({ value: p.unit_label || '', placeholder: 'e.g. 500 ml, 7 oz, 2 pack' });
    const price = input({ value: dollars(p.price_cents), inputmode: 'decimal', placeholder: '0.00' });
    const badge = select([['', 'No badge'], ['new', 'New'], ['popular', 'Popular'], ['seasonal', 'Seasonal'], ['popup', 'Pop-up']], p.badge || '');
    const sort = input({ value: String(p.sort_order ?? 100), inputmode: 'numeric' });
    const taxable = toggle('Taxable (not food)', p.taxable);
    const onMenu = toggle('On this week\u2019s menu', p.on_menu);
    const soldOut = toggle('Sold out', p.sold_out);

    const optBox = el('div', { class: 'a-options' });
    function drawOptions() {
      optBox.replaceChildren(
        ...options.map((o, i) => {
          const label = input({ value: o.label || '', placeholder: 'Option name', 'aria-label': 'Option name' });
          const oprice = input({ value: dollars(o.price_cents), inputmode: 'decimal', placeholder: '0.00', 'aria-label': 'Option price', class: 'a-input price' });
          label.addEventListener('input', () => { o.label = label.value; });
          oprice.addEventListener('input', () => { o.price_cents = toCents(oprice.value); });
          return el('div', { class: 'a-opt-row' },
            photoPicker(o.photo_url, 'options', (u) => { o.photo_url = u; }, { small: true }),
            el('div', { class: 'a-opt-fields' }, label, el('div', { class: 'a-opt-line' }, el('span', { class: 'muted', text: '$' }), oprice,
              toggle('Showing', o.active !== false, (v) => { o.active = v; }))),
            el('div', { class: 'a-opt-move' },
              el('button', { type: 'button', class: 'a-btn small quiet', 'aria-label': 'Move up', text: '\u2191', disabled: i === 0, onclick: () => { [options[i - 1], options[i]] = [options[i], options[i - 1]]; drawOptions(); } }),
              el('button', { type: 'button', class: 'a-btn small quiet', 'aria-label': 'Move down', text: '\u2193', disabled: i === options.length - 1, onclick: () => { [options[i + 1], options[i]] = [options[i], options[i + 1]]; drawOptions(); } }),
              el('button', { type: 'button', class: 'a-btn small quiet', 'aria-label': 'Remove option', text: '\u00d7', onclick: () => { if (o.id) removedOptions.push(o.id); options.splice(i, 1); drawOptions(); } })));
        }),
        el('button', { type: 'button', class: 'a-btn', text: '+ Add option', onclick: () => { options.push({ label: '', price_cents: toCents(price.value) || null, active: true, photo_url: null }); drawOptions(); } }));
    }
    drawOptions();

    const others = cache.products.filter((x) => x.id !== p.id).sort((a, b) => a.name.localeCompare(b.name));
    const pairSelects = [0, 1, 2].map((i) => select([['', i === 0 ? 'No pick' : 'No pick'], ...others.map((x) => [x.id, x.name + (x.vendor ? ' (' + x.vendor.name + ')' : '')])], pairs[i] || '', { 'aria-label': 'Goes well with, pick ' + (i + 1) }));

    const err = el('p', { class: 'field-error big', role: 'alert', hidden: true });
    const saveBtn = el('button', { type: 'button', class: 'a-btn primary big', text: isNew ? 'Create product' : 'Save changes' });

    saveBtn.addEventListener('click', async () => {
      err.hidden = true;
      const problems = [];
      if (!name.value.trim()) problems.push('a name');
      const basePrice = toCents(price.value);
      if (!options.length && !(basePrice > 0)) problems.push('a price');
      options.forEach((o, i) => { if (!String(o.label || '').trim() || !(o.price_cents > 0)) problems.push('a name and price for option ' + (i + 1)); });
      if (problems.length) { err.textContent = 'Please add ' + problems.join(', ') + '.'; err.hidden = false; return; }
      saveBtn.disabled = true; saveBtn.textContent = 'Saving\u2026';
      try {
        const row = {
          name: name.value.trim(), vendor_id: vendor.value || null, category_id: category.value || null,
          description: desc.value.trim() || null, unit_label: unit.value.trim() || null,
          price_cents: basePrice ?? (options[0] && options[0].price_cents) ?? 0, badge: badge.value || null,
          sort_order: Number(sort.value) || 0, photo_url: photo || null,
          taxable: taxable.querySelector('input').checked, on_menu: onMenu.querySelector('input').checked,
          sold_out: soldOut.querySelector('input').checked
        };
        let pid = p.id;
        if (isNew) pid = (await run(sb.from('products').insert(row).select('id').single())).id;
        else await run(sb.from('products').update(row).eq('id', pid));

        if (removedOptions.length) await run(sb.from('product_options').delete().in('id', removedOptions));
        for (let i = 0; i < options.length; i++) {
          const o = options[i];
          const orow = { product_id: pid, label: o.label.trim(), price_cents: o.price_cents, photo_url: o.photo_url || null, active: o.active !== false, sort_order: (i + 1) * 10 };
          if (o.id) await run(sb.from('product_options').update(orow).eq('id', o.id));
          else o.id = (await run(sb.from('product_options').insert(orow).select('id').single())).id;
        }
        removedOptions.length = 0;

        const picked = [...new Set(pairSelects.map((s) => s.value).filter(Boolean))];
        await run(sb.from('pairings').delete().eq('product_id', pid));
        if (picked.length) await run(sb.from('pairings').insert(picked.map((x, i) => ({ product_id: pid, paired_product_id: x, position: i + 1 }))));

        toast(isNew ? 'Product created' : 'Saved');
        cache.products = [];
        if (isNew) location.hash = '#product/' + pid;
        else { saveBtn.disabled = false; saveBtn.textContent = 'Save changes'; }
      } catch (e) {
        console.error(e);
        if (!(e && e.code)) toast('That didn\u2019t save: ' + (e && e.message ? e.message : 'please try again'), true);
        saveBtn.disabled = false; saveBtn.textContent = isNew ? 'Create product' : 'Save changes';
      }
    });

    const delBtn = isNew ? null : el('button', { type: 'button', class: 'a-btn quiet', text: 'Delete product', onclick: async () => {
      if (!confirm('Delete "' + p.name + '" for good? Past orders keep their history, but it can\u2019t be undone. (Tip: switching off "On this week\u2019s menu" hides it instead.)')) return;
      await run(sb.from('products').delete().eq('id', p.id), 'Product deleted');
      cache.products = []; location.hash = '#products';
    } });

    main.replaceChildren(
      el('a', { class: 'back-link', href: '#products', text: '\u2190 All products' }),
      header(isNew ? 'New product' : p.name, null, saveBtn),
      el('div', { class: 'a-editor' },
        el('div', { class: 'a-col' },
          el('section', { class: 'a-card a-pad' }, el('h2', { text: 'Basics' }),
            field('Product name', name),
            el('div', { class: 'a-two' }, field('Maker', vendor), field('Category', category)),
            field('Description', desc, 'Shoppers see the first two lines, then Read more.'),
            el('div', { class: 'a-two' }, field('Size label', unit), field('Price ($)', price, options.length ? 'Options have their own prices.' : null)),
            el('div', { class: 'a-two' }, field('Badge', badge), field('Order on page', sort, 'Lower numbers show first.'))),
          el('section', { class: 'a-card a-pad' }, el('h2', { text: 'Options' }),
            el('p', { class: 'muted small', text: 'Flavors, sizes or varieties. Each has its own price and can have its own photo.' }), optBox)),
        el('div', { class: 'a-col narrow-col' },
          el('section', { class: 'a-card a-pad' }, el('h2', { text: 'Main photo' }),
            photoPicker(photo, 'products', (u) => { photo = u; }),
            el('p', { class: 'muted small', text: 'Square photos look best. Big photos are shrunk automatically.' })),
          el('section', { class: 'a-card a-pad' }, el('h2', { text: 'Availability' }), onMenu, soldOut, taxable),
          el('section', { class: 'a-card a-pad' }, el('h2', { text: 'Goes well with' }),
            el('p', { class: 'muted small', text: 'Shown in the Added to basket pop-up. Left empty, the shop suggests items from the same maker or category.' }),
            ...pairSelects),
          delBtn)),
      err,
      el('div', { class: 'a-savebar' }, saveBtn.cloneNode(true)));
    main.querySelector('.a-savebar button').addEventListener('click', () => saveBtn.click());
  }

  // ---------- VENDORS ----------
  async function viewVendors() {
    loading();
    await loadCatalog();
    const counts = {};
    cache.products.forEach((p) => { if (p.vendor) counts[p.vendor.id] = (counts[p.vendor.id] || 0) + 1; });
    const list = el('div', { class: 'a-list' });
    function row(v) {
      const nm = input({ value: v.name, 'aria-label': 'Maker name' });
      const site = input({ value: v.website || '', placeholder: 'Website (optional)', 'aria-label': 'Website' });
      let logo = v.logo_url;
      return el('div', { class: 'a-card a-vendor' },
        photoPicker(logo, 'logos', (u) => { logo = u; }, { small: true, max: 400 }),
        el('div', { class: 'a-opt-fields' }, nm, site, el('span', { class: 'muted small', text: (counts[v.id] || 0) + ' products' })),
        el('div', { class: 'a-actions' },
          el('button', { type: 'button', class: 'a-btn primary', text: 'Save', onclick: async () => {
            if (!nm.value.trim()) return toast('Please add a name', true);
            await run(sb.from('vendors').update({ name: nm.value.trim(), website: site.value.trim() || null, logo_url: logo || null }).eq('id', v.id), 'Saved');
          } }),
          counts[v.id] ? null : el('button', { type: 'button', class: 'a-btn quiet', text: 'Delete', onclick: async () => {
            if (!confirm('Delete ' + v.name + '?')) return;
            await run(sb.from('vendors').delete().eq('id', v.id), 'Deleted'); viewVendors();
          } })));
    }
    list.replaceChildren(...cache.vendors.map(row));
    const newName = input({ placeholder: 'New maker name', 'aria-label': 'New maker name' });
    main.replaceChildren(
      header('Vendors', 'Your makers and their logos. Logos show in a small circle, so square ones work best.'),
      el('div', { class: 'a-toolbar' }, newName, el('button', { type: 'button', class: 'a-btn primary', text: '+ Add maker', onclick: async () => {
        if (!newName.value.trim()) return;
        await run(sb.from('vendors').insert({ name: newName.value.trim() }), 'Maker added'); viewVendors();
      } })),
      list);
  }

  // ---------- CUSTOMERS ----------
  let customerFilter = 'all';
  async function viewCustomers() {
    loading();
    const [allCustomers, orders, signIns, admins] = await Promise.all([
      run(sb.from('customers').select('*').order('created_at', { ascending: false })),
      run(sb.from('orders').select('customer_id, contact_email, total_cents, created_at, status').eq('payment_status', 'paid')),
      sb.rpc('admin_sign_in_info').then((r) => r.data || []),   // empty if step 8 hasn't been run yet
      run(sb.from('admins').select('user_id'))
    ]);
    const adminIds = new Set(admins.map((a) => a.user_id));
    const customers = allCustomers.filter((c) => !adminIds.has(c.id));   // the Enchanted team isn't counted as customers
    const signIn = {};
    signIns.forEach((u) => { signIn[u.id] = u; });
    const haveSignInInfo = signIns.length > 0;
    const stats = {};
    orders.filter((o) => o.status !== 'cancelled').forEach((o) => {
      const k = o.customer_id; if (!k) return;
      const s = stats[k] || (stats[k] = { n: 0, spent: 0, last: null });
      s.n += 1; s.spent += o.total_cents; if (!s.last || o.created_at > s.last) s.last = o.created_at;
    });
    const nOrders = (c) => (stats[c.id] || {}).n || 0;
    const finished = (c) => !haveSignInInfo || !!(signIn[c.id] && signIn[c.id].confirmed_at);
    const weekAgo = Date.now() - 7 * 864e5, monthAgo = Date.now() - 30 * 864e5;
    const repeat = customers.filter((c) => nOrders(c) >= 2).length;
    const joined = customers.filter((c) => finished(c) && new Date(c.created_at).getTime() >= weekAgo).length;
    const quiet = customers.filter((c) => (stats[c.id] || {}).last && new Date(stats[c.id].last).getTime() < monthAgo).length;
    const noOrders = customers.filter((c) => nOrders(c) === 0 && finished(c)).length;
    const unfinished = customers.filter((c) => !finished(c)).length;

    const FILTERS = [
      ['all', 'All customers', () => true],
      ['none', 'Signed in, no orders yet', (c) => nOrders(c) === 0 && finished(c)],
      ['once', 'Ordered once', (c) => nOrders(c) === 1],
      ['repeat', 'Repeat customers', (c) => nOrders(c) >= 2],
      ['unfinished', 'Never finished signing in', (c) => !finished(c)]
    ];
    const search = input({ type: 'search', placeholder: 'Search name, email or phone', 'aria-label': 'Search customers' });
    const filterSel = select(FILTERS.map(([k, label]) => [k, label]), customerFilter, { 'aria-label': 'Show' });
    const sortSel = select([['new', 'Newest first'], ['orders', 'Most orders'], ['last', 'Last order'], ['signin', 'Last sign-in']], 'new', { 'aria-label': 'Sort' });
    const body = el('tbody');
    const countLine = el('p', { class: 'muted small' });
    function shownRows() {
      const q = search.value.trim().toLowerCase();
      const f = (FILTERS.find(([k]) => k === filterSel.value) || FILTERS[0])[2];
      let rows = customers.filter((c) => f(c) && (!q || [c.first_name, c.last_name, c.email, c.phone].join(' ').toLowerCase().includes(q)));
      if (sortSel.value === 'orders') rows.sort((a, b) => nOrders(b) - nOrders(a));
      if (sortSel.value === 'last') rows.sort((a, b) => String((stats[b.id] || {}).last || '').localeCompare(String((stats[a.id] || {}).last || '')));
      if (sortSel.value === 'signin') rows.sort((a, b) => String((signIn[b.id] || {}).last_sign_in_at || '').localeCompare(String((signIn[a.id] || {}).last_sign_in_at || '')));
      return rows;
    }
    function draw() {
      customerFilter = filterSel.value;
      const rows = shownRows();
      countLine.textContent = rows.length + (rows.length === 1 ? ' customer' : ' customers') + ' shown.';
      body.replaceChildren(...rows.map((c) => {
        const s = stats[c.id] || { n: 0, spent: 0, last: null };
        const si = signIn[c.id] || {};
        return el('tr', {},
          el('td', {}, el('strong', { text: [c.first_name, c.last_name].filter(Boolean).join(' ') || '(no name yet)' }),
            s.n >= 2 ? el('span', { class: 'a-tag', text: 'Repeat' }) : null,
            !finished(c) ? el('span', { class: 'a-tag quiet', text: 'Never finished signing in' }) : null),
          el('td', {}, el('a', { href: 'mailto:' + c.email, text: c.email })),
          el('td', { text: c.phone || '' }),
          el('td', { text: shortDate(c.created_at) }),
          el('td', { text: si.last_sign_in_at ? shortDate(si.last_sign_in_at) : '' }),
          el('td', { text: String(s.n) }),
          el('td', { text: money(s.spent) }),
          el('td', { text: s.last ? shortDate(s.last) : '' }));
      }));
    }
    function downloadCsv() {
      const rows = shownRows();
      const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
      const lines = [['Email Address', 'First Name', 'Last Name', 'Phone', 'Joined', 'Orders'].join(',')]
        .concat(rows.map((c) => [c.email, c.first_name, c.last_name, c.phone, shortDate(c.created_at), nOrders(c)].map(q).join(',')));
      const name = 'enchanted-customers-' + filterSel.value + '.csv';
      const a = el('a', { href: URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })), download: name });
      document.body.append(a); a.click(); a.remove();
      toast('Downloaded ' + rows.length + ' customers');
    }
    search.addEventListener('input', draw); sortSel.addEventListener('change', draw); filterSel.addEventListener('change', draw);
    main.replaceChildren(
      header('Customers', 'Everyone who has signed up. The download matches what\u2019s shown.',
        el('button', { type: 'button', class: 'a-btn', text: 'Download shown list for Mailchimp', onclick: downloadCsv })),
      el('div', { class: 'a-stats' },
        statCard('Customers with accounts', customers.length - unfinished, joined + ' joined this week'),
        statCard('Signed in, no orders yet', noOrders, 'Worth a friendly nudge'),
        statCard('Repeat customers', repeat, 'Ordered 2 or more times'),
        statCard('Not back in 30 days', quiet, 'Ordered before, quiet lately')),
      haveSignInInfo ? null : el('p', { class: 'notice-bar', text: 'Run the step 8 recipe in Supabase to see sign-in dates and who never finished signing in.' }),
      el('div', { class: 'a-toolbar' }, filterSel, search, sortSel),
      countLine,
      el('div', { class: 'a-card a-table-wrap' }, el('table', { class: 'a-table' },
        el('thead', {}, el('tr', {}, ...['Customer', 'Email', 'Phone', 'Joined', 'Last sign-in', 'Orders', 'Spent', 'Last order'].map((h) => el('th', { scope: 'col', text: h })))),
        body)));
    draw();
  }

  // ---------- MESSAGES ----------
  async function viewMessages() {
    loading();
    const msgs = await run(sb.from('contact_messages').select('*').order('handled').order('created_at', { ascending: false }).limit(200));
    const list = el('div', { class: 'a-list' });
    list.replaceChildren(...(msgs.length ? msgs.map((m) => el('article', { class: 'a-card a-pad a-msg' + (m.handled ? ' done' : '') },
      el('div', { class: 'a-order-top' },
        el('div', {}, el('strong', { text: m.name + ', ' + m.topic }), el('div', { class: 'muted small', text: when(m.created_at) + (m.order_number ? ', order #' + m.order_number : '') })),
        toggle('Handled', m.handled, async (v, box) => {
          try { await run(sb.from('contact_messages').update({ handled: v }).eq('id', m.id)); m.handled = v; box.closest('.a-msg').classList.toggle('done', v); refreshBadge(); }
          catch (e) { box.checked = !v; }
        })),
      el('p', { class: 'a-msg-text', text: m.message }),
      el('a', { class: 'a-btn', href: 'mailto:' + m.email + '?subject=' + encodeURIComponent('Re: ' + m.topic), text: 'Reply to ' + m.email })))
      : [el('p', { class: 'muted', text: 'No messages yet.' })]));
    main.replaceChildren(header('Messages', 'From the Contact us form. New ones also arrive by email.'), list);
  }
  async function refreshBadge() {
    const { count } = await sb.from('contact_messages').select('id', { count: 'exact', head: true }).eq('handled', false);
    const b = document.getElementById('msg-badge');
    b.hidden = !count; b.textContent = String(count || '');
  }

  // ---------- SETTINGS ----------
  async function viewSettings() {
    loading();
    const [spots, wins, zones, codes, settings] = await Promise.all([
      run(sb.from('pickup_spots').select('*').order('sort_order')),
      run(sb.from('pickup_windows').select('*').order('sort_order')),
      run(sb.from('delivery_zones').select('*').order('free_over_cents')),
      run(sb.from('promo_codes').select('*').order('created_at', { ascending: false })),
      run(sb.from('settings').select('*'))
    ]);
    const setting = (k) => (settings.find((s) => s.key === k) || {}).value;

    // Pickup spots
    const spotRows = el('div', { class: 'a-rows' });
    const drawSpots = () => spotRows.replaceChildren(...spots.map((s) => {
      const nm = input({ value: s.name, 'aria-label': 'Spot name' });
      const ad = input({ value: s.address || '', placeholder: 'Area or address', 'aria-label': 'Address' });
      const so = input({ value: String(s.sort_order), class: 'a-input tiny', 'aria-label': 'Order', inputmode: 'numeric' });
      const act = toggle('Active', s.active);
      return el('div', { class: 'a-row' }, nm, ad, so, act,
        el('button', { type: 'button', class: 'a-btn', text: 'Save', onclick: () => run(sb.from('pickup_spots').update({ name: nm.value.trim(), address: ad.value.trim() || null, sort_order: Number(so.value) || 0, active: act.querySelector('input').checked }).eq('id', s.id), 'Pickup spot saved') }));
    }));
    drawSpots();
    const newSpot = input({ placeholder: 'New pickup spot', 'aria-label': 'New pickup spot' });

    // Pickup windows
    const winRows = el('div', { class: 'a-rows' });
    const drawWins = () => winRows.replaceChildren(...wins.map((w) => {
      const lb = input({ value: w.label, 'aria-label': 'Time window' });
      const so = input({ value: String(w.sort_order), class: 'a-input tiny', 'aria-label': 'Order', inputmode: 'numeric' });
      const act = toggle('Active', w.active);
      return el('div', { class: 'a-row' }, lb, so, act,
        el('button', { type: 'button', class: 'a-btn', text: 'Save', onclick: () => run(sb.from('pickup_windows').update({ label: lb.value.trim(), sort_order: Number(so.value) || 0, active: act.querySelector('input').checked }).eq('id', w.id), 'Time window saved') }));
    }));
    drawWins();
    const newWin = input({ placeholder: 'e.g. 11:30 am \u2013 1:00 pm', 'aria-label': 'New time window' });

    // Delivery zones
    const zoneRows = el('div', { class: 'a-rows' }, zones.map((z) => {
      const free = input({ value: dollars(z.free_over_cents), inputmode: 'decimal', class: 'a-input small-in', 'aria-label': 'Free delivery over' });
      const fee = input({ value: dollars(z.fee_cents), inputmode: 'decimal', class: 'a-input small-in', placeholder: 'none', 'aria-label': 'Fee below that' });
      const act = toggle('Active', z.active);
      return el('div', { class: 'a-row' }, el('strong', { class: 'a-row-name', text: z.name }),
        el('label', { class: 'a-inline' }, 'Free over $', free), el('label', { class: 'a-inline' }, 'Otherwise $', fee), act,
        el('button', { type: 'button', class: 'a-btn', text: 'Save', onclick: () => run(sb.from('delivery_zones').update({ free_over_cents: toCents(free.value) ?? 0, fee_cents: toCents(fee.value), active: act.querySelector('input').checked }).eq('id', z.id), 'Delivery zone saved') }));
    }));

    // Promo codes
    let showOld = false;
    const codeRows = el('div', { class: 'a-rows' });
    const isOld = (c) => (c.expires_at && new Date(c.expires_at) < new Date()) || (c.single_use && c.used_at);
    const drawCodes = () => codeRows.replaceChildren(...codes.filter((c) => showOld || !isOld(c)).map((c) => el('div', { class: 'a-row' },
      el('strong', { class: 'a-row-name', text: c.code }),
      el('span', { text: c.percent_off ? c.percent_off + '% off' : money(c.amount_off_cents) + ' off' }),
      el('span', { class: 'muted small', text: (c.partner || '') + (c.expires_at ? '  ends ' + shortDate(c.expires_at) : '  no end date') + (isOld(c) ? '  (expired or used)' : '') }),
      toggle('Active', c.active, async (v, box) => { try { await run(sb.from('promo_codes').update({ active: v }).eq('id', c.id), v ? 'Code switched on' : 'Code switched off'); c.active = v; } catch (e) { box.checked = !v; } }))));
    drawCodes();
    const pc = input({ placeholder: 'CODE', 'aria-label': 'New code', autocapitalize: 'characters' });
    const pcAmt = input({ placeholder: '10', inputmode: 'decimal', class: 'a-input small-in', 'aria-label': 'Discount amount' });
    const pcKind = select([['percent', '% off'], ['amount', '$ off']], 'percent', { 'aria-label': 'Discount type' });
    const pcPartner = input({ placeholder: 'Partner (optional)', 'aria-label': 'Partner' });
    const pcEnd = input({ type: 'date', 'aria-label': 'End date (optional)' });

    // Closed dates
    let closed = Array.isArray(setting('extra_closed_dates')) ? setting('extra_closed_dates').slice().sort() : [];
    const closedList = el('div', { class: 'a-chips' });
    const saveClosed = () => run(sb.from('settings').upsert({ key: 'extra_closed_dates', value: closed }), 'Closed dates saved');
    const drawClosed = () => closedList.replaceChildren(...(closed.length ? closed.map((d) => el('span', { class: 'a-tag big' }, dayLabel(d) + ', ' + d.slice(0, 4),
      el('button', { type: 'button', class: 'a-x', 'aria-label': 'Remove ' + d, text: '\u00d7', onclick: async () => { closed = closed.filter((x) => x !== d); await saveClosed(); drawClosed(); } })))
      : [el('span', { class: 'muted small', text: 'No extra closed dates. Sundays and the four holidays are always closed.' })]));
    drawClosed();
    const closedIn = input({ type: 'date', 'aria-label': 'Add a closed date' });

    const tax = input({ value: String(setting('tax_rate') ?? ''), inputmode: 'decimal', class: 'a-input small-in', 'aria-label': 'Sales tax rate' });

    // Photos still on the old Replit site
    const [oldP, oldO, oldV] = await Promise.all([
      run(sb.from('products').select('photo_url, photos')),
      run(sb.from('product_options').select('photo_url')),
      run(sb.from('vendors').select('logo_url'))
    ]);
    const isOldUrl = (u) => typeof u === 'string' && u.includes('/objects/uploads/');
    const oldSet = new Set();
    oldP.forEach((p) => { if (isOldUrl(p.photo_url)) oldSet.add(p.photo_url); (p.photos || []).forEach((u) => { if (isOldUrl(u)) oldSet.add(u); }); });
    oldO.forEach((o) => { if (isOldUrl(o.photo_url)) oldSet.add(o.photo_url); });
    oldV.forEach((v) => { if (isOldUrl(v.logo_url)) oldSet.add(v.logo_url); });
    const photoReport = el('div', { class: 'a-rows' });
    const photoBtn = el('button', { type: 'button', class: 'a-btn primary', text: 'Move photos from old site', disabled: oldSet.size === 0 });
    photoBtn.addEventListener('click', async () => {
      photoBtn.disabled = true; photoBtn.textContent = 'Moving photos\u2026 this can take a minute or two';
      try {
        const cfg = window.ENCHANTED_CONFIG;
        const { data: { session } } = await sb.auth.getSession();
        const res = await fetch(cfg.supabaseUrl + '/functions/v1/copy-photos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseKey, Authorization: 'Bearer ' + (session ? session.access_token : '') },
          body: '{}'
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || out.message || ('the helper answered ' + res.status));
        photoReport.replaceChildren(
          el('p', { class: 'saved', text: 'Moved ' + out.moved + ' of ' + out.found + ' photos, and updated ' + out.updated + ' products, options and logos.' }),
          out.remaining ? el('p', { class: 'muted small', text: out.remaining + ' photos are still waiting. Press the button again to finish.' }) : null,
          ...(out.failed || []).map((f) => el('p', { class: 'field-error', text: 'Couldn\u2019t move ' + f.url.split('/').pop() + ': ' + f.reason })));
        photoBtn.textContent = out.remaining || (out.failed || []).length ? 'Try again for the rest' : 'All photos moved';
        photoBtn.disabled = !(out.remaining || (out.failed || []).length);
        cache.products = [];
      } catch (e) {
        photoReport.replaceChildren(el('p', { class: 'field-error', text: 'Photos didn\u2019t move: ' + e.message }));
        photoBtn.disabled = false; photoBtn.textContent = 'Move photos from old site';
      }
    });

    main.replaceChildren(
      header('Settings', 'Changes here show on the shop right away.'),
      el('section', { class: 'a-card a-pad' }, el('h2', { text: 'Photos on the old site' }),
        el('p', { class: 'muted small', text: oldSet.size
          ? oldSet.size + ' photos still live on the old Replit site. Move them before enchantedbyjo.com switches to the new site, or they\u2019ll disappear.'
          : 'All photos live in your own photo shelf. Nothing to move.' }),
        el('div', { class: 'a-row' }, photoBtn), photoReport),
      el('section', { class: 'a-card a-pad' }, el('h2', { text: 'Pickup spots' }), spotRows,
        el('div', { class: 'a-row' }, newSpot, el('button', { type: 'button', class: 'a-btn primary', text: '+ Add spot', onclick: async () => {
          if (!newSpot.value.trim()) return;
          const row = await run(sb.from('pickup_spots').insert({ name: newSpot.value.trim(), active: true, sort_order: spots.length + 1 }).select('*').single(), 'Pickup spot added');
          spots.push(row); newSpot.value = ''; drawSpots();
        } }))),
      el('section', { class: 'a-card a-pad' }, el('h2', { text: 'Pickup time windows' }), winRows,
        el('div', { class: 'a-row' }, newWin, el('button', { type: 'button', class: 'a-btn primary', text: '+ Add window', onclick: async () => {
          if (!newWin.value.trim()) return;
          const row = await run(sb.from('pickup_windows').insert({ label: newWin.value.trim(), active: true, sort_order: wins.length + 1 }).select('*').single(), 'Time window added');
          wins.push(row); newWin.value = ''; drawWins();
        } }))),
      el('section', { class: 'a-card a-pad' }, el('h2', { text: 'Delivery zones' }),
        el('p', { class: 'muted small', text: 'Leave "Otherwise" empty to require the free-delivery minimum.' }), zoneRows),
      el('section', { class: 'a-card a-pad' }, el('h2', { text: 'Promo codes' }),
        toggle('Show expired and used codes', false, (v) => { showOld = v; drawCodes(); }), codeRows,
        el('div', { class: 'a-row wrap' }, pc, pcAmt, pcKind, pcPartner, pcEnd,
          el('button', { type: 'button', class: 'a-btn primary', text: '+ Add code', onclick: async () => {
            const code = pc.value.trim().toUpperCase().replace(/\s+/g, '');
            const amt = Number(pcAmt.value);
            if (!code || !(amt > 0)) return toast('Add a code and an amount', true);
            if (pcKind.value === 'percent' && amt > 100) return toast('Percent must be 100 or less', true);
            const row = await run(sb.from('promo_codes').insert({
              code, partner: pcPartner.value.trim() || null, active: true,
              percent_off: pcKind.value === 'percent' ? Math.round(amt) : null,
              amount_off_cents: pcKind.value === 'amount' ? Math.round(amt * 100) : null,
              expires_at: pcEnd.value ? new Date(pcEnd.value + 'T23:59:00').toISOString() : null
            }).select('*').single(), 'Code ' + code + ' added');
            codes.unshift(row); pc.value = ''; pcAmt.value = ''; pcPartner.value = ''; pcEnd.value = ''; drawCodes();
          } }))),
      el('section', { class: 'a-card a-pad' }, el('h2', { text: 'Extra closed days' }),
        el('p', { class: 'muted small', text: 'Vacations or days off. Customers can\u2019t pick these dates, and the 2-working-day count skips them.' }),
        closedList, el('div', { class: 'a-row' }, closedIn, el('button', { type: 'button', class: 'a-btn primary', text: '+ Close this day', onclick: async () => {
          if (!closedIn.value || closed.includes(closedIn.value)) return;
          closed = [...closed, closedIn.value].sort(); await saveClosed(); closedIn.value = ''; drawClosed();
        } }))),
      el('section', { class: 'a-card a-pad' }, el('h2', { text: 'Sales tax' }),
        el('div', { class: 'a-row' }, el('label', { class: 'a-inline' }, 'Rate ', tax, ' %'),
          el('button', { type: 'button', class: 'a-btn', text: 'Save', onclick: () => {
            const r = Number(tax.value); if (!(r >= 0 && r < 20)) return toast('Please enter a rate like 8.625', true);
            run(sb.from('settings').upsert({ key: 'tax_rate', value: r }), 'Tax rate saved');
          } })),
        el('p', { class: 'muted small', text: 'Applies only to products marked Taxable.' })));
  }

  // ---------- routing ----------
  const VIEWS = { orders: viewOrders, products: viewProducts, vendors: viewVendors, customers: viewCustomers, messages: viewMessages, settings: viewSettings };
  async function route() {
    const hash = (location.hash || '#orders').slice(1);
    const [name, arg] = hash.split('/');
    document.querySelectorAll('.admin-nav a').forEach((a) => a.setAttribute('aria-current', a.dataset.view === (name === 'product' ? 'products' : name) ? 'page' : 'false'));
    try {
      if (name === 'product' && arg) await viewProductEditor(arg);
      else await (VIEWS[name] || viewOrders)();
      main.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    } catch (e) {
      console.error(e);
      main.replaceChildren(el('p', { class: 'field-error big', text: 'This page didn\u2019t load. Please refresh in a moment.' }));
    }
  }

  document.getElementById('admin-logout').addEventListener('click', window.EnchantedAuth.signOut);
  main.setAttribute('tabindex', '-1');

  window.EnchantedAuth.ready.then((me) => {
    if (!me) { location.replace('signin.html?next=admin.html'); return; }
    if (!me.isAdmin) {
      main.replaceChildren(el('div', { class: 'a-card a-pad' }, el('h1', { text: 'This area is for the Enchanted team' }),
        el('p', { class: 'muted', text: 'You\u2019re signed in as ' + me.user.email + ', which isn\u2019t an admin account.' }),
        el('a', { class: 'a-btn', href: 'index.html', text: 'Back to the shop' })));
      return;
    }
    window.addEventListener('hashchange', route);
    route();
    refreshBadge();
  });
})();
