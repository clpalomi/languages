// /js/components/pomodoro.js
import { supabase } from "../client.js";

/**
 * Pomodoro component:
 * - mount(el, { maxMinutes, onTick(seconds), onChunkSaved(seconds) })
 * - Saves elapsed seconds on pause/reset via saveChunk(userId, lessonKey, seconds)
 */
export function mountPomodoro(el, opts = {}) {
  const max = Math.max(1, Math.min(60, Number(opts.maxMinutes ?? 60)));
  const elTime  = el.querySelector("#pomo-time");
  const elMins  = el.querySelector("#pomo-mins");
  const elStart = el.querySelector("#pomo-start");
  const elPause = el.querySelector("#pomo-pause");
  const elReset = el.querySelector("#pomo-reset");
  const elStatus= el.querySelector("#pomo-status");

  let state = { target: (Number(elMins.value)||25)*60, remaining: 0, running:false, handle:null, startedAt:null, accum:0, user:null, lessonKey:null };

  async function getUser(){
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user ?? null;
  }

  function format(sec){
    const m = Math.floor(sec/60).toString().padStart(2,'0');
    const s = Math.floor(sec%60).toString().padStart(2,'0');
    return `${m}:${s}`;
  }

  function update(){
    elTime.textContent = format(state.running ? state.remaining : state.target);
    if (opts.onTick) opts.onTick(state.running ? (state.target - state.remaining) : 0);
  }

  function tick(){
    state.remaining -= 1;
    if (state.remaining <= 0){
      pause(true);
      elStatus.textContent = "Time’s up! Logged your study time.";
    }
    update();
  }

  async function saveChunk(seconds){
    if (!state.user || !state.lessonKey || seconds <= 0) return;
    try {
      await supabase.from("session_study_time").insert({
        user_id: state.user.id,
        lesson_key: state.lessonKey,
        seconds: Math.round(seconds),
        started_at: state.startedAt ?? new Date().toISOString(),
        ended_at: new Date().toISOString()
      });
      if (opts.onChunkSaved) opts.onChunkSaved(seconds);
    } catch (e) {
      console.error("Time save error:", e);
      elStatus.textContent = "Couldn’t save time (offline?). Will retry on next save.";
    }
  }

  function start(){
    if (state.running) return;
    const mins = Math.max(1, Math.min(max, Number(elMins.value)||25));
    state.target = mins*60;
    state.remaining = state.remaining>0 && state.remaining<=state.target ? state.remaining : state.target;
    state.running = true;
    state.startedAt = new Date().toISOString();
    elStatus.textContent = "Studying…";
    state.handle = setInterval(tick, 1000);
    update();
  }

  async function pause(final=false){
    if (!state.running) return;
    clearInterval(state.handle); state.handle = null; state.running=false;
    const studied = state.target - state.remaining;
    state.accum += studied;
    await saveChunk(studied);
    // keep remaining (for resume) unless final
    if (final) { state.remaining = 0; }
    elStatus.textContent = final ? "Session finished." : "Paused.";
    update();
  }

  async function reset(){
    await pause(true);
    state.remaining = state.target;
    state.accum = 0;
    elStatus.textContent = "Reset.";
    update();
  }

  // Public helpers
  async function setLessonKey(k){
    state.lessonKey = k;
    if (!state.user) state.user = await getUser();
  }

  // Wire UI
  elMins.addEventListener("change", () => {
    const v = Math.max(1, Math.min(max, Number(elMins.value)||25));
    elMins.value = String(v);
    state.target = v*60; state.remaining = state.target; update();
  });
  elStart.addEventListener("click", start);
  elPause.addEventListener("click", () => pause(false));
  elReset.addEventListener("click", reset);
  window.addEventListener("beforeunload", () => { if (state.running) pause(false); });

  // init
  (async () => { state.user = await getUser(); state.remaining = (Number(elMins.value)||25)*60; update(); })();

  return { setLessonKey, start, pause, reset };
}
