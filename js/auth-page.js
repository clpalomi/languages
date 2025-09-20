import { supabase } from './client.js';
import { baseURL, qs } from './utils.js';

const form   = qs('#auth-form');
const email  = qs('#email');
const button = qs('#send-link');
const msg    = qs('#auth-msg');

// NEW: OAuth UI refs
const googleBtn = qs('#google-login');
// const fbBtn     = qs('#facebook-login');
const oauthMsg  = qs('#oauth-msg');

// Preserve "next" target if provided (e.g., user hit a protected app URL)
const urlParams = new URLSearchParams(location.search);
const next = urlParams.get('next') || (baseURL + 'app.html');

// If already signed in, go straight to app
(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) location.replace(next);
})();


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

// === NEW: OAuth helpers ===
async function startOAuth(provider) {
  oauthMsg.textContent = `Redirecting to ${provider}…`;
  try {
    const redirectTo = `${baseURL}auth-callback.html?next=${encodeURIComponent(next)}`;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,                // 'google' | 'facebook'
      options: { redirectTo }  // MUST be allow-listed in Supabase
    });
    if (error) throw error;
    // On success, browser will navigate to provider then back to auth-callback.html
  } catch (err) {
    oauthMsg.textContent = 'OAuth error: ' + err.message;
  }
}

// Button listeners
googleBtn?.addEventListener('click', () => startOAuth('google'));
// fbBtn?.addEventListener('click', () => startOAuth('facebook'));
