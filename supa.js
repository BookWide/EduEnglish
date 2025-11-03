// ====== BookWide Supabase Helper (merged export + global) ======
// v20251104-merge
// - Exports { supabase, BW } for ESM imports
// - Also attaches window.BW for legacy inline usage
// - Auto heartbeat when user is signed in

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---- Project keys (public anon) ----
const SUPABASE_URL = 'https://jeajrwpmrgczimmrflxo.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplYWpyd3BtcmdjemltbXJmbHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA3MTg5MzksImV4cCI6MjA3NjI5NDkzOX0.3iFXdHH0JEuk177_R4TGFJmOxYK9V8XctON6rDe7-Do';

// ---- Client (singleton) ----
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// ---- Utilities ----
export const BW = {
  supa: supabase,

  /** Return current signed-in user or null */
  async getUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data?.user ?? null;
  },

  /** Guard for admin-only page */
  async requireAdmin() {
    const user = await this.getUser();
    if (!user) {
      location.href = './index.html?denied=signin';
      return;
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('id,is_admin,is_paused')
      .eq('id', user.id)
      .maybeSingle();

    if (error || !data) {
      location.href = './index.html?denied=profile';
      return;
    }
    if (!data.is_admin) {
      location.href = './index.html?denied=notadmin';
      return;
    }
    if (data.is_paused) {
      location.href = './index.html?denied=paused';
      return;
    }
    return true;
  },

  /** Start heartbeat: update profiles.last_seen_at every N minutes */
  startHeartbeat(minutes = 2) {
    let ticking = false;
    const beat = async () => {
      if (ticking) return;
      ticking = true;
      try {
        const user = await this.getUser();
        if (!user) return;
        await supabase
          .from('profiles')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', user.id);
      } finally {
        ticking = false;
      }
    };
    // fire immediately then interval
    beat();
    const ms = Math.max(1, minutes) * 60 * 1000;
    return setInterval(beat, ms);
  },

  /** Format ISO string in Asia/Taipei */
  fmtTW(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);
  },

  /** Is online within N minutes */
  isOnlineWithin(iso, minutes = 10) {
    if (!iso) return false;
    const last = Date.parse(iso); // UTC ms
    return Date.now() - last <= minutes * 60 * 1000;
  },

  /** Fetch profiles for admin list */
  async fetchProfiles() {
    const cols =
      'id,email,display_name,is_admin,last_sign_in_at,last_seen_at,expires_at,is_paused,is_suspended';
    const { data, error } = await supabase
      .from('profiles')
      .select(cols)
      .order('email', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },
};

// ---- Legacy global (optional) ----
if (typeof window !== 'undefined') {
  window.BW = window.BW || BW;
}

// ---- Auto-heartbeat when user exists ----
(async () => {
  try {
    const user = await BW.getUser();
    if (user) {
      BW.startHeartbeat(2);
      console.log(`[BookWide] heartbeat started for ${user.email}`);
    }
  } catch {
    // ignore
  }
})();


