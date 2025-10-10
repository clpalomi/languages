// Safe defaults so missing config never throws
window.APP_CONFIG = Object.assign(
  {
    // Set this to navigate somewhere when the user clicks "Come back".
    // Leave as "" to stay on the same page.
    COMEBACK_URL: "",
  },
  window.APP_CONFIG || {}
);

// Minimal session logic: lessons drawer + floating tomato timer + lesson loader
document.addEventListener("DOMContentLoaded", () => {
  /* ========== Elements */
  const menuBtn = document.querySelector("#menu-btn");
  const drawer = document.querySelector("#lesson-drawer");
  const lessons = Array.from(document.querySelectorAll(".lesson"));
  const pageEl = document.querySelector("#reader-page");
  const titleEl = document.querySelector("#reader-heading");
  const metaEl = document.querySelector("#reader-meta");

  const tomatoBtn = document.querySelector("#tomato");
  const hotspot = document.querySelector("#tomato-hotspot");
  const sheet = document.querySelector("#tomato-sheet");

  const timeEl = document.querySelector("#time");
  const durEl = document.querySelector("#dur");
  const start = document.querySelector("#start");
  const pause = document.querySelector("#pause");
  const reset = document.querySelector("#reset");
  const finish = document.querySelector("#finish");
  const status = document.querySelector("#status");
  const totalEl = document.querySelector("#total");

  // Menu auth actions (inside drawer)
  const menuComeback = document.querySelector("#menu-comeback");
  const menuSignout = document.querySelector("#menu-signout");

  /* ========== Lessons drawer */
  const toggleDrawer = (open) => {
    const isOpen = open ?? !drawer.classList.contains("open");
    drawer.classList.toggle("open", isOpen);
    menuBtn?.setAttribute("aria-expanded", String(isOpen));
  };
  menuBtn?.addEventListener("click", () => toggleDrawer());

  /* ========== Lesson loader */
  const resolveBase = (base) => {
    const u = new URL(base || ".", document.baseURI);
    if (!u.pathname.endsWith("/")) u.pathname += "/";
    return u.href;
  };

  async function loadLesson(base) {
    const abs = resolveBase(base);
    const metaURL = abs + "meta.json"; // change to 'meja.json' if needed
    const htmlURL = abs + "content.html";

    status.textContent = "Loading…";
    try {
      const [m, h] = await Promise.all([
        fetch(metaURL, { cache: "no-cache" }),
        fetch(htmlURL, { cache: "no-cache" }),
      ]);
      if (!m.ok || !h.ok) {
        status.textContent = "Load failed.";
        return;
      }
      const meta = await m.json().catch(() => ({}));
      const html = await h.text();

      titleEl.textContent = meta?.title || "Lesson";
      metaEl.textContent = [
        meta?.level && `Level ${meta.level}`,
        meta?.estimated_minutes && `${meta.estimated_minutes} min`,
      ]
        .filter(Boolean)
        .join(" • ");
      pageEl.innerHTML = html;
      status.textContent = "Lesson loaded.";
      toggleDrawer(false); // auto close
    } catch (e) {
      console.error(e);
      status.textContent = "Load error. Check console.";
    }
  }

  lessons.forEach((btn) => {
    if (btn.disabled) return;
    btn.addEventListener("click", () => {
      const base = btn.getAttribute("data-base");
      if (base) loadLesson(base);
    });
  });

  /* ========== Storage: total + per-session logs */
  const fmt = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  const TOTAL_KEY = "study_minutes_total";
  const SESSIONS_KEY = "study_sessions"; // array of {ts, minutes}

  const getTotal = () => Number(localStorage.getItem(TOTAL_KEY) || "0");
  const setTotal = (m) => localStorage.setItem(TOTAL_KEY, String(m));
  const getSessions = () => {
    try {
      return JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]");
    } catch {
      return [];
    }
  };
  const addSession = (minutes) => {
    const sessions = getSessions();
    sessions.push({ ts: new Date().toISOString(), minutes });
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  };

  const renderTotal = () => {
    const t = getTotal();
    totalEl.textContent = t ? `Total studied: ${t} min` : "";
  };
  renderTotal();

  /* ========== Floating tomato timer */
  let state = "idle",
    tick = null,
    startTs = 0,
    endTs = 0,
    remainingMs = 0,
    pausedAccum = 0,
    lastPauseTs = 0;

  // open/close small sheet
  const openSheet = (open) => {
    const isOpen = open ?? !sheet.classList.contains("open");
    sheet.classList.toggle("open", isOpen);
    tomatoBtn.setAttribute("aria-expanded", String(isOpen));
    sheet.setAttribute("aria-hidden", String(!isOpen));
  };
  tomatoBtn?.addEventListener("click", () => openSheet());
  hotspot?.addEventListener("click", () => openSheet(true));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") openSheet(false);
  });

  // vanish helpers (tomato icon + ENTIRE sheet)
  const setTomatoVanish = (on) => tomatoBtn?.classList.toggle("vanish", !!on);
  const setSheetVanish = (on) => sheet?.classList.toggle("vanish", !!on);

  // Beep
  const beep = (dur = 220, freq = 880, type = "triangle") => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.value = 0.06;
      o.start();
      setTimeout(() => {
        o.stop();
        ctx.close();
      }, dur);
    } catch {}
  };

  const renderTick = () => {
    const ms = Math.max(0, endTs - Date.now());
    // still updates even if invisible
    timeEl.textContent = fmt(ms);
    if (ms <= 0) finishAuto();
  };

  const doStart = () => {
    const mins = Math.max(1, Math.min(60, parseInt(durEl.value, 10) || 25));
    if (state === "idle" || state === "finished") {
      pausedAccum = 0;
      startTs = Date.now();
      endTs = startTs + mins * 60_000;
    } else if (state === "paused") {
      const now = Date.now();
      pausedAccum += now - lastPauseTs;
      endTs = now + remainingMs;
      startTs = now;
    }
    clearInterval(tick);
    tick = setInterval(renderTick, 250);
    state = "running";
    status.textContent = "Running…";

    // Hide both the tomato icon and the whole box while running
    setTomatoVanish(true);
    setSheetVanish(true);

    renderTick();
  };

  const doPause = () => {
    if (state !== "running") return;
    clearInterval(tick);
    remainingMs = Math.max(0, endTs - Date.now());
    lastPauseTs = Date.now();
    state = "paused";
    status.textContent = "Paused";

    // Show UI again
    setTomatoVanish(false);
    setSheetVanish(false);
  };

  const doReset = () => {
    clearInterval(tick);
    state = "idle";
    remainingMs = 0;
    pausedAccum = 0;
    timeEl.textContent = fmt((parseInt(durEl.value, 10) || 25) * 60_000);
    status.textContent = "Ready";

    setTomatoVanish(false);
    setSheetVanish(false);
  };

  const persistMinutes = (mins) => {
    if (mins > 0) {
      setTotal(getTotal() + mins);
      addSession(mins); // per-session record
      renderTotal();
    }
  };

  const doFinishManual = () => {
    if (state === "idle") return;
    clearInterval(tick);
    const now = Date.now();
    const elapsed =
      state === "paused"
        ? Math.max(0, lastPauseTs - startTs - pausedAccum)
        : Math.max(0, now - startTs - pausedAccum);
    const mins = Math.max(0, Math.round(elapsed / 60000));
    persistMinutes(mins); // auto save
    state = "finished";
    status.textContent = `Finished +${mins} min`;

    setTomatoVanish(false);
    setSheetVanish(false);
  };

  const finishAuto = () => {
    clearInterval(tick);
    state = "finished";
    const planned = Math.max(0, endTs - startTs);
    const mins = Math.max(0, Math.round(Math.max(0, planned - pausedAccum) / 60000));
    persistMinutes(mins); // auto save
    timeEl.textContent = "00:00";
    status.textContent = `Pomodoro complete +${mins} min`;

    setTomatoVanish(false);
    setSheetVanish(false);
    beep();
  };

  // Wire controls
  start?.addEventListener("click", doStart);
  pause?.addEventListener("click", doPause);
  reset?.addEventListener("click", doReset);
  finish?.addEventListener("click", doFinishManual);

  // Init time
  timeEl.textContent = fmt((parseInt(durEl.value, 10) || 25) * 60_000);

  // Update preview on duration change (idle/finished only)
  durEl?.addEventListener("change", () => {
    const v = Math.max(1, Math.min(60, parseInt(durEl.value, 10) || 25));
    durEl.value = String(v);
    if (state === "idle" || state === "finished") {
      timeEl.textContent = fmt(v * 60_000);
    }
  });

  // Pause if tab hidden
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) doPause();
  });

  /* ========== Desktop nicety: reveal/hide UI on hover while running ========== */
  const revealWhileRunning = () => {
    if (state === "running") {
      setTomatoVanish(false);
      setSheetVanish(false);
    }
  };
  const hideWhileRunning = () => {
    if (state === "running") {
      setTomatoVanish(true);
      setSheetVanish(true);
    }
  };
  hotspot?.addEventListener("mouseenter", revealWhileRunning);
  hotspot?.addEventListener("mouseleave", hideWhileRunning);
  sheet?.addEventListener("mouseleave", hideWhileRunning);

  /* ========== Menu actions: Come back / Sign out ========== */
  menuComeback?.addEventListener("click", () => {
    // local "resume"
    localStorage.removeItem("signed_out");
    document.body.classList.remove("signed-out");
    drawer?.classList.remove("open");

    // optional navigate only if you configured a URL
    const url = window.APP_CONFIG.COMEBACK_URL;
    if (url) window.location.href = url;
  });

  // Sign out WITHOUT redirect (keeps study data)
  menuSignout?.addEventListener("click", async () => {
    try {
      if (window.supabase?.auth?.signOut) {
        await window.supabase.auth.signOut();
      } else if (window.firebase?.auth) {
        await window.firebase.auth().signOut();
      } else if (window.auth?.signOut) {
        await window.auth.signOut(); // your custom auth, if any
      }
    } catch (e) {
      console.error("Provider signOut failed (continuing local sign out):", e);
    }

    localStorage.setItem("signed_out", "1");
    drawer?.classList.remove("open");
    sheet?.classList.remove("open");
    document.body.classList.add("signed-out");

    alert("Signed out. Your study history stays on this device.");
  });
});
