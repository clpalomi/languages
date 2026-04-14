# Private sessions plan

## Product flow

Update `session.html` so users choose one of two modes:

1. **Start studying a new language**
   - Enter language name.
   - Paste text material.
   - Click **Load new material**.
2. **Study an already added language**
   - Pick an existing language from Supabase (`user_languages`).
   - Optionally paste more text and click **Load new material**.
   - Click **Start lesson** to open the latest generated lesson for that language.

Both modes use the same ingestion pipeline and write user-scoped data.

## Supabase storage model

Use these user-scoped tables:

- `user_languages`: one row per language per user.
- `language_materials`: each imported text blob (with word count).
- `material_sentences`: sentence-level extraction and EN translation.
- `material_words`: unique words and EN translation.
- `language_lessons`: generated lesson JSON for `session-page.js`.

See `supabase/private_sessions_schema.sql` for SQL + RLS policies.

## LLM + translation integration (open source)

Recommended initial multilingual stack:

- **Segmentation/tokenization**: spaCy / Stanza / simple regex fallback in Edge Function.
- **Translation model**: `facebook/nllb-200-distilled-600M` (open-source multilingual model).
- **Serving option A (fast start)**: Hugging Face Inference Endpoint hosting NLLB.
- **Serving option B (self-hosted)**: vLLM or TGI on your own GPU instance.

## Supabase integration pattern

1. Browser inserts `language_materials` row.
2. Browser calls Supabase Edge Function `multilingual-ingest`.
3. Edge Function:
   - validates auth (`Authorization: Bearer <jwt>`),
   - enforces max words (`<= 1200`),
   - splits text into sentences + words,
   - calls NLLB endpoint for EN translation,
   - bulk inserts `material_sentences` and `material_words`,
   - optionally creates/updates `language_lessons`.
4. Browser fetches latest `language_lessons` when user clicks **Start lesson**.

## This design

- Keeps private language data isolated through RLS (`auth.uid() = user_id`).
- Keeps model API keys off the browser (inside Edge Function secrets).
- Supports progressive improvements later (difficulty ranking, CEFR labels, quizzes).
