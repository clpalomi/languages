import { supabase } from './client.js';
import { baseURL, qs } from './utils.js';

const form   = qs('#auth-form');
const email  = qs('#email');
const button = qs('#send-link');
const msg    = qs('#auth-msg');

// Preserve "next" target if provided (e.g., user hit a protected app URL)
const urlParams = new URLSearchParams(location.search);
const next = urlParams.get('next') || (baseURL + 'app.html');

// Global error guards
window.addEventListener('error', e => msg.textContent = 'JS error: ' + e.message);
window.addEventListener('unhandledrejection', e => msg.textContent =
  'Promise error: ' + (e.reason?.message || e.reason));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const value = (email.value || '').trim();
  if (!value) { msg.textContent = 'Enter a valid email.'; return; }

  button.disabled = true;
  msg.textContent = 'Sending…';
  try {
    const emailRedirectTo = `${baseURL}auth-callback.html?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOtp({
      email: value,
      options: { emailRedirectTo }
    });
    if (error) throw error;
    msg.textContent = 'Check your email for the magic link.';
  } catch (err) {
    msg.textContent = 'Error: ' + err.message;
  } finally {
    button.disabled = false;
  }
});
