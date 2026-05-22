import { supabase } from './client.js';
import { baseURL, todayES, qs } from './utils.js';

const LANGUAGE_COLORS = [
  '#7c3aed', '#22c55e', '#f97316', '#06b6d4', '#ec4899', '#eab308', '#14b8a6', '#ef4444', '#6366f1', '#84cc16'
];

// Elements
const signoutBtn = qs('#signout');
const minutesEl = qs('#minutes');
const languageEl = qs('#language');
const saveBtn = qs('#save');
const statusEl = qs('#status');
const rowsEl = qs('#rows');
const todayEl = qs('#today');
const analyticsBtn = qs('#analytics-open');
const aboutBtn = qs('#about-open');
const analyticsOverlay = qs('#analytics-overlay');
const aboutOverlay = qs('#about-overlay');
const analyticsCloseBtn = qs('#analytics-close');
const aboutCloseBtn = qs('#about-close');
const analyticsForm = qs('#analytics-form');
const analyticsStartEl = qs('#analytics-start');
const analyticsEndEl = qs('#analytics-end');
const analyticsLanguageChoicesEl = qs('#analytics-language-choices');
const analyticsStatusEl = qs('#analytics-status');
const analyticsSummaryEl = qs('#analytics-summary');
const analyticsBarsEl = qs('#analytics-bars');
const analyticsTotalEl = qs('#analytics-total');
const analyticsViewBarsBtn = qs('#analytics-view-bars');
const analyticsViewCumulativeBtn = qs('#analytics-view-cumulative');
const analyticsRangeLabelEl = qs('#analytics-range-label');
const analyticsLanguagesLabelEl = qs('#analytics-languages-label');
const psSessionsTodayEl = qs('#ps-sessions-today');
const psTotalMinutesEl = qs('#ps-total-minutes');

todayEl.textContent = todayES();
analyticsStartEl.value = todayES();
analyticsEndEl.value = todayES();

let currentUser = null;
let analyticsRows = [];
let analyticsLanguageSelection = new Set();
let analyticsViewMode = 'bars';

// Redirect to login if not signed in, preserving return URL
async function requireSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    const login = new URL('index.html', baseURL).href;
    const back = encodeURIComponent(location.href);
    location.replace(`${login}?next=${back}`);
    return null;
  }
  return session.user;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setSavingUI(isSaving) {
  if (!saveBtn) return;
  saveBtn.disabled = !!isSaving;
  if (isSaving) {
    if (!saveBtn.querySelector('.spinner')) {
      const spinner = document.createElement('div');
      spinner.className = 'spinner';
      spinner.setAttribute('aria-hidden', 'true');
      saveBtn.insertBefore(spinner, saveBtn.firstChild);
    }
  } else {
    saveBtn.querySelector('.spinner')?.remove();
  }
}

function openOverlay(overlay) {
  overlay?.removeAttribute('hidden');
  document.body.classList.add('modal-open');
}

function closeOverlay(overlay) {
  overlay?.setAttribute('hidden', '');
  if (![analyticsOverlay, aboutOverlay].some((item) => item && !item.hasAttribute('hidden'))) {
    document.body.classList.remove('modal-open');
  }
}

function getLanguageColor(language, index) {
  let hash = 0;
  for (const char of language) hash = (hash + char.charCodeAt(0)) % LANGUAGE_COLORS.length;
  return LANGUAGE_COLORS[(hash + index) % LANGUAGE_COLORS.length];
}

async function loadToday() {
  rowsEl.innerHTML = '';
  let query = supabase
    .from('entries')
    .select('date, language, minutes')
    .eq('date', todayES())
    .order('language', { ascending: true });

  if (currentUser?.id) query = query.eq('user_id', currentUser.id);

  const { data, error } = await query;

  if (error) {
    rowsEl.innerHTML = `<tr><td colspan="3">Error: ${escapeHtml(error.message)}</td></tr>`;
    return [];
  }
  if (!data || data.length === 0) {
    rowsEl.innerHTML = `<tr><td colspan="3" class="empty">No entries yet.</td></tr>`;
    return [];
  }
 rowsEl.innerHTML = data.map((r) =>
    `<tr><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.language)}</td><td class="right">${escapeHtml(r.minutes)}</td></tr>`
  ).join('');
  return data;
}

function updateQuickStats(rows) {
  if (!rows) return;
  const sessions = rows.length;
  const total = rows.reduce((sum, row) => sum + Number(row.minutes || 0), 0);
  if (psSessionsTodayEl) psSessionsTodayEl.textContent = String(sessions);
  if (psTotalMinutesEl) psTotalMinutesEl.textContent = String(total);
}

