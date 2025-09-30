// js/session-page.js
import { supabase } from "./client.js";         // your existing Supabase client
import { setupPomodoro } from "./components/pomodoro.js";

/* ---------- 1) Require auth ---------- */
let user = null;
let currentLessonKey = null;
let sessionId = crypto.randomUUID();  // track this browser session-id for writes

(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    const url = new URL(location.href);
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(location.pathname)}`;
    window.location.replace(url.toString());
    return;
  }
  user = session.user;
})();

/* ---------- 2) Sign out ---------- */
document.getElementById('signout')?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.replace('/login');
});

/* ---------- 3) Lesson loading ---------- */
const readerTitle = document.getElementById('reader-title');
const readerMeta  = document.getElementById('reader-meta');
const readerPage  = document.getElementById('reader-page');

async function loadLesson(label, basePath, key) {
  currentLessonKey = key; // e.g., 'pl/lesson1'
  readerTitle.textContent = label;
  readerMeta.textContent  = 'Loading…';

  const contentUrl = new URL('content.html', basePath).toString();
  const metaUrl    = new URL('meta.json', basePath).toString();

  try {
    const [metaRes, contentRes] = await Promise.allSettled([
      fetch(metaUrl, { cache:'no-store' }),
      fetch(contentUrl, { cache:'no-store' })
    ]);

    let meta = {};
    if (metaRes.status === 'fulfilled' && metaRes.value.ok) {
      meta = await metaRes.value.json();
    }

    let html;
    if (contentRes.status === 'fulfilled' && contentRes.value.ok) {
      html = await contentRes.value.text();
    } else {
      html = `
        <h3>${label}</h3>
        <div class="meta">${meta.level ? 'Level ' + meta.level : ''}</div>
        <p><em>(Content file not found at <code>${contentUrl}</code>. Showing placeholder.)</em></p>
        <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed non risus. Suspendisse lectus tortor,
        dignissim sit amet, adipiscing nec, ultricies sed, dolor.</p>
      `;
    }

    readerPage.innerHTML = html;
    readerMeta.textContent = [
      meta.level ? `Level ${meta.level}` : null,
      meta.estimated_minutes ? `~${meta.estimated_minutes} min` : null
    ].filter(Boolean).join(' • ');
  } catch (err) {
    readerPage.innerHTML = `
      <h3>${label}</h3>
      <div class="meta">Error loading content</div>
      <p>Could not load lesson content. Please try again.</p>
      <pre style="font-size:12px; white-space:pre-wrap">${String(err)}</pre>
    `;
    readerMeta.textContent = '';
  }
}

document.getElementById('lesson-1')?.addEventListener('click', (e) => {
  const base = e.currentTarget.getAttribute('data-base') || './lessons/pl/lesson1/';
  // use URL to make it robust under subpaths
  const baseUrl = new URL(base, document.baseURI);
  loadLesson('Lesson 1 — Polish', baseUrl, 'pl/lesson1');
});

/* ---------- 4) Pomodoro + Supabase persistence ---------- */
/* Schema you should have (run in Supabase SQL editor):
create table public.lesson_time (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,                 -- from crypto.randomUUID()
  lesson_key text not null,                 -- e.g., 'pl/lesson1'
  seconds_studied int not null default 0,
  started_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.lesson_time enable row level security;
create policy "own rows" on public.lesson_time for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
*/

let timeRowId = null;           // current row id in lesson_time
let lastSavedSeconds = 0;       // to avoid over-writing with smaller values

async function ensureTimeRow() {
  if (!user || !currentLessonKey) return;
  if (timeRowId) return;
  // create a fresh row for this session/lesson
  const { data, error } = await supabase.from('lesson_time').insert({
    user_id: user.id,
    session_id: sessionId,
    lesson_key: currentLessonKey,
    seconds_studied: 0
  }).select('id').single();
  if (!error) timeRowId = data.id;
}

async function saveAccumulated(seconds) {
  if (!user || !currentLessonKey) return;
  if (seconds <= lastSavedSeconds) return; // no-op
  await ensureTimeRow();
  if (!timeRowId) return;
  lastSavedSeconds = seconds;
  await supabase.from('lesson_time').update({
    seconds_studied: seconds,
    updated_at: new Date().toISOString()
  }).eq('id', timeRowId).eq('user_id', user.id);
}

const pomo = setupPomodoro(document.getElementById('pomodoro'), {
  maxMinutes: 60,
  onStart: async () => {
    // create time row when user starts and a lesson is selected
    await ensureTimeRow();
  },
  onTick: async (accumulatedSeconds) => {
    // save every 30s to reduce writes
    if (accumulatedSeconds % 30 === 0) {
      await saveAccumulated(accumulatedSeconds);
    }
  },
  onPause: async (accumulatedSeconds) => {
    await saveAccumulated(accumulatedSeconds);
  },
  onFinish: async (accumulatedSeconds) => {
    await saveAccumulated(accumulatedSeconds);
  },
  onReset: () => { /* no-op */ }
});

// Safety: before page unload, persist latest
window.addEventListener('beforeunload', async (e) => {
  const { accumulated } = pomo.getState();
  await saveAccumulated(accumulated);
});

