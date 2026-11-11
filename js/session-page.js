import { supabase } from "./client.js";

window.APP_CONFIG = Object.assign({ COMEBACK_URL: "" }, window.APP_CONFIG || {});

document.addEventListener("DOMContentLoaded", () => {
  const $ = (selector) => document.querySelector(selector);
  const menuBtn = $("#menu-btn");
  const drawer = $("#lesson-drawer");
  const lessonsList = $("#lessons-list");
  const setup = $("#material-setup");
  const titleEl = $("#reader-heading");
  const metaEl = $("#reader-meta");
  const contentEl = $("#reader-content");
  const statusEl = $("#private-session-status");
  const setupStatus = $("#setup-status");
  const practiceStatus = $("#practice-status");
  const readerStatus = $("#reader-status");
  const modeNewBtn = $("#mode-new-language");
  const modeExistingBtn = $("#mode-existing-language");
  const newPanel = $("#panel-new-language");
  const existingPanel = $("#panel-existing-language");
  const newLanguageNameEl = $("#new-language-name");
  const existingLanguageSelectEl = $("#existing-language-select");
  const materialTitleEl = $("#material-title");
  const translationLanguageEl = $("#translation-language");
  const materialTypeEl = $("#material-type");
  const materialTextEl = $("#material-text");
  const loadMaterialBtn = $("#load-material");
  const startExistingLessonBtn = $("#start-existing-lesson");
  const wordSelectionEl = $("#word-selection");
  const wordSelectionListEl = $("#word-selection-list");
  const wordSearch = $("#word-search");
  const selectAllWordsBtn = $("#select-all-words");
  const clearWordsBtn = $("#clear-words");
  const generateSessionBtn = $("#generate-session");
  const showTranslations = $("#show-translations");
  const MAX_INGEST_WORDS = 1200;
  const MAX_SELECTED_WORDS = 40;
  const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const normalizeWord = (value) => String(value ?? "").toLocaleLowerCase().normalize("NFKC").replace(/^\p{P}+|\p{P}+$/gu, "");
  const countWords = (text) => (text || "").trim().split(/\s+/).filter(Boolean).length;
  let currentUser = null;
  let userLanguages = [];
  let wordMetadata = new Map();
  let sessionTokensSpent = 0;
  let currentRenderedItems = [];
  let currentTranslationLanguage = "English";
  let currentLanguageId = null;
  let currentLanguageName = "";
  let allowed = false;
  let busy = false;
  let activeBubble = null;
  let activeBubbleToken = null;
  let grammarDialog = null;
  let grammarToken = null;
  let importHasSentenceTranslations = false;

  function status(element, message = "", tone = "info") {
    if (!element) return;
    element.textContent = message;
    element.hidden = !message;
    element.dataset.tone = tone;
  }

  function selectedWords() {
    return [...new Set([...wordSelectionListEl.querySelectorAll("input:checked")].map((input) => input.value))];
  }

  function updateSelection() {
    const count = selectedWords().length;
    $("#scope-summary").textContent = count ? `${count} word${count === 1 ? "" : "s"} selected` : "Using all stored vocabulary";
    $("#scope-description").textContent = `Vocabulary across all stored material for ${currentLanguageName || "this language"}. Select up to ${MAX_SELECTED_WORDS} specific words, or clear the selection to use all. With all vocabulary, generation uses up to 50 words ordered by frequency.`;
    generateSessionBtn.textContent = count ? `Generate practice with ${count} word${count === 1 ? "" : "s"}` : "Generate practice with all vocabulary";
    status($("#selection-error"), count > MAX_SELECTED_WORDS ? `Select no more than ${MAX_SELECTED_WORDS} words. Clear or deselect ${count - MAX_SELECTED_WORDS} to continue.` : "", "error");
    generateSessionBtn.disabled = !allowed || busy || count > MAX_SELECTED_WORDS || !currentLanguageId;
  }

  function updateControls() {
    document.querySelectorAll("#material-setup input, #material-setup select, #material-setup textarea, #material-setup button, #word-selection input, #word-selection button, .lesson, [data-gloss-index]").forEach((control) => { control.disabled = !allowed || busy; });
    $("#menu-signout").disabled = busy || !currentUser;
    startExistingLessonBtn.disabled = !allowed || busy || !existingLanguageSelectEl.value;
    updateSelection();
  }

  async function runAction(button, label, target, action) {
    if (busy || (!allowed && !(button.id === "menu-signout" && currentUser))) return;
    const original = button.innerHTML;
    busy = true;
    updateControls();
    button.textContent = label;
    button.setAttribute("aria-busy", "true");
    status(target, label, "loading");
    try {
      await action();
    } catch (error) {
      status(target, `${error.message || "Something went wrong."} ${error.recovery || "Check your connection and try again."}`, "error");
    } finally {
      busy = false;
      button.innerHTML = original;
      button.removeAttribute("aria-busy");
      updateControls();
    }
  }

  function addTokenUsage(usage) {
    const spent = Number(usage?.total_tokens || 0);
    if (Number.isFinite(spent) && spent > 0) {
      sessionTokensSpent += spent;
      $("#session-token-count").textContent = sessionTokensSpent.toLocaleString();
    }
  }

  function toggleDrawer(open) {
    const isOpen = open ?? !drawer.classList.contains("open");
    drawer.classList.toggle("open", isOpen);
    menuBtn.setAttribute("aria-expanded", String(isOpen));
  }
  menuBtn.addEventListener("click", () => toggleDrawer());
  drawer.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { toggleDrawer(false); menuBtn.focus(); }
  });

  function openMode(mode) {
    const isNew = mode === "new";
    newPanel.hidden = !isNew;
    existingPanel.hidden = isNew;
    modeNewBtn.classList.toggle("active", isNew);
    modeExistingBtn.classList.toggle("active", !isNew);
    modeNewBtn.setAttribute("aria-pressed", String(isNew));
    modeExistingBtn.setAttribute("aria-pressed", String(!isNew));
  }
  modeNewBtn.addEventListener("click", () => openMode("new"));
  modeExistingBtn.addEventListener("click", () => openMode("existing"));
  existingLanguageSelectEl.addEventListener("change", updateControls);
  $("#change-material").addEventListener("click", () => {
    setup.open = true;
    setup.scrollIntoView({ block: "start" });
    setup.querySelector("summary").focus();
  });

  // Keep the existing accepted formats and parsing behavior for preview and persistence.
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

  function updatePreview() {
    const raw = materialTextEl.value.trim();
    const items = parseMaterial(raw);
    const missing = items.filter((item) => !item.translation).length;
    const count = countWords(raw);
    $("#material-count").textContent = `${count.toLocaleString()} / ${MAX_INGEST_WORDS.toLocaleString()} words`;
    $("#import-preview").hidden = !raw;
    $("#preview-summary").textContent = `${items.length} line${items.length === 1 ? "" : "s"} · ${missing} without translations`;
    $("#preview-table-body").innerHTML = items.map((item) => `<tr><td>${escapeHtml(item.source)}</td><td>${item.translation ? escapeHtml(item.translation) : '<span class="muted">No translation</span>'}</td></tr>`).join("");
    const tooLong = count > MAX_INGEST_WORDS;
    materialTextEl.setAttribute("aria-invalid", String(tooLong));
    status($("#material-error"), tooLong ? `Remove ${count - MAX_INGEST_WORDS} words to stay within the ${MAX_INGEST_WORDS.toLocaleString()}-word limit.` : "", "error");
  }
  materialTextEl.addEventListener("input", updatePreview);

  function tokenize(text) {
    return String(text || "").split(/(\s+)/).map((part) => {
      if (/^\s+$/.test(part)) return part;
      const normalized = normalizeWord(part);
      if (!normalized) return escapeHtml(part);
      return `<button type="button" class="word-token" data-word="${escapeHtml(normalized)}" aria-label="Translation for ${escapeHtml(part)}" aria-expanded="false" aria-haspopup="dialog">${escapeHtml(part)}</button>`;
    }).join("");
  }

  function applyTranslationVisibility() {
    contentEl.querySelectorAll(".study-line").forEach((line) => {
      const translation = line.querySelector(".translation-line");
      const toggle = line.querySelector(".translation-toggle");
      if (!translation || !toggle) return;
      const visible = showTranslations.checked;
      translation.hidden = !visible;
      toggle.hidden = visible;
      toggle.textContent = visible ? "Hide translation" : "Reveal translation";
      toggle.setAttribute("aria-expanded", String(visible));
    });
  }
  showTranslations.addEventListener("change", applyTranslationVisibility);

  function focusReader() {
    setup.open = false;
    wordSelectionEl.open = false;
    toggleDrawer(false);
    titleEl.focus({ preventScroll: true });
    $("#reader-page").scrollIntoView({ block: "start" });
  }

  function renderStudyMaterial({ title, language, translationLanguage, items = [], words = [], imported = false }) {
    closeTransientBubble();
    grammarDialog?.close();
    wordMetadata = new Map();
    words.forEach((word) => {
      const key = normalizeWord(word.normalized_word || word.source_word);
      if (key) wordMetadata.set(key, word);
    });
    importHasSentenceTranslations = imported;
    currentRenderedItems = items;
    currentTranslationLanguage = translationLanguage || "English";
    titleEl.textContent = title || "Study material";
    metaEl.textContent = `${language || "Private lesson"} · Translations: ${currentTranslationLanguage} · ${items.length} line${items.length === 1 ? "" : "s"}`;
    $("#translation-controls").hidden = !items.some((item) => item.translation);
    $("#reader-help").hidden = !items.length;
    contentEl.innerHTML = items.length ? `<div class="study-reader">${items.map((item, index) => `
      <section class="study-line" data-line-index="${index}" aria-label="Line ${index + 1}">
        <span class="line-number" aria-hidden="true">${index + 1}</span>
        <div class="line-body"><p class="source-line">${tokenize(item.source)}</p>
        ${item.translation ? `<p class="translation-line" id="translation-${index}">${escapeHtml(item.translation)}</p>` : '<p class="muted">No sentence translation available.</p>'}
        <div class="line-actions">${item.translation ? `<button class="translation-toggle text-button" type="button" aria-controls="translation-${index}" aria-expanded="true">Hide translation</button>` : ""}<div class="gloss-actions"><button class="text-button" type="button" data-gloss-index="${index}" aria-describedby="gloss-help">Explain grammar</button></div></div>
        <p class="gloss-line" id="gloss-${index}"${item.gloss ? "" : " hidden"}>${escapeHtml(item.gloss || "")}</p>
        <p class="status line-status" role="status" aria-live="polite" hidden></p></div>
      </section>`).join("")}</div>` : '<p class="muted">No lines are available in this material. Open material setup to add some.</p>';
    applyTranslationVisibility();
    status(readerStatus);
    lessonsList.querySelectorAll(".lesson").forEach((button) => {
      if (button.dataset.languageId === String(currentLanguageId)) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
  }

  function closeTransientBubble(restoreFocus = false) {
    const token = activeBubbleToken;
    activeBubble?.remove();
    token?.setAttribute("aria-expanded", "false");
    token?.removeAttribute("aria-controls");
    activeBubble = null;
    activeBubbleToken = null;
    if (restoreFocus && token?.isConnected) token.focus({ preventScroll: true });
  }

  function positionBubble() {
    if (!activeBubble || !activeBubbleToken) return;
    const rect = activeBubbleToken.getBoundingClientRect();
    const width = activeBubble.offsetWidth;
    const height = activeBubble.offsetHeight;
    const margin = 12;
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
    const above = rect.top - height - 10;
    const top = above >= margin ? above : Math.min(rect.bottom + 10, window.innerHeight - height - margin);
    activeBubble.style.left = `${left}px`;
    activeBubble.style.top = `${Math.max(margin, top)}px`;
  }

  function showBubble(token) {
    if (activeBubbleToken === token) { closeTransientBubble(true); return; }
    closeTransientBubble();
    const meta = wordMetadata.get(token.dataset.word) || {};
    const translation = meta.translation_text || meta.english_text;
    // Imported sentence translations are copied onto words by the existing ingestion logic.
    const copiedSentence = importHasSentenceTranslations && currentRenderedItems.some((item) => item.translation === translation && String(item.source).trim().split(/\s+/).length > 1 && String(item.source).split(/\s+/).some((part) => normalizeWord(part) === token.dataset.word));
    const bubble = document.createElement("div");
    bubble.id = "word-popover";
    bubble.className = "word-bubble";
    bubble.setAttribute("role", "dialog");
    bubble.setAttribute("aria-labelledby", "word-popover-title");
    const actions = [];
    if (meta.part_of_speech === "verb" || meta.conjugation_table) actions.push('<button type="button" data-kind="verb">Conjugation</button>');
    if (["noun", "pronoun", "adjective"].includes(meta.part_of_speech) || meta.declension_table) actions.push('<button type="button" data-kind="noun">Declension</button>');
    bubble.innerHTML = `<div class="popover-header"><strong id="word-popover-title">${escapeHtml(token.textContent)}</strong><button type="button" class="popover-close" aria-label="Close translation">×</button></div><span class="bubble-label">${copiedSentence ? "Sentence translation" : "Word translation"} · ${escapeHtml(currentTranslationLanguage)}</span><p>${escapeHtml(translation || "No translation available for this word.")}</p>${actions.length ? `<div class="bubble-actions">${actions.join("")}</div>` : ""}`;
    document.body.appendChild(bubble);
    activeBubble = bubble;
    activeBubbleToken = token;
    token.setAttribute("aria-expanded", "true");
    token.setAttribute("aria-controls", "word-popover");
    positionBubble();
    bubble.querySelector(".popover-close").addEventListener("click", () => closeTransientBubble(true));
    bubble.querySelectorAll("[data-kind]").forEach((button) => button.addEventListener("click", () => showGrammarBox(button.dataset.kind)));
    bubble.querySelector(".popover-close").focus({ preventScroll: true });
  }

  function showGrammarBox(kind) {
    const token = activeBubbleToken;
    if (!token) return;
    const meta = wordMetadata.get(token.dataset.word) || {};
    const details = kind === "verb" ? meta.conjugation_table : meta.declension_table;
    const heading = kind === "verb" ? "Conjugation" : "Declension / forms";
    const dialog = document.createElement("dialog");
    dialog.className = "grammar-dialog";
    dialog.setAttribute("aria-labelledby", "grammar-title");
    dialog.innerHTML = `<div class="popover-header"><h2 id="grammar-title">${escapeHtml(heading)} · ${escapeHtml(token.textContent)}</h2><button type="button" class="popover-close" aria-label="Close grammar details" autofocus>×</button></div><pre>${escapeHtml(details || "Grammar details are not available for this word yet. Generate practice to enrich its details.")}</pre>`;
    document.body.appendChild(dialog);
    grammarDialog = dialog;
    grammarToken = token;
    closeTransientBubble();
    dialog.querySelector("button").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (grammarDialog === dialog) grammarDialog = null;
      if (grammarToken?.isConnected) grammarToken.focus({ preventScroll: true });
      grammarToken = null;
    }, { once: true });
    dialog.showModal();
  }

  document.addEventListener("pointerdown", (event) => {
    if (activeBubble && !activeBubble.contains(event.target) && !activeBubbleToken.contains(event.target)) closeTransientBubble();
  });
  document.addEventListener("focusin", (event) => {
    if (activeBubble && !activeBubble.contains(event.target) && event.target !== activeBubbleToken) closeTransientBubble();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeBubble) { event.preventDefault(); closeTransientBubble(true); }
  });
  window.addEventListener("resize", positionBubble);
  window.addEventListener("scroll", positionBubble, true);

  contentEl.addEventListener("click", (event) => {
    const token = event.target.closest(".word-token");
    if (token) { showBubble(token); return; }
    const translationToggle = event.target.closest(".translation-toggle");
    if (translationToggle) {
      const translation = document.getElementById(translationToggle.getAttribute("aria-controls"));
      translation.hidden = !translation.hidden;
      translationToggle.textContent = translation.hidden ? "Reveal translation" : "Hide translation";
      translationToggle.setAttribute("aria-expanded", String(!translation.hidden));
      return;
    }
    const glossButton = event.target.closest("[data-gloss-index]");
    if (glossButton) generateGloss(glossButton);
  });

  async function generateGloss(button) {
    if (!currentLanguageId || busy) return;
    const index = Number(button.dataset.glossIndex);
    const item = currentRenderedItems[index];
    if (!item?.source) return;
    const lineStatus = button.closest(".study-line").querySelector(".line-status");
    await runAction(button, "Explaining grammar…", lineStatus, async () => {
      const { data, error } = await supabase.functions.invoke("generate-study-session", { body: { action: "gloss", userLanguageId: currentLanguageId, source: item.source, translation: item.translation || "", translationLanguage: currentTranslationLanguage } });
      if (error) throw error;
      item.gloss = data?.gloss || "Gloss unavailable.";
      addTokenUsage(data?.usage);
      // Patch only this sentence: preserve focus, scroll and translation visibility.
      const gloss = $(`#gloss-${index}`);
      gloss.textContent = item.gloss;
      gloss.hidden = false;
      status(lineStatus, "Grammar explanation ready.", "success");
    });
    button.focus({ preventScroll: true });
  }

  async function ensureUserLanguage(languageName) {
    const normalized = languageName.trim();
    const { data, error } = await supabase.from("user_languages").upsert([{ user_id: currentUser.id, language_name: normalized }], { onConflict: "user_id,language_name" }).select("id, language_name").single();
    if (error) throw error;
    return data;
  }

  async function loadUserLanguages() {
    const selected = existingLanguageSelectEl.value;
    const { data, error } = await supabase.from("user_languages").select("id, language_name").eq("user_id", currentUser.id).order("language_name", { ascending: true });
    if (error) throw error;
    userLanguages = data || [];
    existingLanguageSelectEl.innerHTML = '<option value="">Select a language</option>' + userLanguages.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.language_name)}</option>`).join("");
    if (userLanguages.some((language) => String(language.id) === selected)) existingLanguageSelectEl.value = selected;
  }

  function filterWords() {
    const query = wordSearch.value.trim().toLocaleLowerCase();
    const choices = [...wordSelectionListEl.querySelectorAll(".word-choice")];
    let shown = 0;
    choices.forEach((choice) => {
      choice.hidden = !choice.textContent.toLocaleLowerCase().includes(query);
      if (!choice.hidden) shown += 1;
    });
    $("#word-search-count").textContent = choices.length ? `${shown} of ${choices.length} words shown${!shown ? ". No matches. Try a different search." : ""}` : "No vocabulary available yet.";
  }
  wordSearch.addEventListener("input", filterWords);

  function clearSelectionScope() {
    wordSelectionEl.hidden = true;
    wordSelectionListEl.replaceChildren();
    status(practiceStatus);
    updateSelection();
  }

  async function loadWordsForSelection(languageId) {
    const { data, error } = await supabase.from("material_words").select("id, source_word, normalized_word, translation_text, english_text, part_of_speech, conjugation_table, declension_table, frequency").eq("user_id", currentUser.id).eq("user_language_id", languageId).order("source_word", { ascending: true });
    if (error) throw error;
    const unique = new Map();
    (data || []).forEach((row) => { if (!unique.has(row.normalized_word)) unique.set(row.normalized_word, row); });
    wordSelectionListEl.innerHTML = [...unique.values()].map((row) => `<label class="word-choice"><input type="checkbox" value="${escapeHtml(row.normalized_word)}"><span>${escapeHtml(row.source_word)}</span><small>${escapeHtml(row.translation_text || row.english_text || "No translation available")}</small></label>`).join("");
    wordSelectionEl.hidden = !unique.size;
    wordSearch.value = "";
    filterWords();
    updateSelection();
    status(practiceStatus);
    return data || [];
  }

  async function generateStudySession() {
    if (!currentLanguageId || selectedWords().length > MAX_SELECTED_WORDS) return;
    await runAction(generateSessionBtn, "Generating practice…", practiceStatus, async () => {
      const words = selectedWords();
      const { data, error } = await supabase.functions.invoke("generate-study-session", { body: { userLanguageId: currentLanguageId, selectedWords: words, useAll: words.length === 0 } });
      if (error) throw error;
      if (!data?.items?.length) throw new Error("No practice sentences were returned.");
      addTokenUsage(data.usage);
      renderStudyMaterial({ title: data.title || "Generated practice", language: currentLanguageName, translationLanguage: data.translationLanguage || "English", items: data.items, words: data.words || [] });
      status(practiceStatus, "Practice ready. Generate practice again whenever you want a new collection.", "success");
      status(readerStatus, "Practice ready. Read a sentence, then select a word to explore it.", "success");
      focusReader();
    });
  }

  async function loadLatestMaterial(languageId) {
    const { data: materials, error } = await supabase.from("language_materials").select("id, title, material_type, translation_language, user_language_id, user_languages(language_name)").eq("user_id", currentUser.id).eq("user_language_id", languageId).order("created_at", { ascending: false }).limit(1);
    if (error) throw error;
    if (!materials?.length) {
      existingLanguageSelectEl.value = languageId;
      openMode("existing");
      setup.open = true;
      const emptyError = new Error("No material yet for this language.");
      emptyError.recovery = "Paste words, sentences, or a story in material setup, then select Save and open material.";
      throw emptyError;
    }
    const material = materials[0];
    const { data: sentences, error: sentenceError } = await supabase.from("material_sentences").select("source_text, translation_text, position").eq("material_id", material.id).order("position", { ascending: true });
    if (sentenceError) throw sentenceError;
    const { data: words, error: wordError } = await supabase.from("material_words").select("id, source_word, normalized_word, translation_text, english_text, part_of_speech, conjugation_table, declension_table, frequency").eq("material_id", material.id);
    if (wordError) throw wordError;
    clearSelectionScope();
    currentLanguageId = languageId;
    currentLanguageName = material.user_languages?.language_name || userLanguages.find((language) => String(language.id) === String(languageId))?.language_name || "";
    const items = sentences?.length ? sentences.map((row) => ({ source: row.source_text, translation: row.translation_text || "" })) : (words || []).map((row) => ({ source: row.source_word, translation: row.translation_text || "" }));
    renderStudyMaterial({ title: material.title || "Latest private lesson", language: currentLanguageName, translationLanguage: material.translation_language, items, words, imported: true });
    existingLanguageSelectEl.value = languageId;
    translationLanguageEl.value = material.translation_language || "English";
    openMode("existing");
    await loadWordsForSelection(languageId);
    status(setupStatus, "Latest material opened.", "success");
    focusReader();
  }

  async function ingestMaterialForLanguage(languageRow, onSaved) {
    const raw = materialTextEl.value.trim();
    const wordCount = countWords(raw);
    const items = parseMaterial(raw);
    const { data: material, error: materialError } = await supabase.from("language_materials").insert([{ user_id: currentUser.id, user_language_id: languageRow.id, title: materialTitleEl.value.trim() || "Private lesson", material_type: materialTypeEl.value, translation_language: translationLanguageEl.value.trim() || "English", source_text: raw, source_word_count: wordCount }]).select("id").single();
    if (materialError) throw materialError;
    const sentenceRows = items.map((item, position) => ({ user_id: currentUser.id, material_id: material.id, position, source_text: item.source, translation_text: item.translation || null }));
    if (sentenceRows.length) { const { error } = await supabase.from("material_sentences").insert(sentenceRows); if (error) throw error; }
    const wordMap = new Map();
    items.forEach((item) => String(item.source).split(/\s+/).forEach((word) => { const n = normalizeWord(word); if (!n) return; const existing = wordMap.get(n) || { source_word: word.replace(/^\p{P}+|\p{P}+$/gu, ""), translation_text: item.translation || null, frequency: 0 }; existing.frequency += 1; wordMap.set(n, existing); }));
    const wordRows = [...wordMap.entries()].map(([normalized_word, row]) => ({ user_id: currentUser.id, user_language_id: languageRow.id, material_id: material.id, source_word: row.source_word, normalized_word, translation_text: row.translation_text, frequency: row.frequency }));
    if (wordRows.length) { const { error } = await supabase.from("material_words").insert(wordRows); if (error) throw error; }
    onSaved();
    clearSelectionScope();
    currentLanguageId = languageRow.id;
    currentLanguageName = languageRow.language_name;
    renderStudyMaterial({ title: materialTitleEl.value || "Private lesson", language: languageRow.language_name, translationLanguage: translationLanguageEl.value || "English", items, words: wordRows, imported: true });
    await loadWordsForSelection(languageRow.id);
    status(setupStatus, `Saved ${items.length} line${items.length === 1 ? "" : "s"} and ${wordRows.length} unique words.`, "success");
    status(readerStatus, "Material saved. Select a word to explore its translation.", "success");
  }

  function renderUserLessonButtons() {
    lessonsList.querySelectorAll(".lesson").forEach((node) => node.remove());
    const separator = lessonsList.querySelector(".sep");
    userLanguages.forEach((lang) => {
      const btn = document.createElement("button");
      btn.className = "lesson";
      btn.dataset.languageId = lang.id;
      btn.type = "button";
      btn.innerHTML = `<span>${escapeHtml(lang.language_name)}</span><small>Open latest material</small>`;
      if (String(lang.id) === String(currentLanguageId)) btn.setAttribute("aria-current", "true");
      btn.addEventListener("click", () => runAction(btn, "Opening material…", statusEl, async () => {
        await loadLatestMaterial(lang.id);
        status(statusEl);
      }));
      lessonsList.insertBefore(btn, separator || null);
    });
    $("#languages-empty")?.toggleAttribute("hidden", !!userLanguages.length);
    updateControls();
  }

  loadMaterialBtn.addEventListener("click", () => {
    if (busy || !allowed) return;
    const raw = materialTextEl.value.trim();
    if (!raw || countWords(raw) > MAX_INGEST_WORDS) {
      status(setupStatus, !raw ? "Paste some material, then check the preview before saving." : "Your material is over the word limit. Shorten it before saving.", "error");
      materialTextEl.setAttribute("aria-invalid", "true");
      materialTextEl.focus();
      return;
    }
    if (!newPanel.hidden && !newLanguageNameEl.value.trim()) {
      status(setupStatus, "Enter a language name to continue.", "error");
      newLanguageNameEl.setAttribute("aria-invalid", "true");
      newLanguageNameEl.focus();
      return;
    }
    if (newPanel.hidden && !existingLanguageSelectEl.value) {
      status(setupStatus, "Choose a language for this material.", "error");
      existingLanguageSelectEl.focus();
      return;
    }
    newLanguageNameEl.removeAttribute("aria-invalid");
    runAction(loadMaterialBtn, "Saving material…", setupStatus, async () => {
      const language = newPanel.hidden ? userLanguages.find((item) => String(item.id) === String(existingLanguageSelectEl.value)) : await ensureUserLanguage(newLanguageNameEl.value);
      if (!language) throw new Error("Choose or create a language first.");
      let materialSaved = false;
      try {
        await ingestMaterialForLanguage(language, () => {
          materialSaved = true;
          materialTextEl.value = "";
          updatePreview();
        });
        await loadUserLanguages();
        renderUserLessonButtons();
      } catch (error) {
        if (materialSaved) {
          const refreshError = new Error("Your material was saved, but the study space could not refresh.");
          refreshError.recovery = "Reopen latest material or reload the page; you do not need to save it again.";
          throw refreshError;
        }
        // A failed multi-step save can leave partial records; avoid blind automatic retries.
        const saveError = new Error(error.message || "Material could not be fully saved.");
        saveError.recovery = "Your pasted text is still here. Check the latest stored material before trying to save again.";
        throw saveError;
      }
      openMode("existing");
      existingLanguageSelectEl.value = language.id;
      materialTextEl.value = "";
      updatePreview();
      focusReader();
    });
  });
  newLanguageNameEl.addEventListener("input", () => newLanguageNameEl.removeAttribute("aria-invalid"));
  startExistingLessonBtn.addEventListener("click", () => runAction(startExistingLessonBtn, "Opening material…", setupStatus, () => loadLatestMaterial(existingLanguageSelectEl.value)));
  wordSelectionListEl.addEventListener("change", updateSelection);
  selectAllWordsBtn.addEventListener("click", () => {
    wordSelectionListEl.querySelectorAll("input[type='checkbox']").forEach((input) => { input.checked = true; });
    updateSelection();
  });
  clearWordsBtn.addEventListener("click", () => {
    wordSelectionListEl.querySelectorAll("input[type='checkbox']").forEach((input) => { input.checked = false; });
    updateSelection();
  });
  generateSessionBtn.addEventListener("click", generateStudySession);

  async function initPrivateSession() {
    updateControls();
    status(statusEl, "Opening your study space…", "loading");
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    currentUser = sessionData?.session?.user || null;
    updateControls();
    if (!currentUser) {
      status(statusEl, "Please sign in to manage private sessions.");
      const link = document.createElement("a");
      link.href = new URL("index.html", location.href).href;
      link.textContent = " Sign in";
      statusEl.appendChild(link);
      return;
    }
    const email = (currentUser.email || "").trim();
    if (!email) { status(statusEl, "Your account needs an email address to use private sessions."); return; }
    const { data, error } = await supabase.from("private_session_access").select("id").eq("email", email).eq("active", true).limit(1);
    if (error) throw error;
    if (!data?.length) { status(statusEl, "Private sessions are limited to approved accounts. Ask the app owner to add your email."); return; }
    await loadUserLanguages();
    allowed = true;
    renderUserLessonButtons();
    openMode(userLanguages.length ? "existing" : "new");
    status(statusEl);
  }

  $("#menu-comeback").addEventListener("click", () => {
    localStorage.removeItem("signed_out");
    window.location.href = window.APP_CONFIG.COMEBACK_URL || new URL("app.html", location.href).href;
  });
  $("#menu-signout").addEventListener("click", () => runAction($("#menu-signout"), "Signing out…", statusEl, async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    allowed = false;
    closeTransientBubble();
    grammarDialog?.close();
    currentRenderedItems = [];
    currentLanguageId = null;
    wordMetadata.clear();
    contentEl.innerHTML = '<p class="muted">You are signed out. Sign in to open your private material.</p>';
    titleEl.textContent = "Signed out";
    metaEl.textContent = "Your saved material is stored in your account.";
    wordSelectionEl.hidden = true;
    $("#translation-controls").hidden = true;
    $("#reader-help").hidden = true;
    materialTextEl.value = "";
    updatePreview();
    localStorage.setItem("signed_out", "1");
    window.location.href = new URL("index.html", location.href).href;
  }));
  updatePreview();
  initPrivateSession().catch((error) => {
    console.error(error);
    allowed = false;
    updateControls();
    status(statusEl, `Could not open private sessions: ${error.message}. Reload the page to try again.`, "error");
  });
});
