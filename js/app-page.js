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

function populateVisualizeLanguages(rows) {
  const languages = [...new Set(rows.map((row) => row.language || 'Unknown'))].sort((a, b) => a.localeCompare(b));
  if (!languages.length) {
    visualizeLanguageEl.innerHTML = '<option value="">No language available</option>';
    return;
  }
visualizeLanguageEl.innerHTML = languages.map((language) => `<option value="${escapeHtml(language)}">${escapeHtml(language)}</option>`).join('');
}

function renderVisualizeChart() {
  const language = visualizeLanguageEl.value;
  if (!language) {
    visualizeChartEl.innerHTML = '<div class="empty analytics-empty">Select a language to visualize.</div>';
    return;
  }
  let rows = analyticsRows.filter((r) => (r.language || 'Unknown') === language);
  if (!visualizeUseAllEl.checked) {
    const start = visualizeStartEl.value;
    const end = visualizeEndEl.value;
    if (!start || !end || start > end) {
      visualizeStatusEl.textContent = 'Choose a valid date range.';
      return;
    }
    rows = rows.filter((r) => r.date >= start && r.date <= end);
  }
  visualizeStatusEl.textContent = rows.length ? `${rows.length} sessions included.` : 'No sessions match this configuration.';
  if (!rows.length) {
    visualizeChartEl.innerHTML = '<div class="empty analytics-empty">No sessions to graph.</div>';
    return;
  }
  
  const timeline = computeStudyStrength(rows);
  let runningMinutes = 0;
  const points = timeline.map((p, i) => {
    runningMinutes += Number(rows[i]?.minutes || 0);
    return { ...p, cumulativeMinutes: runningMinutes };
  });

  const width = 760, height = 320, padL = 52, padR = 16, padT = 24, padB = 48;
  const maxX = Math.max(1, points.length - 1);
  const maxStrength = Math.max(1, ...points.map((p) => p.value));
  const x = (i) => padL + (i * (width - padL - padR) / maxX);
  const yStr = (v) => height - padB - ((v / maxStrength) * (height - padT - padB));
  
  const strLine = points.map((p, i) => `${x(i).toFixed(2)},${yStr(p.value).toFixed(2)}`).join(' ');
  const markers = points.map((p, i) => {
    const prev = i ? points[i - 1].blocks : 0;
    if (p.blocks <= prev) return '';
    return `<circle cx="${x(i).toFixed(2)}" cy="${yStr(p.value).toFixed(2)}" r="3.5" fill="#f97316"/>`;
  }).join('');
  const tickIndexes = [...new Set([0, Math.floor(maxX * 0.25), Math.floor(maxX * 0.5), Math.floor(maxX * 0.75), maxX])];
  const xTicks = tickIndexes.map((index) => {
    const date = points[index]?.date || '';
    return `<text x="${x(index).toFixed(2)}" y="${height - 16}" text-anchor="middle" font-size="11" fill="currentColor" opacity=".8">${escapeHtml(date)}</text>`;
  }).join('');

  const gridStates = buildGridStates(points);
  
  visualizeChartEl.innerHTML = `<div class="visualize-wrap">
    <div class="visualize-note">Language: <strong>${escapeHtml(language)}</strong>. Curve is study strength over time and block progression over a 20×20 grid.</div>
    <svg class="analytics-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Study strength by date">
      <line x1="${padL}" y1="${height - padB}" x2="${width - padR}" y2="${height - padB}" stroke="currentColor" opacity=".25"/>
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${height - padB}" stroke="currentColor" opacity=".25"/>
      <polyline fill="none" stroke="#16a34a" stroke-width="3" points="${strLine}" />
      ${markers}
      ${xTicks}
      <text x="${padL - 34}" y="${height/2}" transform="rotate(-90 ${padL - 34} ${height/2})" font-size="12" font-weight="700">Punctuation</text>
    </svg>
    <div class="visualize-legend"><span>🟢 Study strength</span><span>🟠 Block gain</span></div>
    <div class="grid-anim-controls"><button id="visualize-grid-play" type="button">▶ Play</button><span id="visualize-grid-caption">Blocks: ${gridStates[0].blocks} · Punctuation: ${gridStates[0].value.toFixed(1)}</span></div>
    <div class="visualize-grid" id="visualize-grid" aria-label="20 by 20 block grid"></div>
  </div>`;
  
  setupGridAnimation(gridStates);
}