async function saveEntry() {
  statusEl.textContent = 'Saving…';
  setSavingUI(true);
    
  const minutes = parseInt(minutesEl.value, 10);
  const language = (languageEl.value || '').trim();
  if (!Number.isFinite(minutes) || minutes < 0 || !language) {
    statusEl.textContent = 'Enter minutes ≥ 0 and a language.';
    setSavingUI(false);
    return;
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    statusEl.textContent = 'Not signed in.';
    setSavingUI(false);
    return;
  }

  const payload = [{ date: todayES(), language, minutes, user_id: user.id }];
  const { error } = await supabase
    .from('entries')
    .insert(payload)
    .select();

  if (error) {
    const duplicate = error.code === '23505' || /duplicate|unique|conflict/i.test(error.message || '');
    statusEl.textContent = duplicate
      ? 'Error: Supabase still has a unique rule for date + language + user. Remove that constraint or add an id/created_at primary key so multiple same-day sessions can be inserted.'
      : `Error: ${error.message}`;
    setSavingUI(false);
    return;
  }

  statusEl.textContent = 'Saved as a new session';
  minutesEl.value = '';
  languageEl.value = '';
  const rows = await loadToday();
  updateQuickStats(rows);
  setSavingUI(false);
}

function summarizeByLanguage(rows) {
  return rows.reduce((acc, row) => {
    const language = row.language || 'Unknown';
    acc[language] = (acc[language] || 0) + Number(row.minutes || 0);
    return acc;
  }, {});
}

function renderLanguageChoices(rows) {
  const languages = [...new Set(rows.map((row) => row.language || 'Unknown'))].sort((a, b) => a.localeCompare(b));
  if (!languages.length) {
    analyticsLanguageChoicesEl.innerHTML = '<p class="muted">No languages found in this range yet.</p>';
    analyticsLanguageSelection = new Set();
    return;
  }

  if (!analyticsLanguageSelection.size) {
    analyticsLanguageSelection = new Set(languages);
  } else {
    analyticsLanguageSelection = new Set(languages.filter((language) => analyticsLanguageSelection.has(language)));
    if (!analyticsLanguageSelection.size) analyticsLanguageSelection = new Set(languages);
  }

  analyticsLanguageChoicesEl.innerHTML = languages.map((language, index) => {
    const checked = analyticsLanguageSelection.has(language) ? 'checked' : '';
    const color = getLanguageColor(language, index);
    return `
      <label class="language-chip" style="--chip-color:${color}">
        <input type="checkbox" value="${escapeHtml(language)}" ${checked}>
        <span>${escapeHtml(language)}</span>
      </label>`;
  }).join('');
}


function renderCumulativeChart(selectedRows) {
  if (!selectedRows.length) {
    analyticsBarsEl.innerHTML = '<div class="empty analytics-empty">No study minutes match this filter.</div>';
    return;
  }
  const dayMap = new Map();
  for (const row of selectedRows) {
    const date = row.date;
    const language = row.language || 'Unknown';
    const minutes = Number(row.minutes || 0);
    if (!dayMap.has(date)) dayMap.set(date, {});
    dayMap.get(date)[language] = (dayMap.get(date)[language] || 0) + minutes;
  }
  const dates = [...dayMap.keys()].sort();
  const languages = [...analyticsLanguageSelection].sort((a,b)=>a.localeCompare(b));
  const cumulative = Object.fromEntries(languages.map((l) => [l, 0]));
  const series = Object.fromEntries(languages.map((l) => [l, []]));
  for (const date of dates) {
    const obj = dayMap.get(date);
    for (const l of languages) {
      cumulative[l] += Number(obj[l] || 0);
      series[l].push(cumulative[l]);
    }
  }
  const maxY = Math.max(1, ...languages.flatMap((l) => series[l]));
  const width = 740, height = 260, pad = 36;
  const x = (i) => dates.length === 1 ? width / 2 : pad + (i * (width - pad * 2) / (dates.length - 1));
  const y = (v) => height - pad - ((v / maxY) * (height - pad * 2));
  const lines = languages.map((l, idx) => {
    const points = series[l].map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
    return `<polyline fill="none" stroke="${getLanguageColor(l, idx)}" stroke-width="3" points="${points}" />`;
  }).join('');
  analyticsBarsEl.innerHTML = `<div class="analytics-line-wrap">
    <svg class="analytics-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cumulative minutes by date">
      <line x1="${pad}" y1="${height-pad}" x2="${width-pad}" y2="${height-pad}" stroke="currentColor" opacity=".25"/>
      <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height-pad}" stroke="currentColor" opacity=".25"/>
      ${lines}
    </svg>
    <div class="analytics-line-legend">${languages.map((l, idx)=>`<span class="analytics-line-item"><span class="legend-dot" style="background:${getLanguageColor(l, idx)}"></span>${escapeHtml(l)}</span>`).join('')}</div>
  </div>`;
}

