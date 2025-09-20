import { supabase } from './client.js';
import { baseURL, todayES, qs } from './utils.js';

// Elements
const signoutBtn = qs('#signout');
const minutesEl  = qs('#minutes');
const languageEl = qs('#language');
const saveBtn    = qs('#save');
const statusEl   = qs('#status');
const rowsEl     = qs('#rows');
const todayEl    = qs('#today');

todayEl.textContent = todayES();

// Redirect to login if not signed in, preserving return URL
async function requireSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    const login = new URL('index.html', baseURL).href;
    const back  = encodeURIComponent(location.href);
    location.replace(`${login}?next=${back}`);
    return null;
  }
  return session.user;
}

async function loadToday() {
  rowsEl.innerHTML = '';
  const { data, error } = await supabase
    .from('entries')
    .select('date, language, minutes')
    .eq('date', todayES())
    .order('language', { ascending: true });

  if (error) {
    rowsEl.innerHTML = `<tr><td colspan="3">Error: ${error.message}</td></tr>`;
    return;
  }
  if (!data || data.length === 0) {
    rowsEl.innerHTML = `<tr><td colspan="3" class="muted">No entries yet.</td></tr>`;
    return;
  }
  rowsEl.innerHTML = data.map(r =>
    `<tr><td>${r.date}</td><td>${r.language}</td><td class="right">${r.minutes}</td></tr>`
  ).join('');
}

saveBtn.addEventListener('click', async () => {
  statusEl.textContent = 'Saving…';
  const minutes = parseInt(minutesEl.value, 10);
  const language = (languageEl.value || '').trim();
  if (!Number.isFinite(minutes) || minutes < 0 || !language) {
    statusEl.textContent = 'Enter minutes ≥ 0 and a language.'; return;
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { statusEl.textContent = 'Not signed in.'; return; }

  const payload = [{ date: todayES(), language, minutes, user_id: user.id }];

  const { error: upsertError } = await supabase
    .from('entries')
    .upsert(payload, { onConflict: 'date,language,user_id' })
    .select();

  statusEl.textContent = upsertError ? ('Error: ' + upsertError.message) : 'Saved';
  if (!upsertError) {
    minutesEl.value = '';
    languageEl.value = '';
    await loadToday();
  }
});

signoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  const login = new URL('index.html', baseURL).href;
  location.replace(login);
});

// Initialize: ensure session, then load
(async () => {
  const user = await requireSession();
  if (user) await loadToday();
})();
