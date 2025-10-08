// ./js/session-page.js
document.addEventListener('DOMContentLoaded', () => {
  // ===== Grab elements
  const lessonBtn = document.querySelector('#lesson-1');
  const lessonSelect = document.querySelector('#lesson-select');

  const readerTitle = document.querySelector('#reader-heading') || document.querySelector('#reader-title');
  const readerMeta  = document.querySelector('#reader-meta');
  const readerPage  = document.querySelector('#reader-page');

  // Bottom-sheet + chip
  const sheet      = document.querySelector('#timer-sheet');
  const openChip   = document.querySelector('#open-timer');
  const chipTimeEl = document.querySelector('#chip-time');

  // Pomodoro internals
  const pomodoroRoot = document.querySelector('#pomodoro');
  const timeEl  = document.querySelector('#pomodoro-time');
  const durInput= document.querySelector('#pomodoro-duration');
  const startBtn= document.querySelector('#pomodoro-start');
  const pauseBtn= document.querySelector('#pomodoro-pause');
  const resetBtn= document.querySelector('#pomodoro-reset');
  const finishBtn= document.querySelector('#pomodoro-finish');
  const statusEl= document.querySelector('#pomodoro-status');

  // ===== Study minutes store
  let logEl = document.querySelector('#study-log');
  if (!logEl) {
    logEl = document.createElement('div');
    logEl.id = 'study-log';
    logEl.className = 'muted';
    statusEl?.insertAdjacentElement('afterend', logEl);
  }
  const getTotal = () => Number(localStorage.getItem('study_minutes_total') || '0');
  const setTotal = (m) => localStorage.setItem('study_minutes_total', String(m));
  const addMinutes = (m) => { setTotal(getTotal() + m); renderTotal(); };
  const renderTotal = () => { const t = getTotal(); logEl.textContent = t ? `Total studied: ${t} min` : ''; };
  renderTotal();

  // ===== Helpers
  const fmt = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  };
  const updateStatus = (msg) => { if (statusEl) statusEl.textContent = msg ?? ''; };
  const mirrorChip = () => { if (chipTimeEl && timeEl) chipTimeEl.textContent = timeEl.textContent; };

  const resolveBase = (base) => {
    const u = new URL(base || '.', document.baseURI);
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    return u.href;
  };

  // ===== Lesson loader
  async function loadLessonFromBase(base) {
    const abs = resolveBase(base);
    const metaURL = abs + 'meta.json'; // change to 'meja.json' if that's your actual filename
    const htmlURL = abs + 'content.html';

    updateStatus(`Loading lesson…`);
    try {
      const [metaResp, htmlResp] = await Promise.all([
        fetch(metaURL, { cache: 'no-cache' }),
        fetch(htmlURL, { cache: 'no-cache' })
      ]);

      if (!metaResp.ok) { updateStatus(`Failed meta.json (${metaResp.status}).`); return; }
      if (!htmlResp.ok) { updateStatus(`Failed content.html (${htmlResp.status}).`); return; }

      let meta;
      try { meta = await metaResp.json(); }
      catch { updateStatus('meta.json could not be parsed.'); return; }

      const html = await htmlResp.text();
      if (readerTitle) readerTitle.textContent = meta?.title || 'Lesson';
      readerMeta.textContent = [meta?.level && `Level ${meta.level}`, meta?.estimated_minutes && `${meta.estimated_minutes} min`]
        .filter(Boolean).join(' • ');
      readerPage.innerHTML = html;
      updateStatus('Lesson loaded.');
    } catch (err) {
      console.error('Lesson load error:', err);
      updateStatus('Load failed. Are you serving via http(s)? See console for details.');
    }
  }

  // Wire Lesson 1 (desktop accordion)
  lessonBtn?.addEventListener('click', (e) => {
    const base = (e.currentTarget.getAttribute('data-base') || './lessons/pl/lesson1/').trim();
    loadLessonFromBase(base);
  });

  // Wire lesson dropdown (mobile/header)
  lessonSelect?.addEventListener('change', (e) => {
    const v = e.target.value;
    if (!v || v === 'locked') return;
    loadLessonFromBase(v);
  });

  // ===== Bottom-sheet open/close
  const openSheet = () => {
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden','false');
    openChip.setAttribute('aria-expanded','true');
  };
  const closeSheet = () => {
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden','true');
    openChip.setAttribute('aria-expanded','false');
  };
  openChip?.addEventListener('click', () => {
    if (sheet.classList.contains('open')) closeSheet(); else openSheet();
  });
  // Close with ESC
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet.classList.contains('open')) closeSheet(); });

  // ===== Pomodoro (vanish while running, hover/tap to peek, Finish button)
  let state = 'idle'; // 'idle' | 'running' | 'paused' | 'finished'
  let tick = null, startTs=0, endTs=0, remainingMs=0, pausedAccum=0, lastPauseTs=0;

  const isTouch = matchMedia('(pointer:coarse)').matches;
  const setVanish = (on) => { timeEl.classList.toggle('vanish', !!on); if (!on) timeEl.classList.remove('peek'); };

  let peekTimer = null;
  const peek = () => { timeEl.classList.add('peek'); clearTimeout(peekTimer); peekTimer = setTimeout(()=>timeEl.classList.remove('peek'), 2500); };
  if (isTouch) timeEl.addEventListener('click', ()=>{ if (state==='running') peek(); });

  const renderTick = () => {
    const ms = Math.max(0, endTs - Date.now());
    timeEl.textContent = fmt(ms);
    mirrorChip();
    if (ms <= 0) finishAuto();
  };

  const start = () => {
    const mins = Math.max(1, Math.min(60, parseInt(durInput.value, 10) || 25));
    if (state === 'idle' || state === 'finished') {
      pausedAccum = 0; startTs = Date.now(); endTs = startTs + mins*60_000;
    } else if (state === 'paused') {
      const now = Date.now(); pausedAccum += now - lastPauseTs; endTs = now + remainingMs; startTs = now;
    }
    clearInterval(tick); tick = setInterval(renderTick, 250);
    state = 'running'; setVanish(true); updateStatus('Timer running…');
    renderTick();
  };

  const pause = () => {
    if (state !== 'running') return;
    clearInterval(tick); remainingMs = Math.max(0, endTs - Date.now()); lastPauseTs = Date.now();
    state = 'paused'; setVanish(false); updateStatus('Paused.'); mirrorChip();
  };

  const reset = () => {
    clearInterval(tick); state='idle'; remainingMs=0; pausedAccum=0;
    const mins = Math.max(1, Math.min(60, parseInt(durInput.value,10)||25));
    timeEl.textContent = fmt(mins*60_000);
    setVanish(false); updateStatus('Ready.'); mirrorChip();
  };

  const finishManual = () => {
    if (state === 'idle') return;
    clearInterval(tick);
    const now = Date.now();
    const elapsed = state==='paused' ? Math.max(0, (lastPauseTs - startTs) - pausedAccum)
                                     : Math.max(0, (now - startTs) - pausedAccum);
    const mins = Math.max(0, Math.round(elapsed/60000));
    if (mins > 0) addMinutes(mins);
    state='finished'; setVanish(false); updateStatus(`Session finished. +${mins} min`); mirrorChip();
  };

  const finishAuto = () => {
    clearInterval(tick); state='finished'; setVanish(false);
    const planned = Math.max(0, endTs - startTs);
    const mins = Math.max(0, Math.round(Math.max(0, planned - pausedAccum)/60000));
    if (mins > 0) addMinutes(mins);
    timeEl.textContent = '00:00'; mirrorChip();
    beep(220, 880, 'triangle');
    updateStatus(`Great! Pomodoro complete. +${mins} min`);
  };

  // Beep
  const beep = (dur=220, freq=880, type='triangle') => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = type; o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
      g.gain.value = 0.06; o.start(); setTimeout(()=>{o.stop(); ctx.close();}, dur);
    } catch {}
  };

  // Init time text
  timeEl.textContent = fmt((parseInt(durInput.value,10)||25)*60_000);
  mirrorChip();

  startBtn?.addEventListener('click', start);
  pauseBtn?.addEventListener('click', pause);
  resetBtn?.addEventListener('click', reset);
  finishBtn?.addEventListener('click', finishManual);

  durInput?.addEventListener('change', ()=>{
    if (state==='idle' || state==='finished') {
      const mins = Math.max(1, Math.min(60, parseInt(durInput.value,10)||25));
      timeEl.textContent = fmt(mins*60_000);
      mirrorChip();
    }
  });
});
