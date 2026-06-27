# Private sessions redesign

## Product direction

Private Session is now a learner-owned study space that matches the main app's card-based visual system. The entry flow is:

1. Start a new language, or choose a stored language.
2. Load a material/lesson. A lesson is simply uploaded material.
3. Upload lines as `original | translation`, `original => translation`, tab-separated pairs, words, complete sentences, or short-story lines.
4. Study the material in the reader. Clicking a word opens a translation bubble.

Future implementation should extend the same reader by generating contextual sentences and short stories from the lesson words, and by generating non-persisted grammar boxes for verb conjugations, noun declensions, or other language-specific morphology. Those generated boxes should have download actions for PNG and XLSX exports, but should not be stored by default.

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
