# Languages
Language learning

## Legal
- License: [Business Source License 1.1](./LICENSE) (non-production). Production use requires a [Commercial License](./COMMERCIAL_LICENSE.md).

## Private sessions
- Product/LLM plan: [`docs/private-sessions-llm-plan.md`](./docs/private-sessions-llm-plan.md)

## Supabase block history table

The visualization now reads and writes `public.language_block_history` so every language session stores the exact block positions it added or removed. To create it, open the Supabase SQL editor and run the `language_block_history` section in [`supabase/private_sessions_schema.sql`](./supabase/private_sessions_schema.sql).

For historical `entries`, either let the app create missing rows the first time a language is saved or visualized, or generate a one-time seed SQL file with:

```bash
python3 scripts/generate_block_history_seed.py sessions.json > block_history_seed.sql
```

`sessions.json` should contain existing sessions with `user_id`, `language`, `date`, `minutes`, and optional `inserted_at`. Run the generated SQL once in Supabase so the random grid order is stored and future LIFO replays remain identical.
