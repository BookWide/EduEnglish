// ====== BookWide Supabase Helper ======
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jeajrwpmrgczimmrflxo.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplYWpyd3BtcmdjemltbXJmbHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA3MTg5MzksImV4cCI6MjA3NjI5NDkzOX0.3iFXdHH0JEuk177_R4TGFJmOxYK9V8XctON6rDe7-Do';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// ====== 封裝公用函式 ======
export const BW = {
  supa: supabase,

  async getUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data?.user ?? null;
  },

  async requireAdmin() {
    const user = await this.getUser();
    if (!user) {
      location.href = './index.html?denied=signin';
      return;
    }
    const { data, error } = await supabase.from('profiles')
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

  startHeartbeat(minutes = 2) {
    let ticking = false;
    const beat = async () => {
      if (ticking) return;
      ticking = true;
      try {
        const user = await this.getUser();
        if (!user) return;
        await supabase.from('profiles')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', user.id);
      } finally {
        ticking = false;
      }
    };
    beat();
    const ms = Math.max(1, minutes) * 60 * 1000;
    return setInterval(beat, ms);
  },

  fmtTW(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(d);
  },

  isOnlineWithin(iso, minutes = 10) {
    if (!iso) return false;
    const last = Date.parse(iso);
    const now = Date.now();
    return (now - last) <= minutes * 60 * 1000;
  },

  async fetchProfiles() {
    const cols = 'id,email,display_name,is_admin,last_sign_in_at,last_seen_at,expires_at';
    const { data, error } = await supabase.from('profiles').select(cols).order('email', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }
};

// ====== 自動啟動心跳 ======
(async () => {
  const user = await BW.getUser();
  if (user) {
    BW.startHeartbeat(2);
    console.log(`[BookWide] heartbeat started for ${user.email}`);
  }
})();

