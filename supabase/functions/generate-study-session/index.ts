import OpenAI from "npm:openai@4.104.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: auth } = await userClient.auth.getUser();
    const user = auth.user;
    if (!user) throw new Error("Sign in before generating a private study session.");

    const { userLanguageId, selectedWords = [], useAll = true } = await req.json();
    const MAX_SELECTED_WORDS = 40;
    const MAX_CONTEXT_WORDS = 50;
    const MAX_CONTEXT_SENTENCES = 24;
    const { data: allowed } = await userClient.rpc("has_private_session_access");
    if (!allowed) throw new Error("Private sessions are limited to approved accounts.");

    const { data: lang, error: langError } = await userClient.from("user_languages").select("id, language_name").eq("id", userLanguageId).single();
    if (langError) throw langError;

    let query = userClient.from("material_words").select("source_word, normalized_word, translation_text, english_text, frequency").eq("user_language_id", userLanguageId).order("frequency", { ascending: false }).limit(MAX_CONTEXT_WORDS);
    if (!useAll && selectedWords.length) query = query.in("normalized_word", selectedWords.slice(0, MAX_SELECTED_WORDS));
    const { data: words, error: wordsError } = await query;
    if (wordsError) throw wordsError;
    if (!words?.length) throw new Error("Load words or sentences for this language before generating a session.");

    const { data: sentences, error: sentenceError } = await userClient.from("material_sentences").select("source_text, translation_text, language_materials!inner(user_language_id)").eq("language_materials.user_language_id", userLanguageId).limit(MAX_CONTEXT_SENTENCES);
    if (sentenceError) throw sentenceError;

    const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY") });
    const completion = await openai.chat.completions.create({
      model: Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini",
      response_format: { type: "json_object" },
      max_tokens: Number(Deno.env.get("OPENAI_MAX_TOKENS") || 1800),
      messages: [
        { role: "system", content: "Create compact personalized language study sessions from user-provided material. Return strict JSON with title, translationLanguage, items array of {source, translation, gloss}, and words array of {source_word, normalized_word, translation_text, part_of_speech, conjugation_table, declension_table}. Always generate 6-10 short study sentences in items unless fewer source words are available. Each item must include a natural sentence, a sentence translation, and a concise word-by-word gloss. Keep output compact for token limits. Grammar tables must be concise; only fill conjugation_table for verbs and declension_table for nouns/pronouns/adjectives when applicable." },
        { role: "user", content: JSON.stringify({ language: lang.language_name, words, sentences, requestedWords: useAll ? "all" : selectedWords }) },
      ],
    });
    const content = JSON.parse(completion.choices[0]?.message?.content || "{}");
    if (!Array.isArray(content.items) || !content.items.length) {
      content.items = (sentences || []).slice(0, 8).map((sentence) => ({
        source: sentence.source_text,
        translation: sentence.translation_text || "",
        gloss: "",
      }));
    }
    const rows = (content.words || []).filter((w: Record<string, string>) => w.normalized_word);
    for (const row of rows) {
      await admin.from("material_words").update({ part_of_speech: row.part_of_speech || null, conjugation_table: row.conjugation_table || null, declension_table: row.declension_table || null, translation_text: row.translation_text || null }).eq("user_id", user.id).eq("user_language_id", userLanguageId).eq("normalized_word", row.normalized_word);
    }
    await admin.from("generated_study_sessions").insert({ user_id: user.id, user_language_id: userLanguageId, title: content.title || "Generated study session", selected_words: selectedWords, content_json: content });
    return new Response(JSON.stringify(content), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
