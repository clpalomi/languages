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

  const contentEl = document.querySelector("#reader-content");

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

    // ▼ position drawer under the hamburger (desktop only)
    if (isOpen && window.matchMedia("(min-width: 480px)").matches) {
      const r = menuBtn.getBoundingClientRect();
      const top = Math.round(r.bottom + window.scrollY);
      const left = Math.round(r.left + window.scrollX);

      Object.assign(drawer.style, {
        position: "fixed",
        top: `${top}px`,
        left: `${left}px`,
        maxWidth: "90vw",
        minWidth: "220px",
        zIndex: 1000
      });
    } else {
      drawer.style.position = "";
      drawer.style.top = "";
      drawer.style.left = "";
      drawer.style.maxWidth = "";
      drawer.style.minWidth = "";
      drawer.style.zIndex = "";
    }
  };

  window.addEventListener("resize", () => {
    if (drawer.classList.contains("open")) toggleDrawer(true);
  });
  menuBtn?.addEventListener("click", () => toggleDrawer());

  /* ========== JSON-only lesson loader (UPDATED) ========== */
  const resolveBase = (base) => {
    const u = new URL(base || ".", document.baseURI);
    if (!u.pathname.endsWith("/")) u.pathname += "/";
    return u.href;
  };

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${url} (${res.status})`);
    return res.json();
  }

  async function loadLessonJSON(base) {
    const abs = resolveBase(base);
    const data = await fetchJSON(abs + "content.json"); // required
    return { data }; // no meta files
  }

  /* ========= Translation toggle ========= */
  function TranslationToggle() {
    let visible = false;
    const btn = document.createElement("button");
    btn.className = "btn btn-ghost";
    btn.type = "button";
    btn.textContent = "Show Translation";
    btn.addEventListener("click", () => {
      visible = !visible;
      document.querySelectorAll("[data-translation]").forEach((el) => {
        el.style.display = visible ? "" : "none";
      });
      btn.textContent = visible ? "Hide Translation" : "Show Translation";
    });
    return btn;
  }

  /* ========== Title/meta bar helper (uses only data.meta if present) ========== */
  function setBars({ title, language, level }) {
    if (titleEl) titleEl.textContent = title || "";
    if (metaEl) {
      const parts = [];
      if (language) parts.push(language);
      if (level) parts.push(`Level ${level}`);
      metaEl.textContent = parts.join(" • ");
    }
  }

  /* ========== JSON renderer (supports pairs OR paragraphs) ========== */
  /*
    Shape A (recommended):
    {
      "title":"Lekcja 1 — Czytanie",
      "meta":{"language":"Polish","level":"A1"},
      "pairs":[{"pl":"…","en":"…"}, ...]
    }

    Shape B:
    {
      "title":"Lekcja 1 — Czytanie",
      "meta":{"language":"Polish","level":"A1"},
      "paragraphs":[ "...", "...", ... ],
      "translation_paragraphs":[ "...", "...", ... ] // optional
    }
  */
  function renderLessonJSON({ data }) {
    if (!contentEl) {
      console.error("#reader-content missing");
      return;
    }

    setBars({
      title: data.title,
      language: data.meta?.language,
      level: data.meta?.level
    });

    const wrap = document.createElement("div");
    wrap.className = "lesson-wrap";

    const controls = document.createElement("div");
    controls.className = "lesson-controls";

    // A) Parallel pairs
    if (Array.isArray(data.pairs) && data.pairs.length) {
      const plBlock = document.createElement("div");
      const enBlock = document.createElement("div");
      plBlock.className = "lesson-block pl";
      enBlock.className = "lesson-block en";

      const plP = document.createElement("p");
      const enP = document.createElement("p");

      plP.innerHTML = data.pairs.map((x) => x.pl).join("<br>");
      enP.innerHTML = data.pairs.map((x) => x.en).join("<br>");
      enP.setAttribute("data-translation", "");
      enP.style.display = "none";

      plBlock.appendChild(plP);
      enBlock.appendChild(enP);

      controls.appendChild(TranslationToggle());
      wrap.appendChild(controls);
      wrap.appendChild(plBlock);
      wrap.appendChild(enBlock);

    // B) Plain paragraphs (+ optional translation)
    } else if (Array.isArray(data.paragraphs)) {
      const plBlock = document.createElement("div");
      plBlock.className = "lesson-block pl";
      const plP = document.createElement("p");
      plP.innerHTML = data.paragraphs.join("<br>");
      plBlock.appendChild(plP);
      wrap.appendChild(plBlock);

      if (Array.isArray(data.translation_paragraphs) && data.translation_paragraphs.length) {
        const enBlock = document.createElement("div");
        enBlock.className = "lesson-block en";
        const enP = document.createElement("p");
        enP.innerHTML = data.translation_paragraphs.join("<br>");
        enP.setAttribute("data-translation", "");
        enP.style.display = "none";
        enBlock.appendChild(enP);

        controls.appendChild(TranslationToggle());
        wrap.prepend(controls);
        wrap.appendChild(enBlock);
      }

    } else {
      // Unknown shape → dev hint
      const pre = document.createElement("pre");
      pre.textContent = "Unsupported content.json shape.\nExpected keys: pairs[] or paragraphs[].";
      wrap.appendChild(pre);
    }

    contentEl.innerHTML = "";
    contentEl.appendChild(wrap);
  }

  /* ========== Wire up lesson buttons (await + render + in-page errors) ========== */
  lessons.forEach((btn) => {
    if (btn.disabled) return;
    btn.addEventListener("click", async () => {
      const base = btn.getAttribute("data-base");
      if (!base) {
        (window.uiPanic ? uiPanic : console.error)("lesson button missing data-base");
        return;
      }
      try {
        if (contentEl) contentEl.textContent = "Loading lesson…";
        const lesson = await loadLessonJSON(base);
        renderLessonJSON(lesson);

        // Close drawer after selecting a lesson
        drawer?.classList.remove("open");
      } catch (e) {
        console.error(e);
        if (contentEl) {
          contentEl.innerHTML = `
            <div class="error" role="alert" style="padding:12px;border:1px solid var(--border);border-radius:8px;">
              <strong>Couldn’t load lesson.</strong><br>
              I expected <code>content.json</code> in <code>${base}</code>.<br>
              ${e?.message ? String(e.message) : ""}
            </div>`;
        }
      }
    });
  });

  /* ========== Storage: total + per-session logs ========== */
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

  /* ========== Floating tomato timer ========== */
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

  const readDur = () => {
    const n = parseInt(durEl.value, 10);
    return Math.max(1, Math.min(60, Number.isFinite(n) ? n : 25));
  };

  const doStart = () => {
    const mins = readDur();
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
    timeEl.textContent = fmt(readDur() * 60_000);
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
  timeEl.textContent = fmt(readDur() * 60_000);

  // Update preview on duration change (idle/finished only)
  durEl?.addEventListener("change", () => {
    const v = readDur();
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
