// Minimal session logic: lessons drawer + floating tomato timer + lesson loader
document.addEventListener('DOMContentLoaded', () => {

  /* ========== Elements */
  const menuBtn   = document.querySelector('#menu-btn');
  const drawer    = document.querySelector('#lesson-drawer');
  const lessons   = Array.from(document.querySelectorAll('.lesson'));
  const pageEl    = document.querySelector('#reader-page');
  const titleEl   = document.querySelector('#reader-heading');
  const metaEl    = document.querySelector('#reader-meta');

  const tomatoBtn = document.querySelector('#tomato');
  const hotspot   = document.querySelector('#tomato-hotspot');
  const sheet     = document.querySelector('#tomato-sheet');

  const timeEl = document.querySelector('#time');
  const durEl  = document.querySelector('#dur');
  const start  = document.querySelector('#start');
  const pause  = document.querySelector('#pause');
  const reset  = document.querySelector('#reset');
  const finish = document.querySelector('#finish');
  const status = document.querySelector('#status');
  const totalEl= document.querySelector('#total');

  // Auth buttons
  const signoutBtn = document.querySelector('#signout');
  const comebackBtn= document.querySelector('#comeback');

  /* ========== Lessons drawer */
  const toggleDrawer = (open) => {
    const isOpen = open ?? !drawer.classList.contains('open');
    drawer.classList.toggle('open', isOpen);
    menuBtn.setAttribute('aria-expanded', String(isOpen));
  };
  menuBtn.addEventListener('click', () => toggleDrawer());

  /* ========== Lesson loader */
  const resolveBase = (base) => {
    const u = new URL(base || '.', document.baseURI);
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    return u.href;
  };

  async function loadLesson(base){
    const abs = resolveBase(base);
    const metaURL = abs + 'meta.json';      // change to 'meja.json' if that's your filename
    const htmlURL = abs + 'content.html';

    status.textContent = 'Loading…';
    try{
      const [m, h] = await Promise.all([
        fetch(metaURL, { cache:'no-cache' }),
        fetch(htmlURL, { cache:'no-cache' })
      ]);
      if(!m.ok || !h.ok){ status.textContent = 'Load failed.'; return; }
      const meta = await m.json().catch(()=> ({}));
      const html = await h.text();

      titleEl.textContent = meta?.title || 'Lesson';
      metaEl.textContent  = [meta?.level && `Level ${meta.level}`, meta?.estimated_minutes && `${meta.estimated_minutes} min`]
        .filter(Boolean).join(' • ');
      pageEl.innerHTML = html;
      status.textContent = 'Lesson loaded.';
      toggleDrawer(false); // auto close
    }catch(e){
      console.error(e);
      status.textContent = 'Load error. Check console.';
    }
  }

  lessons.forEach(btn => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => {
      const base = btn.getAttribute('data-base');
      if (base) loadLesson(base);
    });
  });

  /* ========== Storage: total + per-session logs */
  const fmt = (ms) => {
    const s = Math.max(0, Math.round(ms/1000));
    return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  };

  const TOTAL_KEY = 'study_minutes_total';
  const SESSIONS_KEY = 'study_sessions'; // array of {ts, minutes}

  const getTotal = () => Number(localStorage.getItem(TOTAL_KEY) || '0');
  const setTotal = (m) => localStorage.setItem(TOTAL_KEY, String(m));
  const getSessions = () => {
    try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]'); }
    catch { return []; }
  };
  const addSession = (minutes) => {
    const sessions = getSessions();
    sessions.push({ ts: new Date().toISOString(), minutes });
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  };

  const renderTotal = () => {
    const t = getTotal();
    totalEl.textContent = t ? `Total studied: ${t} min` : '';
  };
  renderTotal();

  /* ========== Floating tomato timer */
  let state='idle', tick=null, startTs=0, endTs=0, remainingMs=0, pausedAccum=0, lastPauseTs=0;

  // open/close small sheet
  const openSheet = (open) => {
    const isOpen = open ?? !sheet.classList.contains('open');
    sheet.classList.toggle('open', isOpen);
    tomatoBtn.setAttribute('aria-expanded', String(isOpen));
    sheet.setAttribute('aria-hidden', String(!isOpen));
  };
  tomatoBtn.addEventListener('click', () => openSheet());
  hotspot.addEventListener('click', () => openSheet(true));
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') openSheet(false); });

  // vanish tomato while running (button already fades)
  const setTomatoVanish = (on) => tomatoBtn.classList.toggle('vanish', !!on);
  // NEW: vanish the clock text while running; still updates in the background
  const setClockVanish = (on) => timeEl.classList.toggle('vanish', !!on);

  // Beep
  const beep = (dur=220, freq=880, type='triangle') => {
    try{ const ctx = new (window.AudioContext||window.webkitAudioContext)();
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.type=type; o.frequency.value=freq; o.connect(g); g.connect(ctx.destination);
      g.gain.value=0.06; o.start(); setTimeout(()=>{o.stop(); ctx.close();}, dur);
    }catch{}
  };

  const renderTick = () => {
    const ms = Math.max(0, endTs - Date.now());
    // Still updates internally even when invisible:
    timeEl.textContent = fmt(ms);
    if (ms <= 0) finishAuto();
  };

  const doStart = () => {
    const mins = Math.max(1, Math.min(60, parseInt(durEl.value,10)||25));
    if (state==='idle' || state==='finished'){
      pausedAccum=0; startTs=Date.now(); endTs=startTs + mins*60_000;
    } else if (state==='paused'){
      const now = Date.now(); pausedAccum += now - lastPauseTs; endTs = now + remainingMs; startTs = now;
    }
    clearInterval(tick); tick = setInterval(renderTick, 250);
    state='running'; status.textContent='Running…';
    setTomatoVanish(true);   // hide tomato button
    setClockVanish(true);    // hide the clock text
    renderTick();
  };

  const doPause = () => {
    if (state!=='running') return;
    clearInterval(tick); remainingMs = Math.max(0, endTs - Date.now()); lastPauseTs = Date.now();
    state='paused'; status.textContent='Paused';
    setTomatoVanish(false);
    setClockVanish(false);
  };

  const doReset = () => {
    clearInterval(tick); state='idle'; remainingMs=0; pausedAccum=0;
    timeEl.textContent = fmt((parseInt(durEl.value,10)||25)*60_000);
    status.textContent='Ready';
    setTomatoVanish(false);
    setClockVanish(false);
  };

  const persistMinutes = (mins) => {
    if (mins > 0) {
      setTotal(getTotal() + mins);
      addSession(mins);           // <-- per-session log
      renderTotal();
    }
  };

  const doFinishManual = () => {
    if (state==='idle') return;
    clearInterval(tick);
    const now = Date.now();
    const elapsed = state==='paused' ? Math.max(0, (lastPauseTs - startTs) - pausedAccum)
                                     : Math.max(0, (now - startTs) - pausedAccum);
    const mins = Math.max(0, Math.round(elapsed/60000));
    persistMinutes(mins);         // <-- auto save on Finish
    state='finished'; status.textContent=`Finished +${mins} min`;
    setTomatoVanish(false);
    setClockVanish(false);
  };

  const finishAuto = () => {
    clearInterval(tick); state='finished';
    const planned = Math.max(0, endTs - startTs);
    const mins = Math.max(0, Math.round(Math.max(0, planned - pausedAccum)/60000));
    persistMinutes(mins);         // <-- auto save on auto-finish too
    timeEl.textContent='00:00'; status.textContent=`Pomodoro complete +${mins} min`;
    setTomatoVanish(false);
    setClockVanish(false);
    beep();
  };

  // Wire controls
  start.addEventListener('click', doStart);
  pause.addEventListener('click', doPause);
  reset.addEventListener('click', doReset);
  finish.addEventListener('click', doFinishManual);

  // Init time
  timeEl.textContent = fmt((parseInt(durEl.value,10)||25)*60_000);

  // Update time preview when duration changes (only idle/finished)
  durEl.addEventListener('change', ()=>{
    const v = Math.max(1, Math.min(60, parseInt(durEl.value,10)||25));
    durEl.value = String(v);
    if (state==='idle' || state==='finished'){
      timeEl.textContent = fmt(v*60_000);
    }
  });

  // Pause if tab hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) doPause();
  });

  /* ========== Sign out / Come back (simple client-side stub) */
  const setSignedOutUI = (out) => {
    document.body.classList.toggle('signed-out', !!out);
    // optionally disable interactions when signed out:
    drawer.classList.toggle('open', false);
    sheet.classList.toggle('open', false);
    status.textContent = out ? 'Signed out' : 'Ready';
  };

  signoutBtn?.addEventListener('click', () => {
    localStorage.setItem('signed_out', '1');
    setSignedOutUI(true);
    alert('You have signed out. Study data is kept locally.');
  });

  comebackBtn?.addEventListener('click', () => {
    localStorage.removeItem('signed_out');
    setSignedOutUI(false);
    alert('Welcome back!');
  });

  // Restore sign-out state on load
  if (localStorage.getItem('signed_out') === '1') setSignedOutUI(true);
});
