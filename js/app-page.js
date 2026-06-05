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
const visualizeBtn = qs('#visualize-open');
const aboutBtn = qs('#about-open');
const analyticsOverlay = qs('#analytics-overlay');
const aboutOverlay = qs('#about-overlay');
const visualizeOverlay = qs('#visualize-overlay');
const analyticsCloseBtn = qs('#analytics-close');
const visualizeCloseBtn = qs('#visualize-close');
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
const visualizeForm = qs('#visualize-form');
const visualizeLanguageEl = qs('#visualize-language');
const visualizeUseAllEl = qs('#visualize-use-all');
const visualizeStartEl = qs('#visualize-start');
const visualizeEndEl = qs('#visualize-end');
const visualizeStatusEl = qs('#visualize-status');
const visualizeChartEl = qs('#visualize-chart');
const visualizeEvolutionBtn = qs('#visualize-evolution');
const psSessionsTodayEl = qs('#ps-sessions-today');
const psTotalMinutesEl = qs('#ps-total-minutes');
const psAccessStatusEl = qs('#ps-access-status');

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


function setPrivateSessionStatus(message) {
  if (psAccessStatusEl) psAccessStatusEl.textContent = message;
}

async function currentUserCanStartPrivateSession(user = currentUser) {
  const email = (user?.email || '').trim();
  if (!email) return false;

  const { data, error } = await supabase
    .from('private_session_access')
    .select('id')
    .eq('email', email)
    .eq('active', true)
    .limit(1);

  if (error) {
    throw new Error(`Private-session access check failed: ${error.message}`);
  }

  return (data || []).length > 0;
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
  if (![analyticsOverlay, aboutOverlay, visualizeOverlay].some((item) => item && !item.hasAttribute('hidden'))) {
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
    .select('date, language, minutes, inserted_at')
    .eq('date', todayES())
    .order('inserted_at', { ascending: false });

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

  const payload = [{
    date: todayES(),
    language,
    minutes,
    user_id: user.id,
    inserted_at: new Date().toISOString(),
  }];
  const { error } = await supabase
    .from('entries')
    .insert(payload)
    .select();

  if (error) {
    statusEl.textContent = `Error: ${error.message}`;
    setSavingUI(false);
    return;
  }

  try {
    await ensureBlockHistoryForLanguage(language);
    statusEl.textContent = 'Saved as a new session';
  } catch (historyError) {
    statusEl.textContent = `Saved session, but block history was not updated: ${historyError.message}`;
  }
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

const GRID_SIZE = 20;
const GRID_TOTAL_CELLS = GRID_SIZE * GRID_SIZE;
const BLOCK_HISTORY_SELECT = 'id, user_id, language, date, block_added, block_removed, position_added_block, position_removed_block, punctuation, visible_positions, hidden_positions, session_sequence, operation_index, created_at';

function populateVisualizeLanguages(rows) {
  const languages = [...new Set(rows.map((row) => row.language || 'Unknown'))].sort((a, b) => a.localeCompare(b));
  if (!languages.length) {
    visualizeLanguageEl.innerHTML = '<option value="">No language available</option>';
    return;
  }
  visualizeLanguageEl.innerHTML = languages.map((language) => `<option value="${escapeHtml(language)}">${escapeHtml(language)}</option>`).join('');
}

function normalizePositionList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (_) {
      // Supabase text[] values arrive as arrays through postgrest-js; keep this
      // fallback for older manually seeded text rows.
    }
    return value.split(/[|;]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function cellKeyToIndex(cellKey) {
  const [r, c] = String(cellKey).split(',').map(Number);
  if (!Number.isInteger(r) || !Number.isInteger(c)) return -1;
  return (r * GRID_SIZE) + c;
}

function indexToCellKey(index) {
  return `${Math.floor(index / GRID_SIZE)},${index % GRID_SIZE}`;
}

function getRandomInt(max) {
  if (max <= 0) return 0;
  if (window.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    window.crypto.getRandomValues(values);
    return values[0] % max;
  }
  return Math.floor(Math.random() * max);
}

function findAvailableNeighbor(stack) {
  const active = new Set(stack);
  if (!active.size) return `${Math.floor(GRID_SIZE / 2)},${Math.floor(GRID_SIZE / 2)}`;

  const candidates = [];
  const seen = new Set();
  const neighbors = (r, c) => [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
    .filter(([nr, nc]) => nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE);

  active.forEach((key) => {
    const [r, c] = key.split(',').map(Number);
    neighbors(r, c).forEach(([nr, nc]) => {
      const candidate = `${nr},${nc}`;
      if (!active.has(candidate) && !seen.has(candidate)) {
        seen.add(candidate);
        candidates.push(candidate);
      }
    });
  });

  if (candidates.length) return candidates[getRandomInt(candidates.length)];
  
  const remaining = Array.from({ length: GRID_TOTAL_CELLS }, (_, index) => indexToCellKey(index)).filter((key) => !active.has(key));
  return remaining[getRandomInt(remaining.length)] || null;
}

function buildHistoryRowsFromSessions(sessions, existingHistory = []) {
  const orderedSessions = [...sessions].sort((a, b) => {
    const dateCompare = String(a.date || '').localeCompare(String(b.date || ''));
    if (dateCompare) return dateCompare;
    return String(a.inserted_at || '').localeCompare(String(b.inserted_at || ''));
  });
  const timeline = computeStudyStrength(orderedSessions);
  const stack = [];

  existingHistory.forEach((row) => {
    normalizePositionList(row.position_added_block).forEach((position) => {
      if (!stack.includes(position)) stack.push(position);
    });
    normalizePositionList(row.position_removed_block).forEach((position) => {
      const index = stack.lastIndexOf(position);
      if (index >= 0) stack.splice(index, 1);
    });
  });
  
  const startIndex = existingHistory.length;
  const missingRows = [];

  for (let index = startIndex; index < timeline.length; index += 1) {
    const point = timeline[index];
    const previousBlocks = index ? timeline[index - 1].blocks : 0;
    const delta = point.blocks - previousBlocks;
    const addedPositions = [];
    const removedPositions = [];

    if (delta > 0) {
      for (let i = 0; i < delta; i += 1) {
        const position = findAvailableNeighbor(stack);
        if (!position) break;
        stack.push(position);
        addedPositions.push(position);
      }
    } else if (delta < 0) {
      for (let i = 0; i < Math.abs(delta); i += 1) {
        const position = stack.pop();
        if (position) removedPositions.push(position);
      }
    }

    const visiblePositions = [...stack];
    const active = new Set(visiblePositions);
    const hiddenPositions = Array.from({ length: GRID_TOTAL_CELLS }, (_, cellIndex) => indexToCellKey(cellIndex))
      .filter((position) => !active.has(position));

    missingRows.push({
      user_id: currentUser.id,
      language: point.language || orderedSessions[index]?.language || 'Unknown',
      date: point.date,
      block_added: addedPositions.length > 0,
      block_removed: removedPositions.length > 0,
      position_added_block: addedPositions,
      position_removed_block: removedPositions,
      punctuation: Number(point.value || 0),
      visible_positions: visiblePositions,
      hidden_positions: hiddenPositions,
      session_sequence: index + 1,
      operation_index: 0
    });
  }

  return missingRows;
}

function sortHistoryRows(rows) {
  return [...rows].sort((a, b) => {
    const seq = Number(a.session_sequence || 0) - Number(b.session_sequence || 0);
    if (seq) return seq;
    const dateCompare = String(a.date || '').localeCompare(String(b.date || ''));
    if (dateCompare) return dateCompare;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
}

async function loadBlockHistory(language) {
  if (!currentUser?.id || !language) return { data: [], error: null };
  const { data, error } = await supabase
    .from('language_block_history')
    .select(BLOCK_HISTORY_SELECT)
    .eq('user_id', currentUser.id)
    .eq('language', language)
    .order('session_sequence', { ascending: true })
    .order('created_at', { ascending: true });

  return { data: sortHistoryRows(data || []), error };
}

async function loadEntriesForLanguage(language) {
  let query = supabase
    .from('entries')
    .select('date, language, minutes, inserted_at')
    .eq('language', language)
    .order('date', { ascending: true })
    .order('inserted_at', { ascending: true });

  if (currentUser?.id) query = query.eq('user_id', currentUser.id);

  const { data, error } = await query;
  return { data: data || [], error };
}

async function ensureBlockHistoryForLanguage(language) {
  const [historyResult, entriesResult] = await Promise.all([
    loadBlockHistory(language),
    loadEntriesForLanguage(language)
  ]);

  if (historyResult.error) return historyResult;
  if (entriesResult.error) return entriesResult;

  const historyRows = historyResult.data || [];
  const entryRows = entriesResult.data || [];
  if (!entryRows.length || historyRows.length >= entryRows.length) {
    return { data: historyRows, error: null };
  }

  const missingRows = buildHistoryRowsFromSessions(entryRows, historyRows);
  if (!missingRows.length) return { data: historyRows, error: null };

  const { data, error } = await supabase
    .from('language_block_history')
    .upsert(missingRows, { onConflict: 'user_id,language,session_sequence' })
    .select(BLOCK_HISTORY_SELECT);

  if (error) return { data: historyRows, error };
  return { data: sortHistoryRows([...historyRows, ...(data || [])]), error: null };
}

function replayBlockHistory(historyRows) {
  const stack = [];
  const states = [];

  sortHistoryRows(historyRows).forEach((row) => {
    const added = normalizePositionList(row.position_added_block);
    const removed = normalizePositionList(row.position_removed_block);

    added.forEach((position) => {
      if (!stack.includes(position)) stack.push(position);
    });

    removed.forEach((position) => {
      const top = stack[stack.length - 1];
      if (top === position) {
        stack.pop();
      } else {
        const index = stack.lastIndexOf(position);
        if (index >= 0) stack.splice(index, 1);
      }
    });

    const storedVisiblePositions = normalizePositionList(row.visible_positions);
    states.push({
      date: row.date,
      punctuation: Number(row.punctuation || 0),
      cells: storedVisiblePositions.length ? storedVisiblePositions : [...stack],
      added,
      removed
    });
  });

  return states.length ? states : [{ date: '', punctuation: 0, cells: [], added: [], removed: [] }];
}

function renderBlockHistoryTable(historyRows) {
  if (!historyRows.length) return '<div class="block-history-empty">No block history is stored for this language yet.</div>';
  const recentRows = sortHistoryRows(historyRows).slice(-8).reverse();
  return `<table class="block-history-table" aria-label="Recent block history">
    <thead><tr><th>Session</th><th>Date</th><th>Added</th><th>Removed</th><th class="right">Punctuation</th></tr></thead>
    <tbody>${recentRows.map((row) => {
      const added = normalizePositionList(row.position_added_block);
      const removed = normalizePositionList(row.position_removed_block);
      return `<tr>
        <td>${escapeHtml(row.session_sequence || '')}</td>
        <td>${escapeHtml(row.date || '')}</td>
        <td>${added.length ? escapeHtml(added.join(' · ')) : '—'}</td>
        <td>${removed.length ? escapeHtml(removed.join(' · ')) : '—'}</td>
        <td class="right">${Number(row.punctuation || 0).toFixed(1)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

async function renderVisualizeChart({ playEvolution = false } = {}) {
  const language = visualizeLanguageEl.value;
  if (!language) {
    visualizeChartEl.innerHTML = '<div class="empty analytics-empty">Select a language to visualize.</div>';
    return;
  }

  visualizeStatusEl.textContent = 'Loading stored block history…';
  const { data: historyRows, error } = await ensureBlockHistoryForLanguage(language);
  if (error) {
    visualizeStatusEl.textContent = `Error: ${error.message}`;
    visualizeChartEl.innerHTML = '<div class="empty analytics-empty">Could not load block history. Make sure the Supabase table has been created.</div>';
    return;
  }

  let filteredRows = historyRows || [];
  if (!visualizeUseAllEl.checked) {
    const start = visualizeStartEl.value;
    const end = visualizeEndEl.value;
    if (!start || !end || start > end) {
      visualizeStatusEl.textContent = 'Choose a valid date range.';
      return;
    }
    filteredRows = filteredRows.filter((row) => row.date >= start && row.date <= end);
  }

  const states = replayBlockHistory(filteredRows);
  const finalState = states[states.length - 1];
  visualizeStatusEl.textContent = filteredRows.length
    ? `${filteredRows.length} stored sessions loaded. Showing the last grid organization.`
    : 'No block-history rows match this configuration.';

  visualizeChartEl.innerHTML = `<div class="visualize-wrap">
    <div class="visualize-note">Language: <strong>${escapeHtml(language)}</strong>. The grid shows the latest stored visible blocks; pale cells are currently not visible. Use “Visualize evolution” to replay the stored LIFO history.</div>
    <div class="visualize-legend"><span>Visible blocks: ${finalState.cells.length}</span><span>Not visible: ${GRID_TOTAL_CELLS - finalState.cells.length}</span><span>Punctuation: ${finalState.punctuation.toFixed(1)}</span></div>
    <div class="grid-anim-controls"><button id="visualize-grid-play" type="button">Visualize evolution</button><span id="visualize-grid-caption">Final state · ${escapeHtml(finalState.date || 'No date')}</span></div>
    <div class="visualize-grid-shell"><div class="visualize-grid" id="visualize-grid" aria-label="20 by 20 block grid"></div></div>
    ${renderBlockHistoryTable(filteredRows)}
  </div>`;

  setupGridAnimation(states, { autoplay: playEvolution });
}

function setupGridAnimation(states, { autoplay = false } = {}) {
  const gridEl = qs('#visualize-grid');
  const playBtn = qs('#visualize-grid-play');
  const captionEl = qs('#visualize-grid-caption');
  if (!gridEl || !playBtn || !captionEl) return;

  const imageUrl = 'images/flag_georgia.png';
  const applyImageAndRender = (imageMeta) => {
    gridEl.innerHTML = Array.from({ length: GRID_TOTAL_CELLS }, (_, i) => `<div class="grid-cell is-hidden" data-i="${i}"></div>`).join('');
    if (imageMeta.ok) gridEl.style.setProperty('--grid-image', `url("${imageUrl}")`);
    const cells = [...gridEl.querySelectorAll('.grid-cell')];
    if (imageMeta.ok) {
      cells.forEach((cell, index) => {
        const r = Math.floor(index / GRID_SIZE);
        const c = index % GRID_SIZE;
        const x = (c / (GRID_SIZE - 1)) * 100;
        const y = (r / (GRID_SIZE - 1)) * 100;
        cell.style.backgroundSize = `${GRID_SIZE * 100}% ${GRID_SIZE * 100}%`;
        cell.style.backgroundPosition = `${x}% ${y}%`;
      });
    }

    const renderState = (idx) => {
      cells.forEach((cell) => {
        cell.classList.remove('is-active');
        cell.classList.add('is-hidden');
      });
      states[idx].cells.forEach((key) => {
        const index = cellKeyToIndex(key);
        if (cells[index]) {
          cells[index].classList.add('is-active');
          cells[index].classList.remove('is-hidden');
        }
      });
      const state = states[idx];
      const action = [
        state.added.length ? `added ${state.added.join(' · ')}` : '',
        state.removed.length ? `removed ${state.removed.join(' · ')}` : ''
      ].filter(Boolean).join('; ') || 'no block change';
      captionEl.textContent = `Session ${idx + 1}/${states.length} · ${state.date || 'No date'} · ${state.cells.length} visible · ${action}`;
    };

    const renderFinal = () => renderState(Math.max(0, states.length - 1));
    let timer = null;
    const play = () => {
      if (timer) return;
      let i = 0;
      playBtn.disabled = true;
      renderState(i);
      timer = setInterval(() => {
        i += 1;
        if (i >= states.length) {
          clearInterval(timer);
          timer = null;
          playBtn.disabled = false;
          renderFinal();
          return;
        }
        renderState(i);
      }, 450);
    };

    renderFinal();
    playBtn.onclick = play;
    if (autoplay) play();
  };
  const img = new Image();
  img.onload = () => applyImageAndRender({ ok: true });
  img.onerror = () => applyImageAndRender({ ok: false });
  img.src = imageUrl;
}
  
async function loadAllEntries() {
  let query = supabase
    .from('entries')
    .select('date, language, minutes')
    .order('date', { ascending: true });

  if (currentUser?.id) query = query.eq('user_id', currentUser.id);

  const { data, error } = await query;
  if (error) return { data: [], error };
  return { data: data || [], error: null };
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
visualizeBtn?.addEventListener('click', async () => {
  openOverlay(visualizeOverlay);
  const { data, error } = await loadAllEntries();
  if (error) { visualizeStatusEl.textContent = `Error: ${error.message}`; return; }
  analyticsRows = data;
  const allDates = analyticsRows.map((r) => r.date).sort();
  visualizeStartEl.value = allDates[0] || todayES();
  visualizeEndEl.value = allDates[allDates.length - 1] || todayES();
  populateVisualizeLanguages(analyticsRows);
  await renderVisualizeChart();
});
analyticsCloseBtn?.addEventListener('click', () => closeOverlay(analyticsOverlay));
aboutCloseBtn?.addEventListener('click', () => closeOverlay(aboutOverlay));
visualizeCloseBtn?.addEventListener('click', () => closeOverlay(visualizeOverlay));

analyticsOverlay?.addEventListener('click', (event) => {
  if (event.target === analyticsOverlay) closeOverlay(analyticsOverlay);
});
visualizeOverlay?.addEventListener('click', (event) => {
  if (event.target === visualizeOverlay) closeOverlay(visualizeOverlay);
});
aboutOverlay?.addEventListener('click', (event) => {
  if (event.target === aboutOverlay) closeOverlay(aboutOverlay);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeOverlay(analyticsOverlay);
    closeOverlay(aboutOverlay);
    closeOverlay(visualizeOverlay);
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

// Right card: navigate to session.html only for users on the private-session allow-list.
const startBtn = document.getElementById('ps-start');
startBtn?.addEventListener('click', async () => {
  startBtn.disabled = true;
  startBtn.style.filter = 'brightness(1.05)';
  setPrivateSessionStatus('Checking private-session access…');

  try {
    const user = currentUser || await requireSession();
    if (!user) return;

    const isAllowed = await currentUserCanStartPrivateSession(user);
    if (!isAllowed) {
      setPrivateSessionStatus('Private sessions are currently limited to approved accounts. Ask the app owner to add your email.');
      startBtn.disabled = false;
      startBtn.style.filter = '';
      return;
    }

    setPrivateSessionStatus('Access approved. Opening your private session…');
    setTimeout(() => { window.location.href = 'session.html'; }, 250);
  } catch (error) {
    setPrivateSessionStatus(error.message || 'Could not verify private-session access.');
    startBtn.disabled = false;
    startBtn.style.filter = '';
  }
});

// Initialize: ensure session, then load
(async () => {
  currentUser = await requireSession();
  if (currentUser) {
    const rows = await loadToday();
    updateQuickStats(rows);
    try {
      const isAllowed = await currentUserCanStartPrivateSession(currentUser);
      setPrivateSessionStatus(isAllowed
        ? 'Private sessions are enabled for your account.'
        : 'Private sessions are currently limited to approved accounts.');
    } catch (error) {
      setPrivateSessionStatus(error.message || 'Could not verify private-session access.');
    }
  }
})();

analyticsViewBarsBtn?.addEventListener('click', () => { analyticsViewMode = 'bars'; analyticsViewBarsBtn.classList.add('active'); analyticsViewCumulativeBtn?.classList.remove('active'); renderAnalytics(); });
analyticsViewCumulativeBtn?.addEventListener('click', () => { analyticsViewMode = 'cumulative'; analyticsViewCumulativeBtn.classList.add('active'); analyticsViewBarsBtn?.classList.remove('active'); renderAnalytics(); });

visualizeForm?.addEventListener('submit', async (event) => { event.preventDefault(); await renderVisualizeChart(); });
visualizeLanguageEl?.addEventListener('change', () => renderVisualizeChart());
visualizeUseAllEl?.addEventListener('change', () => renderVisualizeChart());
visualizeEvolutionBtn?.addEventListener('click', () => renderVisualizeChart({ playEvolution: true }));
