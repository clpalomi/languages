# Private sessions redesign

## Product direction

Private Session is a learner-owned reading workspace. The interface keeps the existing language, material, vocabulary, and generation logic while making the next action explicit.

1. Returning learners continue a language and open its latest material; adding a language is the secondary path. Language navigation stays visible on desktop and collapses on mobile.
2. New material uses the existing parser. A live preview shows exactly what will be saved, including missing translations, and checks the existing 1,200-word import limit before writing.
3. Opening material collapses setup and focuses the reader. Translations are visible by default; learners can hide them and reveal individual sentences.
4. Word translations open with click, tap, Enter, or Space. Escape and explicit close controls restore focus. Grammar details use a modal dialog, presented as a bottom sheet on mobile.
5. Practice vocabulary comes from all stored material for the language. No selection preserves `useAll: true`; selecting words preserves the existing `selectedWords` payload. The UI makes the existing 40-word selected limit explicit. With all vocabulary, the backend uses up to 50 words ordered by frequency.
6. Saving, opening, generation, and grammar requests have local pending, success, and error feedback. Pending actions prevent duplicate submission. Grammar explanations update only their sentence to preserve focus, scroll, and translation visibility.

Imported sentence translations continue to be copied to word metadata by the existing ingestion logic. The reader labels those copies as sentence translations rather than precise word definitions. Generated practice, contextual metadata, token accounting, access rules, tables, and function requests keep their existing behavior. Token usage is available in a secondary disclosure. Reader visibility and vocabulary search are presentation state; they do not introduce scoring or a scheduling algorithm.

The reader uses a restrained purple visual system, readable source text, subtle sentence separators, explicit focus styles, light/dark themes, and a mobile layout. Grammar explanations are described in an optional reader help disclosure.

### Design references

- [Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/): collapse setup and advanced controls during reading.
- [Usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/): make scope, action state, and recovery explicit.
- [WCAG keyboard access](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html): native word controls and keyboard-accessible dialogs.
- [WCAG status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html): announce local asynchronous outcomes.

## Supabase tables to keep

- `private_session_access`: keep. It is still the allow-list gate for the private feature.
- `user_languages`: keep. It stores each user's personal languages.
- `language_materials`: keep. It is the canonical lesson/material record and now carries `title`, `material_type`, and `translation_language`.
- `material_sentences`: keep. It stores original lines, sentences, and story segments with their translations.
- `material_words`: keep. It stores per-user vocabulary extracted from the uploaded material and the loaded translation text.
- `entries`: keep if the main study-log app remains active.
- `language_block_history`: keep if the visualization feature remains active.

## Supabase tables that can be erased later

- `language_lessons`: erasable after any valuable generated lessons are migrated into `language_materials`, `material_sentences`, and `material_words`. The redesigned reader no longer depends on this generated-lesson cache.

## Repository files to keep

- `session.html`: keep. It is now the redesigned private-session UI.
- `js/session-page.js`: keep. It owns the private-session flow, Supabase persistence, and interactive reader.
- `supabase/private_sessions_schema.sql`: keep. It defines the necessary private-session tables, RLS policies, and migration notes.
- `app.html`, `js/app-page.js`, `index.html`, `auth-callback.html`, `js/client.js`, and `js/utils.js`: keep while the main app, auth, and private-session entry point remain active.
- `src/utils/studyStrength.js` and `scripts/generate_block_history_seed.py`: keep while study-strength visualization remains active.

## Repository files that can be erased later

- `lessons/**`: removable when static bundled lessons are no longer needed. The redesigned private session loads user-owned Supabase material instead.
- `docs/private-sessions-llm-plan.md`: removable or replaceable if this redesign document becomes the source of truth.
