// supa.js  (ESM 版本，無 IIFE)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = 'https://jeajrwpmrgczimmrflxo.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplYWpyd3BtcmdjemltbXJmbHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA3MTg5MzksImV4cCI6MjA3NjI5NDkzOX0.3iFXdHH0JEuk177_R4TGFJmOxYK9V8XctON6rDe7-Do'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)






