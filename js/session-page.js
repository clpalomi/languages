// ./js/session-page.js
document.addEventListener('DOMContentLoaded', () => {
  // ===== Grab elements
  const lessonBtn = document.querySelector('#lesson-1');
  const readerTitle = document.querySelector('#reader-heading') || document.querySelector('#reader-title');
  const readerMeta  = document.querySelector('#reader-meta');
  const readerPage  = document.querySelector('#reader-page');

  const pomodoroRoot = document.querySelector('#pomodoro');
  const timeEl  = document.querySelector('#pomodoro-time');
  const durInput= document.querySelector('#pomodoro-duration');
  const startBtn= document.querySelector('#pomodoro-start');
  const pauseBtn= document.querySelector('#pomodoro-pause');
  const resetBtn= document.querySelector('#pomodoro-reset');
  const statusEl= document.querySelector('#pomodoro-status');

  // Inject a study log line if absent
  let logEl = document.querySelector('#study-log');
  if (!logEl) {
    logEl = document.createElement('div');
    logEl.id = 'study-log';
    logEl.className = 'muted';
    statusEl?.insertAdjacentElement('afterend', logEl);
  }

  // ===== Helpers
  const fmt = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  };
  const updateStatus = (msg) => { if (statusEl) statusEl.textContent = msg ?? ''; };

  const resolveBase = (base) => {
    // Make absolute against the document, ensure trailing slash
    const u = new URL(base || '.', document.baseURI);
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    const href = u.href;
    return href;
  };

  // ===== Study minutes store
  const getTotal = () => Number(localStorage.getItem('study_minutes_total') || '0');
  const setTotal = (m) => localStorage.setItem('study_minutes_total', String(m));
  const addMinutes = (m) => { setTotal(getTotal() + m); renderTotal(); };
  const renderTotal = () => { const t = getTotal(); logEl.textContent = t ? `Total studied: ${t} min` : ''; };
  renderTotal();

  // ===== Beep
  const beep = (dur=220, freq=880, type='triangle') => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = type; o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
      g.gain.value = 0.06; o.start(); setTimeout(()=>{o.stop(); ctx.close();}, dur);
    } catch {}
  };

  // ===== Lesson loader (with explicit diagnostics)
  async function loadLessonFromBase(base) {
    const abs = resolveBase(base);
    const metaURL = abs + 'meta.json';
    const htmlURL = abs + 'content.html';

    updateStatus(`Loading lesson… (meta: ${metaURL}, content: ${htmlURL})`);
    console.log('[Lesson loader] Trying:', { base, resolvedBase: abs, metaURL, htmlURL });

    try {
      const [metaResp, htmlResp] = await Promise.all([
        fetch(metaURL, { cache: 'no-cache' }),
        fetch(htmlURL, { cache: 'no-cache' })
      ]);

      if (!metaResp.ok) {
        updateStatus(`Failed meta.json (${metaResp.status}). Check path/filename.`);
        console.error('meta.json fetch failed:', metaResp.status, metaResp.statusText);
        return;
      }
      if (!htmlResp.ok) {
        updateStatus(`Failed content.html (${htmlResp.status}). Check path/filename.`);
        console.error('content.html fetch failed:', htmlResp.status, htmlResp.statusText);
        return;
      }

      let meta;
      try {
        meta = await metaResp.json();
      } catch (e) {
        updateStatus('meta.json could not be parsed (invalid JSON).');
        console.error('JSON parse error for meta.json:', e);
        return;
      }

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

  // Wire Lesson 1
  if (lessonBtn) {
    lessonBtn.addEventListener('click', (e) => {
      const base = (e.currentTarget.getAttribute('data-base') || 'lessons/pl/lesson1/').trim();
      loadLessonFromBase(base);
    });
  }

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
    state = 'paused'; setVanish(false); updateStatus('Paused.');
  };

  const reset = () => {
    clearInterval(tick); state='idle'; remainingMs=0; pausedAccum=0;
    timeEl.textContent = fmt((parseInt(durInput.value,10)||25)*60_000);
    setVanish(false); updateStatus('Ready.');
  };

  const finishManual = () => {
    if (state === 'idle') return;
    clearInterval(tick);
    const now = Date.now();
    const elapsed = state==='paused' ? Math.max(0, (lastPauseTs - startTs) - pausedAccum)
                                     : Math.max(0, (now - startTs) - pausedAccum);
    const mins = Math.max(0, Math.round(elapsed/60000));
    if (mins > 0) addMinutes(mins);
    state='finished'; setVanish(false); updateStatus(`Session finished. +${mins} min`);
  };

  const finishAuto = () => {
    clearInterval(tick); state='finished'; setVanish(false);
    const planned = Math.max(0, endTs - startTs);
    const mins = Math.max(0, Math.round(Math.max(0, planned - pausedAccum)/60000));
    if (mins > 0) addMinutes(mins);
    beep(220, 880, 'triangle'); timeEl.textContent = '00:00';
    updateStatus(`Great! Pomodoro complete. +${mins} min`);
  };

  timeEl.textContent = fmt((parseInt(durInput.value,10)||25)*60_000);
  startBtn?.addEventListener('click', start);
  pauseBtn?.addEventListener('click', pause);
  resetBtn?.addEventListener('click', reset);

  if (pomodoroRoot && !pomodoroRoot.querySelector('#pomodoro-finish')) {
    const finishBtn = document.createElement('button');
    finishBtn.id='pomodoro-finish'; finishBtn.type='button'; finishBtn.className='btn'; finishBtn.textContent='Finish';
    finishBtn.addEventListener('click', finishManual);
    pomodoroRoot.querySelector('.controls')?.appendChild(finishBtn);
  }

  durInput?.addEventListener('change', ()=>{
    if (state==='idle' || state==='finished') {
      const mins = Math.max(1, Math.min(60, parseInt(durInput.value,10)||25));
      timeEl.textContent = fmt(mins*60_000);
    }
  });
});
