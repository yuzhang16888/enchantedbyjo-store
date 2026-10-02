(function () {
  const cfg = window.ENCHANTED_CONFIG;
  const $ = (id) => document.getElementById(id);
  const form = $('contact-form');

  // Order number only matters for order questions.
  $('c-topic').addEventListener('change', () => { $('order-field').hidden = $('c-topic').value !== 'Order question'; });

  // Signed in? Fill in name and email.
  window.EnchantedAuth.ready.then((me) => {
    if (!me) return;
    const c = me.customer || {};
    if (c.first_name) $('c-name').value = [c.first_name, c.last_name].filter(Boolean).join(' ');
    $('c-email').value = me.user.email || '';
  });

  function fail(msg, focusId) {
    $('c-error').textContent = msg;
    $('c-error').hidden = false;
    if (focusId) $(focusId).focus();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('c-error').hidden = true;
    const body = {
      name: $('c-name').value.trim(),
      email: $('c-email').value.trim(),
      topic: $('c-topic').value,
      orderNumber: $('c-topic').value === 'Order question' ? $('c-order').value.trim() : '',
      message: $('c-message').value.trim(),
      website: $('c-website').value
    };
    if (!body.name) return fail('Please add your name.', 'c-name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return fail('Please add a valid email so we can reply.', 'c-email');
    if (body.message.length < 5) return fail('Please write a short message.', 'c-message');

    const btn = $('c-send');
    btn.disabled = true; btn.textContent = 'Sending\u2026';
    try {
      const res = await fetch(cfg.supabaseUrl + '/functions/v1/contact-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseKey },
        body: JSON.stringify(body)
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) throw new Error(out.error || 'Your message didn\u2019t send (' + res.status + '). Please email hello@enchantedbyjo.com instead.');
      $('c-done-email').textContent = body.email;
      form.hidden = true;
      $('c-done').hidden = false;
      $('c-done').focus();
    } catch (err) {
      fail(err.message);
      btn.disabled = false; btn.textContent = 'Send message';
    }
  });
})();