function buildGridStates(points, revealableSet = null, startCell = null) {
  const size = 20;
  const center = Math.floor(size / 2);
  const start = startCell || `${center},${center}`;
  const active = new Set();
  const order = [];
  const states = [];

  const neighbors = (r, c) => [[r-1,c],[r+1,c],[r,c-1],[r,c+1]].filter(([nr,nc]) => nr >= 0 && nr < size && nc >= 0 && nc < size);

  points.forEach((point, idx) => {
    const prevBlocks = idx ? points[idx - 1].blocks : 0;
    const delta = point.blocks - prevBlocks;

    if (delta > 0) {
      for (let i = 0; i < delta; i += 1) {
        let chosen = null;
        if (!active.size) {
          chosen = start;
        } else {
          const candidates = [];
          active.forEach((key) => {
            const [r,c] = key.split(',').map(Number);
            neighbors(r,c).forEach(([nr,nc]) => {
              const nk = `${nr},${nc}`;
              if (!active.has(nk) && (!revealableSet || revealableSet.has(nk))) candidates.push(nk);
            });
          });
          if (candidates.length) chosen = candidates[0];
        }
        if (chosen && !active.has(chosen) && (!revealableSet || revealableSet.has(chosen))) { active.add(chosen); order.push(chosen); }
      }
    } else if (delta < 0) {
      for (let i = 0; i < Math.abs(delta); i += 1) {
        const key = order.pop();
        if (key) active.delete(key);
      }
    }

    states.push({ cells: [...active], blocks: point.blocks, value: point.value });
  });
  return states.length ? states : [{ cells: [], blocks: 0, value: 0 }];
}

function setupGridAnimation(states) {
  const gridEl = qs('#visualize-grid');
  const playBtn = qs('#visualize-grid-play');
  const captionEl = qs('#visualize-grid-caption');
  if (!gridEl || !playBtn || !captionEl) return;

  const computeRevealMask = (imgWidth, imgHeight, size = 20) => {
    const imageRatio = imgWidth / imgHeight;
    let renderCols = size;
    let renderRows = size;
    if (imageRatio > 1) renderRows = Math.max(1, Math.round(size / imageRatio));
    if (imageRatio < 1) renderCols = Math.max(1, Math.round(size * imageRatio));
    const colOffset = Math.floor((size - renderCols) / 2);
    const rowOffset = Math.floor((size - renderRows) / 2);
    const revealable = new Set();
    for (let r = rowOffset; r < rowOffset + renderRows; r += 1) {
      for (let c = colOffset; c < colOffset + renderCols; c += 1) revealable.add(`${r},${c}`);
    }
    const center = `${Math.floor(size / 2)},${Math.floor(size / 2)}`;
    const startCell = revealable.has(center) ? center : [...revealable][0] || center;
    return { revealable, startCell };
  };

  const imageUrl = 'images/flag_georgia.png';
  const applyImageAndRender = (imageMeta) => {
    const { revealable, startCell } = computeRevealMask(imageMeta.width, imageMeta.height);
    const effectiveStates = buildGridStates(states.map((s) => ({ blocks: s.blocks, value: s.value })), revealable, startCell);
    const total = 400;
    gridEl.innerHTML = Array.from({ length: total }, (_, i) => `<div class="grid-cell" data-i="${i}"></div>`).join('');
    if (imageMeta.ok) gridEl.style.setProperty('--grid-image', `url("${imageUrl}")`);
    const cells = [...gridEl.querySelectorAll('.grid-cell')];
    const mapIndex = (cellKey) => {
      const [r, c] = cellKey.split(',').map(Number);
      return (r * 20) + c;
    };

    const renderState = (idx) => {
      cells.forEach((cell) => cell.classList.remove('is-active'));
      effectiveStates[idx].cells.forEach((key) => {
        const index = mapIndex(key);
        if (cells[index]) cells[index].classList.add('is-active');
      });
      captionEl.textContent = `Blocks: ${effectiveStates[idx].blocks} · Punctuation: ${effectiveStates[idx].value.toFixed(1)}`;
    };

    renderState(0);
    let timer = null;
    playBtn.onclick = () => {
      if (timer) return;
      let i = 0;
      playBtn.disabled = true;
      renderState(i);
      timer = setInterval(() => {
        i += 1;
        if (i >= effectiveStates.length) {
          clearInterval(timer);
          timer = null;
          playBtn.disabled = false;
          return;
        }
        renderState(i);
      }, 450);
    };
  };
  const img = new Image();
  img.onload = () => applyImageAndRender({ ok: true, width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
  img.onerror = () => applyImageAndRender({ ok: false, width: 1, height: 1 });
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
  renderVisualizeChart();
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

visualizeForm?.addEventListener('submit', (event) => { event.preventDefault(); renderVisualizeChart(); });
visualizeLanguageEl?.addEventListener('change', renderVisualizeChart);
visualizeUseAllEl?.addEventListener('change', renderVisualizeChart);
