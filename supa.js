// ===== BookWide Supabase Helper =====
// supa.js  v20251227-single-device-stable
// - 單一 Supabase client（嚴禁重複 createClient）
// - 心跳 last_seen_at
// - 單帳號單裝置限制（不靠 view、不靠 localStorage）

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ===== Supabase Project =====
const SUPABASE_URL = 'https://jeajrwpmrgczimmrflxo.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplYWpyd3BtcmdjemltbXJmbHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA3MTg5MzksImV4cCI6MjA3NjI5NDkzOX0.3iFXdHH0JEuk177_R4TGFJmOxYK9V8XctON6rDe7-Do';

// ===== Singleton Client =====
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// ===== BookWide Helper =====
export const BW = {
  supa: supabase,

  // 取得目前使用者
  async getUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data?.user ?? null;
  },

  // ===== 單帳號單裝置限制 =====
  async enforceSingleDeviceLock(minutes = 3) {
    const user = await this.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('profiles')
      .select('last_seen_at')
      .eq('id', user.id)
      .maybeSingle();

    if (error || !data?.last_seen_at) return;

    const diff = Date.now() - Date.parse(data.last_seen_at);
    if (diff < minutes * 60 * 1000) {
      alert('此帳號正在其他裝置使用中，已限制登入');
      await supabase.auth.signOut();
      location.href = '/index.html?denied=multi-device';
      throw new Error('multi-device-lock');
    }
  },

  // ===== 心跳：宣告「我在用」=====
  startHeartbeat(minutes = 2) {
    let busy = false;

    const beat = async () => {
      if (busy) return;
      busy = true;
      try {
        const user = await this.getUser();
        if (!user) return;

        await supabase
          .from('profiles')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', user.id);
      } finally {
        busy = false;
      }
    };

    beat();
    return setInterval(beat, Math.max(1, minutes) * 60 * 1000);
  },

  // ===== 管理員頁限制 =====
  async requireAdmin() {
    const user = await this.getUser();
    if (!user) {
      location.href = '/admin.html?denied=signin';
      return;
    }

    const { data } = await supabase
      .from('profiles')
      .select('is_admin,is_paused')
      .eq('id', user.id)
      .maybeSingle();

    if (!data?.is_admin || data.is_paused) {
      location.href = '/admin.html?denied=notadmin';
      return;
    }
    return true;
  },

  // ===== 時間顯示（台北）=====
  fmtTW(iso) {
    if (!iso) return '—';
    return new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  },
};

// ===== 掛到 window（舊頁相容）=====
if (typeof window !== 'undefined') {
  window.BW = BW;
}

// ===== 自動心跳（登入後）=====
(async () => {
  try {
    const user = await BW.getUser();
    if (user) {
      BW.startHeartbeat(2);
      console.log(`[BookWide] heartbeat started for ${user.email}`);
    }
  } catch {}
})();






