(function () {
  const sb = window.sb;
  const $ = (id) => document.getElementById(id);
  const stepEmail = $('step-email');
  const stepCode = $('step-code');
  const emailInput = $('email');
  const codeInput = $('code');
  const sendBtn = $('send-btn');
  const verifyBtn = $('verify-btn');
  const resendBtn = $('resend-btn');
  // Must match Supabase: Authentication > Email > OTP length. This project sends 8 digits.
  const CODE_LENGTH = 8;
  let email = '';
  let cooldownTimer = null;

  // Where to go after signing in (e.g. signin.html?next=account.html)
  const nextParam = new URLSearchParams(window.location.search).get('next');
  const next = nextParam && /^[a-z0-9_-]+\.html(#[a-z0-9_-]+)?$/i.test(nextParam) ? nextParam : 'index.html';

  function showError(id, msg) {
    const box = $(id);
    box.textContent = msg || '';
    box.hidden = !msg;
  }
  function busy(btn, on, label) {
    btn.disabled = on;
    if (label) btn.textContent = label;
  }
  function friendly(err) {
    const m = (err && err.message || '').toLowerCase();
    if (m.includes('rate') || m.includes('seconds') || m.includes('security purposes')) return 'Please wait a minute before asking for another code.';
    if (m.includes('expired') || m.includes('invalid') || m.includes('token')) return 'That code didn\u2019t work. Use the newest email, or send a new one.';
    if (m.includes('email')) return 'Please check the email address and try again.';
    return 'Something went wrong. Please try again in a moment.';
  }

  function startCooldown(seconds) {
    clearInterval(cooldownTimer);
    let left = seconds;
    resendBtn.disabled = true;
    resendBtn.textContent = 'Send a new email in ' + left + 's';
    cooldownTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(cooldownTimer);
        resendBtn.disabled = false;
        resendBtn.textContent = 'Send a new email';
      } else {
        resendBtn.textContent = 'Send a new email in ' + left + 's';
      }
    }, 1000);
  }

  async function sendCode() {
    // The email's Sign in button brings people back to the page they were heading to.
    const back = window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + next;
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: back } });
    if (error) throw error;
  }

  stepEmail.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('email-error', '');
    email = emailInput.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('email-error', 'Please enter a full email address, like name@example.com.');
      emailInput.focus();
      return;
    }
    busy(sendBtn, true, 'Sending…');
    try {
      await sendCode();
      $('sent-to').textContent = email;
      stepEmail.hidden = true;
      stepCode.hidden = false;
      codeInput.value = '';
      stepCode.querySelector('h2').setAttribute('tabindex', '-1');
      stepCode.querySelector('h2').focus();
      startCooldown(60);
    } catch (err) {
      console.error(err);
      showError('email-error', friendly(err));
    } finally {
      busy(sendBtn, false, 'Email me a sign-in link');
    }
  });

  // Keep only the digits (so pasted codes with spaces work) and sign in once the full code is there.
  codeInput.addEventListener('input', () => {
    const digits = codeInput.value.replace(/\D/g, '').slice(0, 10);
    if (digits !== codeInput.value) codeInput.value = digits;
    if (digits.length === CODE_LENGTH) stepCode.requestSubmit();
  });

  stepCode.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('code-error', '');
    const token = codeInput.value.replace(/\D/g, '');
    if (!/^\d{6,10}$/.test(token)) {
      showError('code-error', 'Please enter the full code from the email (' + CODE_LENGTH + ' numbers).');
      codeInput.focus();
      return;
    }
    busy(verifyBtn, true, 'Checking…');
    try {
      const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw error;
      window.location.href = next;
    } catch (err) {
      console.error(err);
      showError('code-error', friendly(err));
      busy(verifyBtn, false, 'Sign in with code');
      codeInput.select();
    }
  });

  resendBtn.addEventListener('click', async () => {
    showError('code-error', '');
    try {
      await sendCode();
      startCooldown(60);
    } catch (err) {
      showError('code-error', friendly(err));
    }
  });

  $('change-email').addEventListener('click', () => {
    clearInterval(cooldownTimer);
    stepCode.hidden = true;
    stepEmail.hidden = false;
    emailInput.focus();
  });

  // Tapped the email link in another tab on this device? This tab follows along.
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session && !stepCode.hidden) window.location.href = next;
  });

  // Already signed in? Say so instead of asking again.
  sb.auth.getSession().then(({ data: { session } }) => {
    if (!session) return;
    $('already-text').textContent = 'Signed in as ' + session.user.email + '.';
    $('already').hidden = false;
    stepEmail.hidden = true;
  });
})();
