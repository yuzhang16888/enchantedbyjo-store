// The basket lives on the shopper's own device until checkout.
// Each line: { productId, optionId (or null), qty }
(function () {
  const KEY = 'enchanted_basket_v1';

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      const lines = raw ? JSON.parse(raw) : [];
      return Array.isArray(lines) ? lines.filter((l) => l && l.productId && l.qty > 0) : [];
    } catch (e) {
      return [];
    }
  }

  function write(lines) {
    try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch (e) { /* private mode: basket lasts this visit only */ }
    window.dispatchEvent(new CustomEvent('basket:change'));
  }

  function same(a, productId, optionId) {
    return a.productId === productId && (a.optionId || null) === (optionId || null);
  }

  window.Basket = {
    lines: read,
    qty(productId, optionId) {
      const line = read().find((l) => same(l, productId, optionId));
      return line ? line.qty : 0;
    },
    add(productId, optionId, n = 1) {
      const lines = read();
      const line = lines.find((l) => same(l, productId, optionId));
      if (line) line.qty += n; else lines.push({ productId, optionId: optionId || null, qty: n });
      write(lines);
    },
    setQty(productId, optionId, qty) {
      let lines = read();
      if (qty <= 0) lines = lines.filter((l) => !same(l, productId, optionId));
      else {
        const line = lines.find((l) => same(l, productId, optionId));
        if (line) line.qty = qty; else lines.push({ productId, optionId: optionId || null, qty });
      }
      write(lines);
    },
    count() { return read().reduce((n, l) => n + l.qty, 0); },
    clear() { write([]); }
  };
})();
