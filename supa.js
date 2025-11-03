// ====== BookWide Supabase helper (supa.js) ======
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ★ 用你的專案設定（你提供的）
const SUPABASE_URL = 'https://jeajrwpmrgczimmrflxo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplYWpyd3BtcmdjemltbXJmbHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA3MTg5MzksImV4cCI6MjA3NjI5NDkzOX0.3iFXdHH0JEuk177_R4TGFJmOxYK9V8XctON6rDe7-Do';

// 建立唯一 client
const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const BW = (window.BW ??= {});
BW.supa = supa;

/** 取得登入使用者（無則回 null） */
BW.getUser = async () => {
  const { data, error } = await supa.auth.getUser();
  if (error) return null;
  return data?.user ?? null;
};

/** 進 admin 前必檢查：已登入且 profiles.is_admin = true，否則導回 index.html */
BW.requireAdmin = async () => {
  const user = await BW.getUser();
  if (!user) {
    location.href = './index.html?denied=signin';
    return false;
  }
  const { data, error } = await supa.from('profiles')
    .select('id,is_admin,is_paused')
    .eq('id', user.id)
    .maybeSingle();

  if (error || !data) { location.href = './index.html?denied=profile'; return false; }
  if (!data.is_admin)  { location.href = './index.html?denied=notadmin'; return false; }
  if (data.is_paused)  { location.href = './index.html?denied=paused';   return false; }
  return true;
};

/** 啟動心跳：每 N 分鐘更新自己 profiles.last_seen_at（台灣無 DST，+8 OK） */
BW.startHeartbeat = (minutes = 2) => {
  let ticking = false;
  const beat = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const user = await BW.getUser();
      if (!user) return;
      await supa.from('profiles')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', user.id);
    } finally {
      ticking = false;
    }
  };
  beat();
  const ms = Math.max(1, minutes) * 60 * 1000;
  return setInterval(beat, ms);
};

/** 小工具：把 ISO 轉台灣時間字串 */
BW.fmtTW = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(d);
};

/** 小工具：是否在 N 分鐘內在線（用 last_seen_at 判斷） */
BW.isOnlineWithin = (iso, minutes = 10) => {
  if (!iso) return false;
  const last = Date.parse(iso);
  const now  = Date.now();
  return (now - last) <= minutes * 60 * 1000;
};

/** 讀取 profiles（給 admin 列表） */
BW.fetchProfiles = async () => {
  const cols = 'id,email,display_name,is_admin,is_paused,is_suspended,last_sign_in_at,last_seen_at,expires_at';
  const { data, error } = await supa.from('profiles').select(cols).order('email', { ascending: true });
  if (error) throw error;
  return data ?? [];
};

export { BW };

// ====== 自動心跳（所有登入頁都會啟動） ======
(async () => {
  const user = await BW.getUser();
  if (user) {
    console.log(`[BookWide] 自動啟動心跳 for ${user.email}`);
    BW.startHeartbeat(2); // 每 2 分鐘更新 last_seen_at
  }
})();
