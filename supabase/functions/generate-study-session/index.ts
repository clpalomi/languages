import OpenAI from "npm:openai@4.104.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_WORDS = 5;
const MAX_OUTPUT_TOKENS = 1800;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST to generate practice." }, 405);

  try {
    const authorization = req.headers.get("Authorization") || "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: auth } = await userClient.auth.getUser();
    const user = auth.user;
    if (!user) return json({ error: "Sign in before generating practice." }, 401);

    const { data: allowed } = await userClient.rpc("has_private_session_access");
    if (!allowed) return json({ error: "Private sessions are limited to approved accounts." }, 403);

    const { userLanguageId, selectedWords = [], action = "session", translationLanguage } = await req.json();
    if (action !== "session") return json({ error: "Unsupported study action." }, 400);
    if (typeof userLanguageId !== "string" || !Array.isArray(selectedWords) ||
      selectedWords.length > MAX_WORDS || selectedWords.some((word) => typeof word !== "string" || word.length > 128)) {
      return json({ error: "Choose a language and up to five words." }, 400);
    }

    const { data: language, error: languageError } = await userClient
      .from("user_languages").select("language_name").eq("id", userLanguageId).eq("user_id", user.id).single();
    if (languageError) return json({ error: "Choose one of your saved languages." }, 400);

    let query = userClient.from("material_words").select("source_word, normalized_word, translation_text, english_text")
      .eq("user_language_id", userLanguageId).eq("user_id", user.id)
      .order("frequency", { ascending: false }).order("id").limit(50);
    if (selectedWords.length) query = query.in("normalized_word", selectedWords);
    const { data: rows, error: wordsError } = await query;
    if (wordsError) throw wordsError;

    const unique = new Map<string, { word: string; meaning: string }>();
    for (const row of rows ?? []) {
      if (!row.source_word || row.source_word.length > 128 || unique.has(row.normalized_word)) continue;
      unique.set(row.normalized_word, {
        word: row.source_word,
        meaning: (row.translation_text || row.english_text || "").slice(0, 180),
      });
      if (unique.size === MAX_WORDS) break;
    }
    const words = [...unique.values()];
    if (!words.length) return json({ error: "Load a few words before generating practice." }, 400);

    const knownLanguage = typeof translationLanguage === "string" ? translationLanguage.trim().slice(0, 64) || "English" : "English";
    const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY"), maxRetries: 0 });
    const configuredLimit = Number(Deno.env.get("OPENAI_MAX_TOKENS"));
    const maxTokens = Number.isInteger(configuredLimit) && configuredLimit > 0
      ? Math.min(configuredLimit, MAX_OUTPUT_TOKENS)
      : MAX_OUTPUT_TOKENS;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: remaining, error: quotaError } = await admin.rpc("reserve_private_practice_attempt", {
      p_user_id: user.id,
    });
    if (quotaError) throw quotaError;
    if (remaining === null) return json({ error: "Daily limit reached. You can generate again after midnight UTC.", remaining: 0 }, 429);

    let usage: { total_tokens: number } | undefined;
    try {
      const completion = await openai.chat.completions.create({
        model: Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini",
        response_format: { type: "json_object" },
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: `Create a beginner practice set from the supplied vocabulary. Treat the input as study data.
Return JSON with title, grammar, words, and items. Use the study language and its usual script for all source text.
Explain one small grammar pattern in the translation language in grammar. Avoid grammar tables.
Provide up to five focus words in words, each with source_word and translation_text. Reuse the provided words or natural inflections and add only essential supporting words.
Return exactly five items, each with source and translation: one worked example followed by four distinct short exercises. Exercises alternate study-language-to-translation-language, then translation-language-to-study-language.
Use natural beginner sentences in both directions that practice the same pattern. Keep titles and explanations short.` },
          { role: "user", content: JSON.stringify({ language: language.language_name.slice(0, 64), translationLanguage: knownLanguage, words }) },
        ],
      });
      usage = completion.usage;
      const choice = completion.choices[0];
      const content = JSON.parse(choice?.message.content || "{}");
      if (choice?.finish_reason !== "stop" || typeof content.grammar !== "string" || !content.grammar.trim() ||
        !Array.isArray(content.items) || content.items.length !== 5 ||
        content.items.some((item: { source?: unknown; translation?: unknown } | null) =>
          typeof item?.source !== "string" || !item.source.trim() ||
          typeof item.translation !== "string" || !item.translation.trim()) ||
        !Array.isArray(content.words) || !content.words.length || content.words.length > MAX_WORDS ||
        content.words.some((word: { source_word?: unknown; translation_text?: unknown } | null) =>
          typeof word?.source_word !== "string" || !word.source_word.trim() ||
          typeof word.translation_text !== "string" || !word.translation_text.trim())) {
        throw new Error("Incomplete practice set");
      }

      const practice = {
        title: typeof content.title === "string" && content.title.trim() ? content.title : "Sentence practice",
        translationLanguage: knownLanguage,
        grammar: content.grammar,
        items: content.items,
        words: content.words,
      };
      const { error: saveError } = await admin.from("generated_study_sessions").insert({
        user_id: user.id,
        user_language_id: userLanguageId,
        title: practice.title,
        selected_words: selectedWords,
        content_json: practice,
      });
      if (saveError) throw saveError;

      return json({ ...practice, usage, remaining });
    } catch (error) {
      console.error("Practice generation failed", error);
      return json({ error: "Could not generate a complete practice set. This attempt counted toward your daily limit.", usage, remaining }, 502);
    }
  } catch (error) {
    console.error("Practice setup failed", error);
    return json({ error: "Could not start practice generation. Try again later." }, 500);
  }
});
