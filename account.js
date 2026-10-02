(function () {
  const sb = window.sb;
  const { el } = window.EnchantedAuth;
  const $ = (id) => document.getElementById(id);
  const money = (c) => '$' + ((c || 0) / 100).toFixed(2);
  const STATUS = {
    new: ['Order received', 'st-new'],
    preparing: ['Being prepared', 'st-prep'],
    ready: ['Ready', 'st-ready'],
    completed: ['Completed', 'st-done'],
    cancelled: ['Cancelled', 'st-done']
  };

  function orderCard(o) {
    const items = (o.order_items || []);
    const summary = items.map((i) => i.product_name + (i.option_label ? ' (' + i.option_label + ')' : '') + (i.quantity > 1 ? ' × ' + i.quantity : '')).join(', ');
    const count = items.reduce((n, i) => n + i.quantity, 0);
    const date = new Date(o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const [label, cls] = STATUS[o.status] || [o.status, 'st-done'];
    const where = o.fulfillment === 'pickup' ? 'Pickup' : 'Delivery' + (o.delivery_city ? ' to ' + o.delivery_city : '');
    return el('article', { class: 'card order' },
      el('div', { class: 'order-top' },
        el('div', {},
          el('strong', { text: date }),
          el('span', { class: 'muted small', text: 'Order #' + o.id + ', ' + where })
        ),
        el('span', { class: 'status-pill ' + cls, text: label })
      ),
      el('p', { class: 'order-items', text: summary || 'No items' }),
      el('div', { class: 'order-total' },
        el('span', { class: 'muted small', text: count + (count === 1 ? ' item' : ' items') }),
        el('strong', { text: money(o.total_cents) })
      ),
      el('button', {
        type: 'button', class: 'btn btn-primary', text: 'Reorder',
        onclick: () => {
          items.forEach((i) => { if (i.product_id) Basket.add(i.product_id, i.option_id, i.quantity); });
          window.location.href = 'basket.html';
        }
      })
    );
  }

  async function loadOrders(userId) {
    const { data, error } = await sb.from('orders')
      .select('id, created_at, status, fulfillment, delivery_city, total_cents, order_items(product_id, option_id, quantity, product_name, option_label)')
      .eq('customer_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);
    const list = $('order-list');
    if (error) {
      list.replaceChildren(el('p', { class: 'muted', text: 'Your orders didn\u2019t load. Please refresh in a moment.' }));
      return;
    }
    if (!data.length) {
      list.replaceChildren(el('div', { class: 'card empty' },
        el('p', { text: 'No orders yet. Once you place one, it shows up here with a one-tap Reorder button.' }),
        el('a', { class: 'btn btn-outline', href: 'index.html', text: 'Browse this week\u2019s market' })
      ));
      return;
    }
    list.replaceChildren(...data.map(orderCard));
  }

  function fillDetails(me) {
    const c = me.customer || {};
    $('first_name').value = c.first_name || '';
    $('last_name').value = c.last_name || '';
    $('phone').value = c.phone || '';
    $('email-show').value = me.user.email || '';
    $('delivery_street').value = c.delivery_street || '';
    $('delivery_city').value = c.delivery_city || '';
    document.querySelectorAll('input[name="usual"]').forEach((r) => { r.checked = r.value === c.usual_fulfillment; });
  }

  function wireDetails(me) {
    const form = $('details-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      $('details-error').hidden = true;
      $('details-saved').hidden = true;
      const usual = (document.querySelector('input[name="usual"]:checked') || {}).value || null;
      const patch = {
        first_name: $('first_name').value.trim() || null,
        last_name: $('last_name').value.trim() || null,
        phone: $('phone').value.trim() || null,
        usual_fulfillment: usual,
        delivery_street: $('delivery_street').value.trim() || null,
        delivery_city: $('delivery_city').value.trim() || null
      };
      const btn = $('save-btn');
      btn.disabled = true; btn.textContent = 'Saving…';
      const { error } = await sb.from('customers').update(patch).eq('id', me.user.id);
      btn.disabled = false; btn.textContent = 'Save my details';
      if (error) {
        console.error(error);
        $('details-error').textContent = 'That didn\u2019t save. Please try again.';
        $('details-error').hidden = false;
        return;
      }
      $('details-saved').hidden = false;
      if (patch.first_name) $('hello').textContent = 'Hi, ' + patch.first_name;
    });
  }

  window.EnchantedAuth.ready.then(async (me) => {
    if (!me) {
      window.location.replace('signin.html?next=account.html');
      return;
    }
    $('hello').textContent = 'Hi, ' + window.EnchantedAuth.displayName(me);
    fillDetails(me);
    wireDetails(me);
    $('logout-btn').addEventListener('click', window.EnchantedAuth.signOut);
    $('status').textContent = '';
    $('account').hidden = false;
    if (window.location.hash) {
      const target = document.querySelector(window.location.hash);
      if (target) target.scrollIntoView();
    }
    await loadOrders(me.user.id);
  });
})();