function renderAnalytics() {
  const selectedRows = analyticsRows.filter((row) => analyticsLanguageSelection.has(row.language || 'Unknown'));
  const totals = summarizeByLanguage(selectedRows);
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const totalMinutes = entries.reduce((sum, [, minutes]) => sum + minutes, 0);
  const maxMinutes = Math.max(...entries.map(([, minutes]) => minutes), 1);

  analyticsTotalEl.textContent = String(totalMinutes);
  analyticsRangeLabelEl.textContent = `${analyticsStartEl.value} → ${analyticsEndEl.value}`;
  analyticsLanguagesLabelEl.textContent = entries.length ? entries.map(([language]) => language).join(', ') : 'No languages selected';

  if (analyticsViewMode === 'cumulative') {
    renderCumulativeChart(selectedRows);
    return;
  }

  if (!entries.length) {
    analyticsBarsEl.innerHTML = '<div class="empty analytics-empty">No study minutes match this filter.</div>';
    return;
  }

  analyticsBarsEl.innerHTML = entries.map(([language, minutes], index) => {
    const percent = Math.max((minutes / maxMinutes) * 100, 4);
    const color = getLanguageColor(language, index);
    return `
      <div class="analytics-bar-row">
        <div class="analytics-bar-label">
          <span class="legend-dot" style="background:${color}"></span>
          <strong>${escapeHtml(language)}</strong>
          <span>${minutes} min</span>
        </div>
        <div class="analytics-track" aria-hidden="true">
          <div class="analytics-fill" style="width:${percent}%; background:${color}"></div>
        </div>
      </div>`;
  }).join('');
}

async function loadAnalytics() {
  analyticsStatusEl.textContent = 'Loading analytics…';
  analyticsSummaryEl.hidden = true;
  analyticsBarsEl.innerHTML = '';

  const start = analyticsStartEl.value;
  const end = analyticsEndEl.value;
  if (!start || !end || start > end) {
    analyticsStatusEl.textContent = 'Choose a valid date range.';
    return;
  }

  let query = supabase
    .from('entries')
    .select('date, language, minutes')
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: true });

  if (currentUser?.id) query = query.eq('user_id', currentUser.id);

  const { data, error } = await query;
  if (error) {
    analyticsStatusEl.textContent = `Error: ${error.message}`;
    return;
  }

  analyticsRows = data || [];
  renderLanguageChoices(analyticsRows);
  renderAnalytics();
  analyticsSummaryEl.hidden = false;
  analyticsStatusEl.textContent = analyticsRows.length
    ? `${analyticsRows.length} sessions found.`
    : 'No sessions found for this range.';
}

saveBtn.addEventListener('click', saveEntry);

signoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  const login = new URL('index.html', baseURL).href;
  location.replace(login);
});

analyticsBtn?.addEventListener('click', async () => {
  openOverlay(analyticsOverlay);
  await loadAnalytics();
});
aboutBtn?.addEventListener('click', () => openOverlay(aboutOverlay));
analyticsCloseBtn?.addEventListener('click', () => closeOverlay(analyticsOverlay));
aboutCloseBtn?.addEventListener('click', () => closeOverlay(aboutOverlay));

analyticsOverlay?.addEventListener('click', (event) => {
  if (event.target === analyticsOverlay) closeOverlay(analyticsOverlay);
});
aboutOverlay?.addEventListener('click', (event) => {
  if (event.target === aboutOverlay) closeOverlay(aboutOverlay);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeOverlay(analyticsOverlay);
    closeOverlay(aboutOverlay);
  }
});
analyticsForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  await loadAnalytics();
});
analyticsLanguageChoicesEl?.addEventListener('change', () => {
  const checked = analyticsLanguageChoicesEl.querySelectorAll('input[type="checkbox"]:checked');
  analyticsLanguageSelection = new Set([...checked].map((input) => input.value));
  renderAnalytics();
});

// Right card: navigate to session.html
const startBtn = document.getElementById('ps-start');
startBtn?.addEventListener('click', () => {
  startBtn.disabled = true;
  startBtn.style.filter = 'brightness(1.05)';
  setTimeout(() => { window.location.href = 'session.html'; }, 250);
});

// Initialize: ensure session, then load
(async () => {
  currentUser = await requireSession();
  if (currentUser) {
    const rows = await loadToday();
    updateQuickStats(rows);
  }
})();

analyticsViewBarsBtn?.addEventListener('click', () => { analyticsViewMode = 'bars'; analyticsViewBarsBtn.classList.add('active'); analyticsViewCumulativeBtn?.classList.remove('active'); renderAnalytics(); });
analyticsViewCumulativeBtn?.addEventListener('click', () => { analyticsViewMode = 'cumulative'; analyticsViewCumulativeBtn.classList.add('active'); analyticsViewBarsBtn?.classList.remove('active'); renderAnalytics(); });
