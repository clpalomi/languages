import { supabase } from "./client.js";

window.APP_CONFIG = Object.assign({ COMEBACK_URL: "" }, window.APP_CONFIG || {});

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
  const selectAllWordsBtn = document.querySelector("#select-all-words");
  const clearWordsBtn = document.querySelector("#clear-words");
  const generateSessionBtn = document.querySelector("#generate-session");
  const menuComeback = document.querySelector("#menu-comeback");
  const menuSignout = document.querySelector("#menu-signout");
  
  const MAX_INGEST_WORDS = 1200;
  let currentUser = null;
  let userLanguages = [];
  let wordTranslations = new Map();
  let wordMetadata = new Map();
  let activeBubble = null;
  let currentLanguageId = null;
  let currentLanguageName = "";
  
  const controls = [modeNewBtn, modeExistingBtn, newLanguageNameEl, existingLanguageSelectEl, materialTitleEl, translationLanguageEl, materialTypeEl, materialTextEl, loadMaterialBtn, startExistingLessonBtn, selectAllWordsBtn, clearWordsBtn, generateSessionBtn];

  const setStatus = (message) => { if (statusEl) statusEl.textContent = message; };
  const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const normalizeWord = (value) => String(value ?? "").toLocaleLowerCase().normalize("NFKC").replace(/^\p{P}+|\p{P}+$/gu, "");
  const countWords = (text) => (text || "").trim().split(/\s+/).filter(Boolean).length;

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
    wordTranslations = new Map();
    wordMetadata = new Map();
    words.forEach((word) => {
      const key = normalizeWord(word.normalized_word || word.source_word);
      if (!key) return;
      if (word.translation_text || word.english_text) wordTranslations.set(key, word.translation_text || word.english_text);
      wordMetadata.set(key, word);
    });
    items.forEach((item) => {
      if (item.translation) wordTranslations.set(normalizeWord(item.source), item.translation);
      String(item.source).split(/\s+/).forEach((word) => {
        const n = normalizeWord(word);
        if (n && item.translation && !wordTranslations.has(n)) wordTranslations.set(n, item.translation);
      });
    });
    setBars({ title, language, level: `translation: ${translationLanguage || "English"}` });
    contentEl.innerHTML = `<div class="study-reader">${items.map((item, index) => `
      <section class="study-line">
        <div class="line-number">${index + 1}</div>
        <p>${tokenize(item.source)}</p>
        ${item.translation ? `<p class="translation-line"><strong>Translation:</strong> ${escapeHtml(item.translation)}</p>` : ""}
        ${item.gloss ? `<p class="gloss-line"><strong>Gloss:</strong> ${escapeHtml(item.gloss)}</p>` : ""}
      </section>`).join("")}</div>`;
  }

  function closeTransientBubble() {
    activeBubble?.remove();
    activeBubble = null;
  }

  function showBubble(token) {
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
    box.innerHTML = `<button type="button" class="grammar-close" aria-label="Close grammar details">×</button><strong>${escapeHtml(isVerb ? "Conjugation" : "Declension")} for ${escapeHtml(token?.textContent || word)}</strong><pre>${escapeHtml(details || `${isVerb ? "Conjugation" : "Declension"} details are not available yet. Generate a study session to enrich this word.`)}</pre>`;
    token?.appendChild(box);
    closeTransientBubble();
  }

  contentEl?.addEventListener("mouseover", (event) => {
    const token = event.target.closest(".word-token");
    if (token && !event.relatedTarget?.closest?.(".word-token")) showBubble(token);
  });
  contentEl?.addEventListener("mouseout", (event) => {
    if (event.target.closest(".word-token") && !event.relatedTarget?.closest?.(".word-token")) closeTransientBubble();
  });
  contentEl?.addEventListener("click", (event) => {
    const close = event.target.closest(".grammar-close");
    if (close) { close.closest(".grammar-box")?.remove(); return; }
    const grammar = event.target.closest("[data-kind]");
    if (grammar) { event.preventDefault(); event.stopPropagation(); showGrammarBox(grammar); }
  });

  async function ensureUserLanguage(languageName) {
    const normalized = languageName.trim();
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
    wordSelectionListEl.innerHTML = (data || []).map((row) => `<label class="word-choice"><input type="checkbox" value="${escapeHtml(row.normalized_word)}"><span>${escapeHtml(row.source_word)}</span><small>${escapeHtml(row.translation_text || row.english_text || "")}</small></label>`).join("") || `<p class="muted">No words loaded yet.</p>`;
    if (wordSelectionEl) wordSelectionEl.hidden = !(data || []).length;
    return data || [];
  }

  function selectedWords() {
    return [...(wordSelectionListEl?.querySelectorAll("input:checked") || [])].map((input) => input.value);
  }

  async function generateStudySession() {
    if (!currentLanguageId) throw new Error("Select or load a language first.");
    setStatus("Generating a private study session…");
    const { data, error } = await supabase.functions.invoke("generate-study-session", { body: { userLanguageId: currentLanguageId, selectedWords: selectedWords(), useAll: selectedWords().length === 0 } });
    if (error) throw error;
    renderStudyMaterial({ title: data.title || "Generated study session", language: currentLanguageName, translationLanguage: data.translationLanguage || "English", items: data.items || [], words: data.words || [] });
    setStatus("Generated a study set. Use Generate more after finishing this collection.");
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
      btn.addEventListener("click", async () => { try { await loadLatestMaterial(lang.id); drawer?.classList.remove("open"); } catch (error) { setStatus(error.message); } });
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

  startExistingLessonBtn?.addEventListener("click", async () => { try { if (!existingLanguageSelectEl.value) throw new Error("Select an existing language."); await loadLatestMaterial(existingLanguageSelectEl.value); setStatus("Latest material loaded. Select words or generate with all material."); } catch (error) { setStatus(error.message || "Could not start lesson."); } });
  selectAllWordsBtn?.addEventListener("click", () => wordSelectionListEl?.querySelectorAll("input[type='checkbox']").forEach((input) => { input.checked = true; }));
  clearWordsBtn?.addEventListener("click", () => wordSelectionListEl?.querySelectorAll("input[type='checkbox']").forEach((input) => { input.checked = false; }));
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
  initPrivateSession().catch((error) => { console.error(error); setStatus(`Could not initialize private sessions: ${error.message}`); });
});
