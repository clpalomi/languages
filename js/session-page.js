// ./js/session-page.js
// Mobile-first session wiring: lesson loader + Pomodoro with vanish/hover reveal and study log.

document.addEventListener('DOMContentLoaded', () => {
  // ====== Elements
  const lessonBtn = document.querySelector('#lesson-1');
  const readerTitle = document.querySelector('#reader-heading') || document.querySelector('#reader-title');
  const readerMeta = document.querySelector('#reader-meta');
  const readerPage = document.querySelector('#reader-page');

  const pomodoroRoot = document.querySelector('#pomodoro');
  const timeEl = document.querySelector('#pomodoro-time');
  const durInput = document.querySelector('#pomodoro-duration');
  const startBtn = document.querySelector('#pomodoro-start');
  const pauseBtn = document.querySelector('#pomodoro-pause');
  const resetBtn = document.querySelector('#pomodoro-reset');
  const statusEl = document.querySelector('#pomodoro-status');

  // Optional: create a study log line if you want to show cumulative minutes.
  let logEl = document.querySelector('#study-log');
  if (!logEl) {
    logEl = document.createElement('div');
    logEl.id = 'study-log';
    logEl.className = 'muted';
    statusEl?.insertAdjacentElement('afterend', logEl);
  }

  // ====== Helpers
  const fmt = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const ss = (s % 60).toString().padStart(2, '0');
    return `${m}:${ss}`;
  };

  const getTotalStudied = () => Number(localStorage.getItem('study_minutes_total') || '0');
  const setTotalStudied = (m) => localStorage.setItem('study_minutes_total', String(m));
  const addToTotalStudied = (m) => {
    const total = getTotalStudied() + m;
    setTotalStudied(total);
    renderStudyLog();
    // You can listen for this elsewhere in your app if needed.
    document.dispatchEvent(new CustomEvent('study:sessionSaved', { detail: { minutes: m, total } }));
  };
  const renderStudyLog = () => {
    const total = getTotalStudied();
    if (logEl) logEl.textContent = total ? `Total studied: ${total} min` : '';
  };
  renderStudyLog();

  // Simple WebAudio beep (no external files)
  const beep = (duration = 220, freq = 880, type = 'sine') => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.value = 0.06;
      osc.start();
      setTimeout(() => {
        osc.stop();
        ctx.close();
      }, duration);
    } catch {}
  };

  // ====== Lesson loading
  async function loadLessonFromBase(base) {
    if (!base) return;
    try {
      readerMeta.textContent = 'Loading...';
      const [metaResp, contentResp] = await Promise.all([
        fetch(new URL('meta.json', base), { cache: 'no-cache' }),
        fetch(new URL('content.html', base), { cache: 'no-cache' })
      ]);

      if (!metaResp.ok) throw new Error(`meta.json ${metaResp.status}`);
      if (!contentResp.ok) throw new Error(`content.html ${contentResp.status}`);

      const meta = await metaResp.json();
      const html = await contentResp.text();

      if (readerTitle) readerTitle.textContent = meta?.title || 'Lesson';
      readerMeta.textContent = [meta?.level && `Level ${meta.level}`, meta?.estimated_minutes && `${meta.estimated_minutes} min`]
        .filter(Boolean)
        .join(' • ');

      // Inject lesson content into article
      readerPage.innerHTML = html;
      statusEl.textContent = 'Lesson loaded.';
    } catch (err) {
      console.error('Lesson load error:', err);
      readerMeta.textContent = '';
      statusEl.textContent = 'Failed to load lesson. Are you serving files over http(s)?';
    }
  }

  // Bind the sample lesson button
  if (lessonBtn) {
    lessonBtn.addEventListener('click', (e) => {
      const base = e.currentTarget.getAttribute('data-base');
      // NOTE: fetch() won’t work from file:// — run a local server (e.g., `npx serve` in your project root).
      loadLessonFromBase(base);
    });
  }

  // ====== Pomodoro logic (vanish timer while running)
  let state = 'idle';           // 'idle' | 'running' | 'paused' | 'finished'
  let intervalId = null;
  let startTs = 0;              // ms since epoch when counting truly started/resumed
  let endTs = 0;                // ms since epoch when it should end
  let remainingMs = 0;          // snapshot on pause
  let pausedAccum = 0;          // total time paused (ms)
  let lastPauseTs = 0;          // ms when paused began

  const isTouch = matchMedia('(pointer:coarse)').matches;

  const setVanish = (on) => {
    // Make counting vanish; reveal on hover/focus. On touch, we allow tap to “peek”.
    if (on) {
      timeEl.classList.add('vanish');
    } else {
      timeEl.classList.remove('vanish', 'peek');
    }
  };

  // Touch “peek” (tap to show for a few seconds)
  let peekTimer = null;
  const peekTime = () => {
    timeEl.classList.add('peek');
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => timeEl.classList.remove('peek'), 2500);
  };
  if (isTouch) {
    timeEl.addEventListener('click', () => {
      if (state === 'running') peekTime();
    });
  }

  const updateStatus = (msg) => { statusEl.textContent = msg || ''; };

  const renderTick = () => {
    const now = Date.now();
    const ms = Math.max(0, endTs - now);
    timeEl.textContent = fmt(ms);
    if (ms <= 0) {
      finishAuto();
    }
  };

  const start = () => {
    const mins = Math.max(1, Math.min(60, parseInt(durInput.value, 10) || 25));
    if (state === 'idle' || state === 'finished') {
      pausedAccum = 0;
      startTs = Date.now();
      endTs = startTs + mins * 60_000;
    } else if (state === 'paused') {
      const now = Date.now();
      pausedAccum += now - lastPauseTs;
      // Continue from remaining
      endTs = now + remainingMs;
      startTs = now; // set a new start for reference
    }
    clearInterval(intervalId);
    intervalId = setInterval(renderTick, 250);
    state = 'running';
    setVanish(true);
    updateStatus('Focus on your study — timer running.');
    renderTick();
  };

  const pause = () => {
    if (state !== 'running') return;
    clearInterval(intervalId);
    remainingMs = Math.max(0, endTs - Date.now());
    lastPauseTs = Date.now();
    state = 'paused';
    setVanish(false);
    updateStatus('Paused.');
  };

  const reset = () => {
    clearInterval(intervalId);
    state = 'idle';
    remainingMs = 0;
    pausedAccum = 0;
    timeEl.textContent = fmt((parseInt(durInput.value, 10) || 25) * 60_000);
    setVanish(false);
    updateStatus('Ready.');
  };

  // Manual finish button behavior: save elapsed time since (last) start, minus pauses.
  const finish = () => {
    if (state === 'idle') return;
    clearInterval(intervalId);

    let elapsedMs;
    const now = Date.now();

    if (state === 'paused') {
      // paused: elapsed is (lastPauseTs - start) minus pausedAccum before that
      elapsedMs = (lastPauseTs - startTs) - pausedAccum;
    } else {
      // running: elapsed is (now - start) minus pausedAccum
      elapsedMs = (now - startTs) - pausedAccum;
    }
    elapsedMs = Math.max(0, elapsedMs);

    const minutes = Math.max(0, Math.round(elapsedMs / 60000));
    if (minutes > 0) addToTotalStudied(minutes);

    state = 'finished';
    setVanish(false);
    updateStatus(`Session finished. +${minutes} min`);
  };

  // Auto-finish when countdown hits zero
  const finishAuto = () => {
    clearInterval(intervalId);
    state = 'finished';
    setVanish(false);

    // Full planned duration is credited (minus pauses, but at zero we assume completion).
    // Compute how much was actually elapsed (endTs - (startTs)) minus pauses — should be planned mins.
    const plannedMs = Math.max(0, endTs - startTs);
    const elapsedMs = Math.max(0, plannedMs - pausedAccum);
    const minutes = Math.max(0, Math.round(elapsedMs / 60000));

    if (minutes > 0) addToTotalStudied(minutes);
    beep(220, 880, 'triangle');
    timeEl.textContent = '00:00';
    updateStatus(`Great! Pomodoro complete. +${minutes} min`);
  };

  // Initial time value
  timeEl.textContent = fmt((parseInt(durInput.value, 10) || 25) * 60_000);

  // Bind controls
  startBtn?.addEventListener('click', start);
  pauseBtn?.addEventListener('click', pause);
  resetBtn?.addEventListener('click', reset);

  // Add a "Finish" button next to existing buttons (non-destructive)
  if (pomodoroRoot && !pomodoroRoot.querySelector('#pomodoro-finish')) {
    const finishBtn = document.createElement('button');
    finishBtn.id = 'pomodoro-finish';
    finishBtn.className = 'btn';
    finishBtn.type = 'button';
    finishBtn.textContent = 'Finish';
    finishBtn.addEventListener('click', finish);
    pomodoroRoot.querySelector('.controls')?.appendChild(finishBtn);
  }

  // Keep display in sync if user changes duration while idle
  durInput?.addEventListener('change', () => {
    if (state === 'idle' || state === 'finished') {
      const mins = Math.max(1, Math.min(60, parseInt(durInput.value, 10) || 25));
      timeEl.textContent = fmt(mins * 60_000);
    }
  });
});
