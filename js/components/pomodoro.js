// js/components/pomodoro.js
// Minimal, framework-free Pomodoro with callbacks for persistence.

export function setupPomodoro(rootEl, {
  onStart  = () => {},
  onPause  = () => {},
  onTick   = () => {},
  onReset  = () => {},
  onFinish = () => {},
  maxMinutes = 60
} = {}) {
  const timeEl     = rootEl.querySelector('#pomodoro-time');
  const durInput   = rootEl.querySelector('#pomodoro-duration');
  const startBtn   = rootEl.querySelector('#pomodoro-start');
  const pauseBtn   = rootEl.querySelector('#pomodoro-pause');
  const resetBtn   = rootEl.querySelector('#pomodoro-reset');
  const statusEl   = rootEl.querySelector('#pomodoro-status');

  let totalSec = Math.min(parseInt(durInput.value || '25', 10), maxMinutes) * 60;
  let remaining = totalSec;
  let timer = null;
  let running = false;
  let accumulated = 0; // total studied seconds in this run

  function fmt(sec){
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  function render(){
    timeEl.textContent = fmt(remaining);
  }
  function tick(){
    if (remaining > 0) {
      remaining -= 1;
      accumulated += 1;
      onTick(accumulated, remaining);
      render();
    } else {
      stop();
      status('Session finished ✓');
      onFinish(accumulated);
    }
  }
  function start(){
    if (running) return;
    running = true;
    status('Running…');
    timer = setInterval(tick, 1000);
    onStart({ totalSec, remaining });
  }
  function pause(){
    if (!running) return;
    running = false;
    clearInterval(timer);
    status('Paused');
    onPause(accumulated, remaining);
  }
  function stop(){
    running = false;
    clearInterval(timer);
  }
  function reset(){
    stop();
    totalSec = Math.min(parseInt(durInput.value || '25', 10), maxMinutes) * 60;
    remaining = totalSec;
    accumulated = 0;
    render();
    status('Ready');
    onReset();
  }
  function status(msg){ statusEl.textContent = msg; }

  // Wiring
  startBtn?.addEventListener('click', start);
  pauseBtn?.addEventListener('click', pause);
  resetBtn?.addEventListener('click', reset);
  durInput?.addEventListener('change', () => {
    const v = Math.min(Math.max(parseInt(durInput.value||'25',10),1), maxMinutes);
    durInput.value = String(v);
    if (!running) {
      totalSec = v * 60; remaining = totalSec; accumulated = 0; render();
      status('Duration set');
    }
  });

  // Pause if tab goes hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });

  // Init
  render(); status('Ready');

  return {
    start, pause, reset,
    getState: () => ({ running, remaining, totalSec, accumulated })
  };
}
