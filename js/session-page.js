import { supabase } from "./client.js";

window.APP_CONFIG = Object.assign({ COMEBACK_URL: "./app.html" }, window.APP_CONFIG || {});

document.addEventListener("DOMContentLoaded", () => {
  const menuBtn = document.querySelector("#menu-btn");
  const drawer = document.querySelector("#lesson-drawer");
  const lessonsList = document.querySelector("#lessons-list");
  const titleEl = document.querySelector("#reader-heading");
  const metaEl = document.querySelector("#reader-meta");
  const contentEl = document.querySelector("#reader-content");
  const statusEl = document.querySelector("#private-session-status");
  const modeNewBtn = document.querySelector("#mode-new-language");
  const modeExistingBtn = document.querySelector("#mode-existing-language");
  const newPanel = document.querySelector("#panel-new-language");
  const existingPanel = document.querySelector("#panel-existing-language");
  const newLanguageNameEl = document.querySelector("#new-language-name");
  const existingLanguageSelectEl = document.querySelector("#existing-language-select");
  const materialTitleEl = document.querySelector("#material-title");
  const translationLanguageEl = document.querySelector("#translation-language");
  const materialTypeEl = document.querySelector("#material-type");
  const materialTextEl = document.querySelector("#material-text");
  const loadMaterialBtn = document.querySelector("#load-material");
  const startExistingLessonBtn = document.querySelector("#start-existing-lesson");
  const wordSelectionEl = document.querySelector("#word-selection");
  const wordSelectionListEl = document.querySelector("#word-selection-list");
  const wordCountEl = document.querySelector("#practice-word-count");
  const remainingEl = document.querySelector("#practice-remaining");
  const clearWordsBtn = document.querySelector("#clear-words");
  const generateSessionBtn = document.querySelector("#generate-session");
  const menuComeback = document.querySelector("#menu-comeback");
  const menuSignout = document.querySelector("#menu-signout");
  const tokenCountEl = document.querySelector("#session-token-count");
  
  const MAX_INGEST_WORDS = 1200;
  const MAX_PRACTICE_WORDS = 5;
  let currentUser = null;
  let userLanguages = [];
  let wordTranslations = new Map();
  let wordMetadata = new Map();
  let activeBubble = null;
  let activeBubbleToken = null;
  let sessionTokensSpent = 0;
  let generating = false;
  let materialRevision = 0;
  let remainingAttempts = null;
  let currentTranslationLanguage = "English";
  let currentLanguageId = null;
  let currentLanguageName = "";
  
  const controls = [modeNewBtn, modeExistingBtn, newLanguageNameEl, existingLanguageSelectEl, materialTitleEl, translationLanguageEl, materialTypeEl, materialTextEl, loadMaterialBtn, startExistingLessonBtn, clearWordsBtn, generateSessionBtn];

  const setStatus = (message) => { if (statusEl) statusEl.textContent = message; };
  const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const normalizeWord = (value) => String(value ?? "").toLocaleLowerCase().normalize("NFKC").replace(/^\p{P}+|\p{P}+$/gu, "");
  const countWords = (text) => (text || "").trim().split(/\s+/).filter(Boolean).length;

  function addTokenUsage(usage) {
    const spent = Number(usage?.total_tokens || 0);
    if (!Number.isFinite(spent) || spent <= 0) return;
    sessionTokensSpent += spent;
    if (tokenCountEl) tokenCountEl.textContent = sessionTokensSpent.toLocaleString();
  }
  
  function toggleDrawer(open) {
    const isOpen = open ?? !drawer.classList.contains("open");
    drawer?.classList.toggle("open", isOpen);
    menuBtn?.setAttribute("aria-expanded", String(isOpen));
  }
  menuBtn?.addEventListener("click", () => toggleDrawer());

  function setPrivateSessionControlsDisabled(disabled) {
    controls.forEach((control) => { if (control) control.disabled = !!disabled; });
  }

  async function currentUserCanUsePrivateSession() {
    const email = (currentUser?.email || "").trim();
    if (!email) return false;
    const { data, error } = await supabase.from("private_session_access").select("id").eq("email", email).eq("active", true).limit(1);
    if (error) throw error;
    return (data || []).length > 0;
  }

  function openMode(mode) {
    const isNew = mode === "new";
    newPanel.hidden = !isNew;
    existingPanel.hidden = isNew;
    modeNewBtn?.classList.toggle("active", isNew);
    modeNewBtn?.setAttribute("aria-pressed", String(isNew));
    modeExistingBtn?.setAttribute("aria-pressed", String(!isNew));
    modeExistingBtn?.classList.toggle("active", !isNew);
  }
  modeNewBtn?.addEventListener("click", () => openMode("new"));
  modeExistingBtn?.addEventListener("click", () => openMode("existing"));

  function setBars({ title, language, level }) {
    if (titleEl) titleEl.textContent = title || "Study material";
    if (metaEl) metaEl.textContent = [language, level].filter(Boolean).join(" • ") || "Private lesson";
  }

  function parseMaterial(text) {
    const lines = (text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const pairs = [];
    for (const line of lines) {
      const parts = line.split(/\s*(?:\||\t|=>|—| - )\s*/).filter(Boolean);
      if (parts.length >= 2) pairs.push({ source: parts[0].trim(), translation: parts.slice(1).join(" - ").trim() });
      else pairs.push({ source: line, translation: "" });
    }
    return pairs;
  }

  function tokenize(text) {
    return String(text || "").split(/(\s+)/).map((part) => {
      if (/^\s+$/.test(part)) return part;
      const normalized = normalizeWord(part);
      if (!normalized) return escapeHtml(part);
      return `<span class="word-token" role="button" tabindex="0" data-word="${escapeHtml(normalized)}">${escapeHtml(part)}</span>`;
    }).join("");
  }

  function renderStudyMaterial({ title, language, translationLanguage, items, words = [] }) {
    materialRevision += 1;
    wordTranslations = new Map();
    wordMetadata = new Map();
    words.forEach((word) => {
      const key = normalizeWord(word.normalized_word || word.source_word);
      if (!key) return;
      if (word.translation_text || word.english_text) wordTranslations.set(key, word.translation_text || word.english_text);
      wordMetadata.set(key, word);
    });
    closeTransientBubble();
    currentTranslationLanguage = translationLanguage || "English";
    setBars({ title, language, level: `translation: ${translationLanguage || "English"}` });
    contentEl.innerHTML = `<div class="study-reader">${items.map((item, index) => `
      <section class="study-line">
        <div class="line-number">${index + 1}</div>
        <p>${tokenize(item.source)}</p>
        ${item.translation ? `<p class="translation-line"><strong>Translation:</strong> ${escapeHtml(item.translation)}</p>` : ""}
      </section>`).join("")}</div>`;
  }

  function closeTransientBubble() {
    activeBubble?.remove();
    activeBubble = null;
    activeBubbleToken = null;
  }

  function showBubble(token) {
    if (activeBubbleToken === token && activeBubble) return;
    closeTransientBubble();
    const word = token.dataset.word;
    const translation = wordTranslations.get(word) || "Translation not loaded yet.";
    const bubble = document.createElement("div");
    bubble.className = "word-bubble";
    const meta = wordMetadata.get(word) || {};
    const actions = [];
    if (meta.part_of_speech === "verb" || meta.conjugation_table) actions.push(`<button type="button" data-kind="verb">Conjugation</button>`);
    if (["noun", "pronoun", "adjective"].includes(meta.part_of_speech) || meta.declension_table) actions.push(`<button type="button" data-kind="noun">Declension</button>`);
    bubble.innerHTML = `<strong>${escapeHtml(token.textContent)}</strong><span>${escapeHtml(translation)}</span>${actions.length ? `<div class="bubble-actions">${actions.join("")}</div>` : ""}`;
    token.appendChild(bubble);
    activeBubble = bubble;
    activeBubbleToken = token;
  }

  function showGrammarBox(button) {
    const token = button.closest(".word-token");
    const word = token?.dataset.word || normalizeWord(token?.textContent || "word");
    const meta = wordMetadata.get(word) || {};
    const isVerb = button.dataset.kind === "verb";
    const details = isVerb ? meta.conjugation_table : meta.declension_table;
    document.querySelectorAll(".grammar-box").forEach((node) => node.remove());
    const box = document.createElement("div");
    box.className = "grammar-box";
    const heading = isVerb ? "Conjugation" : "Declension / forms";
    const fallback = `${heading} details are not available yet. Generate a study session to enrich this word.`;
    box.innerHTML = `<button type="button" class="grammar-close" aria-label="Close grammar details">×</button><strong>${escapeHtml(heading)} for ${escapeHtml(token?.textContent || word)}</strong><pre>${escapeHtml(details || fallback)}</pre>`;
    token?.appendChild(box);
    closeTransientBubble();
  }

  contentEl?.addEventListener("pointerover", (event) => {
    const token = event.target.closest(".word-token");
    if (token) showBubble(token);
  });
  contentEl?.addEventListener("pointerout", (event) => {
    if (!activeBubbleToken) return;
    const next = event.relatedTarget;
    if (next?.closest?.(".word-token") === activeBubbleToken || next?.closest?.(".word-bubble")) return;
    if (event.target.closest(".study-line") && !next?.closest?.(".study-line")) closeTransientBubble();
  });
  contentEl?.addEventListener("click", (event) => {
    const close = event.target.closest(".grammar-close");
    if (close) { close.closest(".grammar-box")?.remove(); return; }
    const grammar = event.target.closest("[data-kind]");
    if (grammar) { event.preventDefault(); event.stopPropagation(); showGrammarBox(grammar); return; }
    const word = event.target.closest(".word-token");
    if (word) showBubble(word);
  });
  contentEl.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTransientBubble();
    if (event.target.matches(".word-token") && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      showBubble(event.target);
    }
  });

  function renderPractice({ title, grammar, translationLanguage, items, words }, language) {
    closeTransientBubble();
    setBars({ title, language, level: `Practice in ${language} and ${translationLanguage}` });
    const [example, ...exercises] = items;
    contentEl.innerHTML = `
      <section class="practice-prep" aria-labelledby="grammar-heading">
        <h3 id="grammar-heading">Grammar focus</h3>
        <p>${escapeHtml(grammar)}</p>
        <h3>Focus words</h3>
        <dl class="focus-words">${words.map((word) => `
          <div><dt>${escapeHtml(word.source_word)}</dt><dd>${escapeHtml(word.translation_text)}</dd></div>`).join("")}</dl>
        <h3>Worked example</h3>
        <p><strong>${escapeHtml(example.source)}</strong><br>${escapeHtml(example.translation)}</p>
      </section>
      <section class="practice-exercises" aria-labelledby="practice-heading">
        <h3 id="practice-heading">Your turn</h3>
        <p class="muted">Write your answer, then reveal an example to compare. Other answers may also be correct.</p>
        <ol class="practice-list">${exercises.map((item, index) => {
          const production = index % 2 === 1;
          const target = production ? language : translationLanguage;
          const prompt = production ? item.translation : item.source;
          const answer = production ? item.source : item.translation;
          return `<li class="practice-exercise">
            <h4>${production ? "Write" : "Translate"} in ${escapeHtml(target)}</h4>
            <p id="practice-prompt-${index}">${escapeHtml(prompt)}</p>
            <label for="practice-answer-${index}">Your answer</label>
            <textarea id="practice-answer-${index}" rows="2" aria-describedby="practice-prompt-${index}"></textarea>
            <details><summary>Reveal example answer</summary><p>${escapeHtml(answer)}</p></details>
          </li>`;
        }).join("")}</ol>
      </section>`;
    titleEl.focus();
  }

  function updatePracticeControls() {
    const count = selectedWords().length;
    wordCountEl.textContent = `${count} of ${MAX_PRACTICE_WORDS} selected`;
    wordSelectionListEl.querySelectorAll("input").forEach((input) => {
      input.disabled = generating || (!input.checked && count >= MAX_PRACTICE_WORDS);
    });
    clearWordsBtn.disabled = generating || count === 0;
    generateSessionBtn.disabled = generating;
    generateSessionBtn.textContent = generating ? "Generating…" : "Generate practice";
    if (remainingAttempts !== null) remainingEl.textContent = `${remainingAttempts} of 5 attempts remaining today (UTC)`;
  }

  async function ensureUserLanguage(languageName) {
    const normalized = languageName.trim();
    if (!normalized) throw new Error("Enter a language name first.");
    const { data, error } = await supabase.from("user_languages").upsert([{ user_id: currentUser.id, language_name: normalized }], { onConflict: "user_id,language_name" }).select("id, language_name").single();
    if (error) throw error;
    return data;
  }

  async function loadUserLanguages() {
    const { data, error } = await supabase.from("user_languages").select("id, language_name").eq("user_id", currentUser.id).order("language_name", { ascending: true });
    if (error) throw error;
    userLanguages = data || [];
    existingLanguageSelectEl.innerHTML = `<option value="">Select a language</option>` + userLanguages.map((row) => `<option value="${row.id}">${escapeHtml(row.language_name)}</option>`).join("");
  }

  async function loadWordsForSelection(languageId) {
    const { data, error } = await supabase.from("material_words").select("id, source_word, normalized_word, translation_text, english_text, part_of_speech, conjugation_table, declension_table, frequency").eq("user_id", currentUser.id).eq("user_language_id", languageId).order("source_word", { ascending: true });
    if (error) throw error;
    if (!wordSelectionListEl) return data || [];
    const unique = new Map();
    for (const row of data || []) {
      if (row.normalized_word?.length <= 128 && row.source_word?.length <= 128 && !unique.has(row.normalized_word)) {
        unique.set(row.normalized_word, row);
      }
    }
    wordSelectionListEl.innerHTML = [...unique.values()].map((row) => `<label class="word-choice"><input type="checkbox" value="${escapeHtml(row.normalized_word)}"><span>${escapeHtml(row.source_word)}</span><small>${escapeHtml(row.translation_text || row.english_text || "")}</small></label>`).join("");
    wordSelectionEl.hidden = unique.size === 0;
    updatePracticeControls();
    return data || [];
  }

  function selectedWords() {
    return [...(wordSelectionListEl?.querySelectorAll("input:checked") || [])].map((input) => input.value);
  }

  async function generateStudySession() {
    if (generating) return;
    if (!currentLanguageId) throw new Error("Select or load a language first.");
    const languageId = currentLanguageId;
    const revision = materialRevision;
    const language = currentLanguageName;
    const translationLanguage = currentTranslationLanguage;
    generating = true;
    updatePracticeControls();
    setStatus("Generating sentence practice…");
    try {
      const { data, error } = await supabase.functions.invoke("generate-study-session", {
        body: { userLanguageId: languageId, selectedWords: selectedWords(), translationLanguage },
      });
      if (error) {
        const response = error.context;
        const problem = response instanceof Response ? await response.json().catch(() => null) : null;
        if (Number.isInteger(problem?.remaining)) remainingAttempts = problem.remaining;
        addTokenUsage(problem?.usage);
        throw new Error(problem?.error || "Could not generate practice. Try again later.");
      }
      if (Number.isInteger(data.remaining)) remainingAttempts = data.remaining;
      addTokenUsage(data.usage);
      if (!data.grammar) throw new Error("This version of sentence practice requires an updated study-session service.");
      if (revision !== materialRevision || languageId !== currentLanguageId) return;
      renderPractice(data, language);
      setStatus("Practice ready. Review the example, then try four sentences.");
    } finally {
      generating = false;
      updatePracticeControls();
    }
  }

  async function loadLatestMaterial(languageId) {
    const { data: materials, error } = await supabase.from("language_materials").select("id, title, material_type, translation_language, user_language_id, user_languages(language_name)").eq("user_id", currentUser.id).eq("user_language_id", languageId).order("created_at", { ascending: false }).limit(1);
    if (error) throw error;
    if (!materials?.length) throw new Error("No material yet for this language. Load words, sentences, or a story first.");
    const material = materials[0];
    currentLanguageId = languageId; currentLanguageName = material.user_languages?.language_name || "";
    const { data: sentences, error: sentenceError } = await supabase.from("material_sentences").select("source_text, translation_text, position").eq("material_id", material.id).order("position", { ascending: true });
    if (sentenceError) throw sentenceError;
    const { data: words, error: wordError } = await supabase.from("material_words").select("id, source_word, normalized_word, translation_text, english_text, part_of_speech, conjugation_table, declension_table, frequency").eq("material_id", material.id);
    if (wordError) throw wordError;
    const items = sentences?.length ? sentences.map((row) => ({ source: row.source_text, translation: row.translation_text || "" })) : (words || []).map((row) => ({ source: row.source_word, translation: row.translation_text || "" }));
    renderStudyMaterial({ title: material.title || "Latest private lesson", language: material.user_languages?.language_name || "", translationLanguage: material.translation_language, items, words });
    await loadWordsForSelection(languageId);
  }

  async function ingestMaterialForLanguage(languageRow) {
    const raw = (materialTextEl.value || "").trim();
    if (!raw) throw new Error("Paste material to load.");
    const wordCount = countWords(raw);
    if (wordCount > MAX_INGEST_WORDS) throw new Error(`Text too long: ${wordCount} words. Limit is ${MAX_INGEST_WORDS}.`);
    const items = parseMaterial(raw);
    const { data: material, error: materialError } = await supabase.from("language_materials").insert([{ user_id: currentUser.id, user_language_id: languageRow.id, title: (materialTitleEl.value || "").trim() || "Private lesson", material_type: materialTypeEl.value, translation_language: (translationLanguageEl.value || "English").trim(), source_text: raw, source_word_count: wordCount }]).select("id").single();
    if (materialError) throw materialError;
    const sentenceRows = items.map((item, position) => ({ user_id: currentUser.id, material_id: material.id, position, source_text: item.source, translation_text: item.translation || null }));
    if (sentenceRows.length) { const { error } = await supabase.from("material_sentences").insert(sentenceRows); if (error) throw error; }
    const wordMap = new Map();
    items.forEach((item) => String(item.source).split(/\s+/).forEach((word) => { const n = normalizeWord(word); if (!n) return; const existing = wordMap.get(n) || { source_word: word.replace(/^\p{P}+|\p{P}+$/gu, ""), translation_text: item.translation || null, frequency: 0 }; existing.frequency += 1; wordMap.set(n, existing); }));
    const wordRows = [...wordMap.entries()].map(([normalized_word, row]) => ({ user_id: currentUser.id, user_language_id: languageRow.id, material_id: material.id, source_word: row.source_word, normalized_word, translation_text: row.translation_text, frequency: row.frequency }));
    if (wordRows.length) { const { error } = await supabase.from("material_words").insert(wordRows); if (error) throw error; }
    currentLanguageId = languageRow.id; currentLanguageName = languageRow.language_name;
    renderStudyMaterial({ title: materialTitleEl.value || "Private lesson", language: languageRow.language_name, translationLanguage: translationLanguageEl.value || "English", items, words: wordRows });
    await loadWordsForSelection(languageRow.id);
    setStatus(`Loaded ${items.length} line(s) and ${wordRows.length} unique word(s).`);
  }

  async function renderUserLessonButtons() {
    lessonsList.querySelectorAll(".lesson[data-user-lesson='1']").forEach((node) => node.remove());
    const separator = lessonsList.querySelector(".sep");
    userLanguages.forEach((lang) => {
      const btn = document.createElement("button");
      btn.className = "lesson"; btn.dataset.userLesson = "1"; btn.type = "button"; btn.textContent = `${lang.language_name} (latest material)`;
      btn.addEventListener("click", async () => { try { await loadLatestMaterial(lang.id); toggleDrawer(false); } catch (error) { setStatus(error.message); } });
      lessonsList.insertBefore(btn, separator || null);
    });
  }
    
  loadMaterialBtn?.addEventListener("click", async () => {
    try {
      setStatus("Saving material…");
      const language = newPanel.hidden ? userLanguages.find((item) => String(item.id) === String(existingLanguageSelectEl.value)) : await ensureUserLanguage(newLanguageNameEl.value || "");
      if (!language) throw new Error("Choose or create a language first.");
      await ingestMaterialForLanguage(language);
      await loadUserLanguages(); await renderUserLessonButtons();
      openMode("existing"); existingLanguageSelectEl.value = language.id; materialTextEl.value = "";
    } catch (error) { setStatus(error.message || "Failed to load material."); }
  });

  startExistingLessonBtn?.addEventListener("click", async () => { try { if (!existingLanguageSelectEl.value) throw new Error("Select an existing language."); await loadLatestMaterial(existingLanguageSelectEl.value); setStatus("Material loaded. Choose focus words or let the app pick."); } catch (error) { setStatus(error.message || "Could not start lesson."); } });
  wordSelectionListEl.addEventListener("change", updatePracticeControls);
  clearWordsBtn.addEventListener("click", () => {
    wordSelectionListEl.querySelectorAll("input:checked").forEach((input) => { input.checked = false; });
    updatePracticeControls();
  });
  generateSessionBtn?.addEventListener("click", () => generateStudySession().catch((error) => setStatus(error.message || "Could not generate study session.")));

  async function initPrivateSession() {
    const { data: sessionData } = await supabase.auth.getSession();
    currentUser = sessionData?.session?.user || null;
    if (!currentUser) { setStatus("Please sign in to manage private sessions."); setPrivateSessionControlsDisabled(true); return; }
    if (!(await currentUserCanUsePrivateSession())) { setStatus("Private sessions are currently limited to approved accounts. Ask the app owner to add your email."); setPrivateSessionControlsDisabled(true); return; }
    setPrivateSessionControlsDisabled(false); await loadUserLanguages(); await renderUserLessonButtons(); openMode("new"); setStatus("Create a language or study an existing one.");
  }

 menuComeback?.addEventListener("click", () => { localStorage.removeItem("signed_out"); drawer?.classList.remove("open"); if (window.APP_CONFIG.COMEBACK_URL) window.location.href = window.APP_CONFIG.COMEBACK_URL; });
  menuSignout?.addEventListener("click", async () => { await supabase.auth.signOut(); localStorage.setItem("signed_out", "1"); drawer?.classList.remove("open"); document.body.classList.add("signed-out"); alert("Signed out. Your study history stays on this device."); });
  setPrivateSessionControlsDisabled(true);
  initPrivateSession().catch((error) => { console.error(error); setStatus(`Could not initialize private sessions: ${error.message}`); });
});
