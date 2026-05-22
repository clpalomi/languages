import { supabase } from './client.js';
import { baseURL, todayES, qs } from './utils.js';
import { computeStudyStrength } from '../src/utils/studyStrength.js';

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
const analyticsViewVisualizeBtn = qs('#analytics-view-visualize');
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
  if (analyticsViewMode === 'visualize') {
    renderVisualizeChart(selectedRows);
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

function renderVisualizeChart(selectedRows) {
  if (!selectedRows.length) {
    analyticsBarsEl.innerHTML = '<div class="empty analytics-empty">No study minutes match this filter.</div>';
    return;
  }
  const byLanguage = [...analyticsLanguageSelection];
  if (byLanguage.length !== 1) {
    analyticsBarsEl.innerHTML = '<div class="empty analytics-empty">Visualize needs exactly one selected language.</div>';
    return;
  }
  const language = byLanguage[0];
  const timeline = computeStudyStrength(selectedRows.filter((r) => (r.language || 'Unknown') === language));
  const totalBlocks = timeline.length ? timeline[timeline.length - 1].blocks : 0;
  const frameStates = buildFrames(timeline);
  const latest = frameStates[frameStates.length - 1] || new Set();
  const cells = [];
  for (let i = 0; i < 10000; i++) {
    cells.push(`<div class="visualize-cell ${latest.has(i) ? 'on' : ''}"></div>`);
  }
  const framesHtml = frameStates.map((set, idx) => {
    const date = timeline[idx].date;
    const score = timeline[idx].value.toFixed(1);
    let mini = '';
    for (let i = 0; i < 400; i++) mini += `<div class="visualize-mini-cell ${set.has(i) ? 'on' : ''}"></div>`;
    return `<div class="visualize-frame"><div><strong>${escapeHtml(date)}</strong></div><div>Score: ${escapeHtml(score)} · Blocks: ${timeline[idx].blocks}</div><div class="visualize-mini-grid">${mini}</div></div>`;
  }).join('');
  analyticsBarsEl.innerHTML = `
    <div class="visualize-wrap">
      <div class="visualize-score">Language: <strong>${escapeHtml(language)}</strong> · Score: <strong>${timeline.length ? timeline[timeline.length - 1].value.toFixed(1) : '0'}</strong> · Blocks: <strong>${totalBlocks}</strong></div>
      <div class="visualize-grid" aria-label="100 by 100 block grid">${cells.join('')}</div>
      <div>
        <button type="button" class="analytics-submit" id="visualize-play">Play</button>
      </div>
      <div class="visualize-timeline"><div class="visualize-frames" id="visualize-frames">${framesHtml || '<div class="muted">No timeline yet.</div>'}</div></div>
    </div>`;
  const playBtn = qs('#visualize-play');
  playBtn?.addEventListener('click', () => animateVisualize(frameStates, timeline));
}

function buildFrames(timeline) {
  const learned = new Set();
  const order = [];
  const center = 50 * 100 + 50;
  let prevBlocks = 0;
  for (const point of timeline) {
    const blocks = Math.max(0, Math.min(10000, point.blocks));
    if (blocks > prevBlocks) {
      for (let i = prevBlocks; i < blocks; i++) {
        const next = pickAdjacent(learned, order, center);
        learned.add(next);
        order.push(next);
      }
    } else if (blocks < prevBlocks) {
      for (let i = prevBlocks; i > blocks; i--) {
        const removed = order.pop();
        if (removed !== undefined) learned.delete(removed);
      }
    }
    prevBlocks = blocks;
  }
  const frames = [];
  learned.clear();
  prevBlocks = 0;
  const replayOrder = [];
  for (const point of timeline) {
    const blocks = Math.max(0, Math.min(10000, point.blocks));
    if (blocks > prevBlocks) {
      for (let i = prevBlocks; i < blocks; i++) {
        const next = pickAdjacent(learned, replayOrder, center);
        learned.add(next);
        replayOrder.push(next);
      }
    } else if (blocks < prevBlocks) {
      for (let i = prevBlocks; i > blocks; i--) {
        const removed = replayOrder.pop();
        if (removed !== undefined) learned.delete(removed);
      }
    }
    prevBlocks = blocks;
    frames.push(new Set(learned));
  }
  return frames;
}

function pickAdjacent(learned, order, center) {
  if (!order.length) return center;
  const frontier = [];
  for (const cell of learned) {
    for (const neighbor of neighbors(cell)) {
      if (!learned.has(neighbor)) frontier.push(neighbor);
    }
  }
  frontier.sort((a, b) => distance(a, center) - distance(b, center));
  return frontier[0] ?? center;
}
function neighbors(idx) {
  const r = Math.floor(idx / 100), c = idx % 100, out = [];
  if (r > 0) out.push((r - 1) * 100 + c);
  if (r < 99) out.push((r + 1) * 100 + c);
  if (c > 0) out.push(r * 100 + c - 1);
  if (c < 99) out.push(r * 100 + c + 1);
  return out;
}
function distance(a, b) {
  const ar = Math.floor(a / 100), ac = a % 100, br = Math.floor(b / 100), bc = b % 100;
  return Math.abs(ar - br) + Math.abs(ac - bc);
}
function animateVisualize(frameStates, timeline) {
  const grid = qs('.visualize-grid');
  if (!grid || !frameStates.length) return;
  const cells = [...grid.children];
  let i = 0;
  const tick = () => {
    const state = frameStates[i];
    cells.forEach((cell, idx) => cell.classList.toggle('on', state.has(idx)));
    const label = qs('.visualize-score');
    if (label) label.innerHTML = `Language: <strong>${escapeHtml(timeline[i].language || 'Unknown')}</strong> · Score: <strong>${timeline[i].value.toFixed(1)}</strong> · Blocks: <strong>${timeline[i].blocks}</strong>`;
    i += 1;
    if (i < frameStates.length) setTimeout(tick, 380);
  };
  tick();
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

analyticsViewBarsBtn?.addEventListener('click', () => { analyticsViewMode = 'bars'; analyticsViewBarsBtn.classList.add('active'); analyticsViewCumulativeBtn?.classList.remove('active'); analyticsViewVisualizeBtn?.classList.remove('active'); renderAnalytics(); });
analyticsViewCumulativeBtn?.addEventListener('click', () => { analyticsViewMode = 'cumulative'; analyticsViewCumulativeBtn.classList.add('active'); analyticsViewBarsBtn?.classList.remove('active'); analyticsViewVisualizeBtn?.classList.remove('active'); renderAnalytics(); });
analyticsViewVisualizeBtn?.addEventListener('click', () => { analyticsViewMode = 'visualize'; analyticsViewVisualizeBtn.classList.add('active'); analyticsViewBarsBtn?.classList.remove('active'); analyticsViewCumulativeBtn?.classList.remove('active'); renderAnalytics(); });
