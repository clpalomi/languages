// Single shared Supabase client
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './constants.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
if (typeof window !== 'undefined') window.supabase = supabase; // ← add this
