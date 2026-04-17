import { supabase } from "./client.js";

// Safe defaults so missing config never throws
window.APP_CONFIG = Object.assign(
  {
    // Set this to navigate somewhere when the user clicks "Come back".
    // Leave as "" to stay on the same page.
    COMEBACK_URL: "",
  },
  window.APP_CONFIG || {}
);

// Minimal session logic: lessons drawer + private lesson loader
document.addEventListener("DOMContentLoaded", () => {
  /* ========== Elements */
  const menuBtn = document.querySelector("#menu-btn");
  const drawer = document.querySelector("#lesson-drawer");
  const lessonsList = document.querySelector("#lessons-list");
  const pageEl = document.querySelector("#reader-page");
  const titleEl = document.querySelector("#reader-heading");
  const metaEl = document.querySelector("#reader-meta");

  const contentEl = document.querySelector("#reader-content");
  const statusEl = document.querySelector("#private-session-status");
  const modeNewBtn = document.querySelector("#mode-new-language");
  const modeExistingBtn = document.querySelector("#mode-existing-language");
  const newPanel = document.querySelector("#panel-new-language");
  const existingPanel = document.querySelector("#panel-existing-language");
  const newLanguageNameEl = document.querySelector("#new-language-name");
  const newLanguageTextEl = document.querySelector("#new-language-text");
  const existingLanguageSelectEl = document.querySelector("#existing-language-select");
  const existingLanguageTextEl = document.querySelector("#existing-language-text");
  const loadNewMaterialNewBtn = document.querySelector("#load-new-material-new");
  const loadNewMaterialExistingBtn = document.querySelector("#load-new-material-existing");
  const startExistingLessonBtn = document.querySelector("#start-existing-lesson");

  // Menu auth actions (inside drawer)
  const menuComeback = document.querySelector("#menu-comeback");
  const menuSignout = document.querySelector("#menu-signout");
  const MAX_INGEST_WORDS = 1200;
  let currentUser = null;
  let userLanguages = [];

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

  const setStatus = (message) => {
    if (statusEl) statusEl.textContent = message;
  };

  function openMode(mode) {
    const isNew = mode === "new";
    newPanel.style.display = isNew ? "block" : "none";
    existingPanel.style.display = isNew ? "none" : "block";
  }

  modeNewBtn?.addEventListener("click", () => openMode("new"));
  modeExistingBtn?.addEventListener("click", () => openMode("existing"));

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
    lessonsList?.addEventListener("click", async (event) => {
    const btn = event.target.closest(".lesson");
    if (!btn || btn.disabled) return;
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

  function countWords(text) {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  async function callMultilingualIngest(payload) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const endpoint = `${supabase.supabaseUrl}/functions/v1/multilingual-ingest`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`multilingual-ingest failed (${response.status})`);
    }
    return response.json();
  }

  async function ensureUserLanguage(languageName) {
    const normalized = languageName.trim();
    const { data, error } = await supabase
      .from("user_languages")
      .upsert(
        [{ user_id: currentUser.id, language_name: normalized }],
        { onConflict: "user_id,language_name" }
      )
      .select("id, language_name")
      .single();
    if (error) throw error;
    return data;
  }

  async function loadUserLanguages() {
    const { data, error } = await supabase
      .from("user_languages")
      .select("id, language_name")
      .eq("user_id", currentUser.id)
      .order("language_name", { ascending: true });
    if (error) throw error;
    userLanguages = data || [];
    existingLanguageSelectEl.innerHTML = `<option value="">Select a language</option>` +
      userLanguages.map((row) => `<option value="${row.id}">${row.language_name}</option>`).join("");
  }

  async function ingestMaterialForLanguage(languageRow, sourceText) {
    const trimmed = (sourceText || "").trim();
    const wordCount = countWords(trimmed);
    if (!trimmed) throw new Error("Please provide text to load.");
    if (wordCount > MAX_INGEST_WORDS) {
      throw new Error(`Text too long: ${wordCount} words. Limit is ${MAX_INGEST_WORDS}.`);
    }

    const { data: material, error: materialError } = await supabase
      .from("language_materials")
      .insert([{
        user_id: currentUser.id,
        user_language_id: languageRow.id,
        source_text: trimmed,
        source_word_count: wordCount,
      }])
      .select("id")
      .single();
    if (materialError) throw materialError;

    const ingestResult = await callMultilingualIngest({
      material_id: material.id,
      language_name: languageRow.language_name,
      source_text: trimmed,
    });

    setStatus(
      `Material loaded (${wordCount} words). Saved ${ingestResult.sentences_saved ?? 0} sentences and ${ingestResult.words_saved ?? 0} words.`
    );
  }

  async function startLessonForLanguage(languageId) {
    const { data, error } = await supabase
      .from("language_lessons")
      .select("id, title, content_json")
      .eq("user_id", currentUser.id)
      .eq("user_language_id", languageId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) throw error;
    if (!data?.length) {
      setStatus("No generated lesson yet for this language. Load material first.");
      return;
    }
    renderLessonJSON({ data: data[0].content_json });
    setBars({ title: data[0].title || "Generated lesson", language: "", level: "" });
  }

  async function renderUserLessonButtons() {
    const existing = lessonsList.querySelectorAll(".lesson[data-user-lesson='1']");
    existing.forEach((node) => node.remove());
    if (!userLanguages.length) return;

    const separator = lessonsList.querySelector(".sep");
    userLanguages.forEach((lang) => {
      const btn = document.createElement("button");
      btn.className = "lesson";
      btn.dataset.userLesson = "1";
      btn.type = "button";
      btn.textContent = `${lang.language_name} (latest lesson)`;
      btn.addEventListener("click", async () => {
        try {
          await startLessonForLanguage(lang.id);
          drawer?.classList.remove("open");
        } catch (error) {
          setStatus(`Failed to start lesson: ${error.message}`);      
        }
      });
      lessonsList.insertBefore(btn, separator || null);
    });
      }

  loadNewMaterialNewBtn?.addEventListener("click", async () => {
    try {
      setStatus("Saving language and loading material…");
      const languageName = (newLanguageNameEl.value || "").trim();
      if (!languageName) throw new Error("Please add a language name.");
      const language = await ensureUserLanguage(languageName);
      await ingestMaterialForLanguage(language, newLanguageTextEl.value);
      await loadUserLanguages();
      await renderUserLessonButtons();
      newLanguageTextEl.value = "";
      openMode("existing");
      existingLanguageSelectEl.value = language.id;
    } catch (error) {
      setStatus(error.message || "Failed to load material.");
    }
  });

  loadNewMaterialExistingBtn?.addEventListener("click", async () => {
    try {
      setStatus("Loading material…");
      const selected = existingLanguageSelectEl.value;
      if (!selected) throw new Error("Select an existing language.");
      const language = userLanguages.find((item) => String(item.id) === String(selected));
      if (!language) throw new Error("Selected language was not found.");
      await ingestMaterialForLanguage(language, existingLanguageTextEl.value);
      existingLanguageTextEl.value = "";
      await renderUserLessonButtons();
    } catch (error) {
      setStatus(error.message || "Failed to load material.");
    }
  });

  startExistingLessonBtn?.addEventListener("click", async () => {
    try {
      const selected = existingLanguageSelectEl.value;
      if (!selected) throw new Error("Select an existing language.");
      await startLessonForLanguage(selected);
      setStatus("Lesson loaded.");
    } catch (error) {
      setStatus(error.message || "Could not start lesson.");
    }
  });

  async function initPrivateSession() {
    const { data: sessionData } = await supabase.auth.getSession();
    currentUser = sessionData?.session?.user || null;
    if (!currentUser) {
      setStatus("Please sign in to manage private sessions.");
      modeNewBtn.disabled = true;
      modeExistingBtn.disabled = true;
      return;
    }
    await loadUserLanguages();
    await renderUserLessonButtons();
    openMode("new");
    setStatus("Choose a flow and load material.");
  }

  initPrivateSession().catch((error) => {
    console.error(error);
    setStatus(`Could not initialize private sessions: ${error.message}`);
  });

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
    document.body.classList.add("signed-out");

    alert("Signed out. Your study history stays on this device.");
  });
});
