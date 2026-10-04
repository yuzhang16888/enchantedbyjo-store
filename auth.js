// The name tag: shows "Sign in" or "Hi, Mei" in the top bar of every page.
(function () {
  const sb = window.sb;

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
  function icon(paths, size = 18) {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })
      .forEach(([k, v]) => s.setAttribute(k, v));
    paths.forEach((d) => { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); s.append(p); });
    return s;
  }

  // Who is signed in, plus their customer details (first name etc.)
  async function currentCustomer() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const user = session.user;
    const { data } = await sb.from('customers').select('*').eq('id', user.id).maybeSingle();
    const { data: admin } = await sb.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
    return { user, customer: data || null, isAdmin: !!admin };
  }
  function displayName(me) {
    const first = me.customer && me.customer.first_name;
    if (first) return first;
    const email = me.user.email || '';
    const local = email.split('@')[0] || 'there';
    return local.charAt(0).toUpperCase() + local.slice(1);
  }

  async function signOut() {
    await sb.auth.signOut();
    window.location.href = 'index.html';
  }

  function renderNameTag(me) {
    const slot = document.getElementById('account-slot');
    if (!slot || !me) return;
    const name = displayName(me);
    const menuId = 'account-menu';
    const button = el('button', {
      type: 'button', class: 'name-tag', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-controls': menuId,
      'aria-label': 'Account menu, signed in as ' + name
    },
      el('span', { class: 'avatar', 'aria-hidden': 'true', text: name.charAt(0).toUpperCase() }),
      el('span', { class: 'name-text', text: 'Hi, ' + name }),
      icon(['M6 9l6 6 6-6'], 14)
    );
    const menu = el('div', { class: 'account-menu', id: menuId, hidden: true },
      el('div', { class: 'menu-head' },
        el('span', { class: 'avatar big', 'aria-hidden': 'true', text: name.charAt(0).toUpperCase() }),
        el('div', {}, el('strong', { text: name }), el('span', { class: 'muted small', text: me.user.email }))
      ),
      el('a', { href: 'account.html', class: 'menu-item' }, icon(['M6 3h9l4 4v14H6z', 'M9 12h7', 'M9 16h7'], 20), 'My orders'),
      el('a', { href: 'account.html#details', class: 'menu-item' }, icon(['M4 21a8 8 0 0 1 16 0', 'M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8'], 20), 'My details'),
      me.isAdmin ? el('a', { href: 'admin.html', class: 'menu-item' }, icon(['M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z'], 20), 'Back room') : null,
      me.isAdmin ? el('a', { href: 'admin.html', class: 'menu-item' }, icon(['M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z'], 20), 'Back room') : null,
      el('div', { class: 'menu-divider' }),
      el('button', { type: 'button', class: 'menu-item logout', onclick: signOut }, icon(['M15 4h4v16h-4', 'M10 8l-4 4 4 4', 'M6 12h10'], 20), 'Log out')
    );
    function setOpen(open) {
      menu.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
    }
    button.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.hidden); });
    document.addEventListener('click', (e) => { if (!slot.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setOpen(false); button.focus(); } });
    slot.classList.add('signed-in');
    slot.replaceChildren(button, menu);
  }

  function renderWelcome(me) {
    const card = document.getElementById('welcome');
    if (!card || !me) return;
    const name = displayName(me);
    card.replaceChildren(
      el('h2', { text: 'Welcome back, ' + name }),
      el('p', { text: 'Your past orders and saved details are one tap away.' }),
      el('a', { class: 'btn btn-primary', href: 'account.html', text: 'See my orders' })
    );
  }

  // First sign-in: ask the welcome-email helper to send the welcome (it decides whether to).
  function maybeWelcome(me) {
    if (!me || me.isAdmin || !me.customer || me.customer.welcome_email_at) return;
    try { if (sessionStorage.getItem('enchanted_welcome_checked')) return; sessionStorage.setItem('enchanted_welcome_checked', '1'); } catch (e) { /* ignore */ }
    sb.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      const cfg = window.ENCHANTED_CONFIG;
      fetch(cfg.supabaseUrl + '/functions/v1/welcome-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseKey, Authorization: 'Bearer ' + session.access_token },
        body: '{}'
      }).catch(() => { /* a missed welcome isn't worth bothering the shopper about */ });
    });
  }

  // Other pages wait on this promise, so it never matters which script finishes first.
  const ready = currentCustomer()
    .catch((err) => { console.error(err); return null; })
    .then((me) => { renderNameTag(me); renderWelcome(me); maybeWelcome(me); return me; });

  window.EnchantedAuth = { currentCustomer, displayName, signOut, el, icon, ready };
})();
