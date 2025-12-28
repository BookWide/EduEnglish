// ====== BookWide Supabase Helper (merged export + global) ======
// v20251228-device
// - 保留原本功能
// - 補：單一裝置登入（current_device_id）
// - 舊裝置自動登出 + 提示旗標

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---- Project keys (public anon) ----
const SUPABASE_URL = 'https://jeajrwpmrgczimmrflxo.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'; // ← 你原本那串 그대로

// ---- Client (singleton) ----
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/* ========= device id ========= */
function getDeviceId() {
  let id = localStorage.getItem('bw_device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('bw_device_id', id);
  }
  return id;
}

// ---- Utilities ----
export const BW = {
  supa: supabase,

  async getUser() {
    const { data } = await supabase.auth.getUser();
    return data?.user ?? null;
  },

  /* ===== 登入後呼叫：覆蓋目前裝置 ===== */
  async markCurrentDevice() {
    const user = await this.getUser();
    if (!user) return;

    const deviceId = getDeviceId();
    await supabase
      .from('profiles')
      .update({
        current_device_id: deviceId,
        last_seen_at: new Date().toISOString(),
      })
      .eq('id', user.id);
  },

  /* ===== 心跳（含單一裝置檢查） ===== */
  startHeartbeat(minutes = 2) {
    let running = false;
    const myDevice = getDeviceId();

    const beat = async () => {
      if (running) return;
      running = true;
      try {
        const user = await this.getUser();
        if (!user) return;

        const { data } = await supabase
          .from('profiles')
          .select('current_device_id')
          .eq('id', user.id)
          .maybeSingle();

        if (data?.current_device_id && data.current_device_id !== myDevice) {
          // 被新裝置踢
          localStorage.setItem('bw_forced_logout', '1');
          await supabase.auth.signOut();
          return;
        }

        await supabase
          .from('profiles')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', user.id);
      } finally {
        running = false;
      }
    };

    beat();
    return setInterval(beat, Math.max(1, minutes) * 60 * 1000);
  },

  /* ===== 被踢提示（index 用） ===== */
  popForcedLogoutHint() {
    if (localStorage.getItem('bw_forced_logout') === '1') {
      localStorage.removeItem('bw_forced_logout');
      alert('此帳號已在另一個裝置登入，您已被登出');
    }
  },

  /* ===== 閒置自動登出（player 用） ===== */
  startIdleLogout(minutes = 30, redirect = '/login.html?timeout=1') {
    const ms = minutes * 60 * 1000;
    let timer;

    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        await supabase.auth.signOut();
        location.href = redirect;
      }, ms);
    };

    ['click', 'mousemove', 'keydown', 'touchstart', 'scroll']
      .forEach(evt => window.addEventListener(evt, reset, { passive: true }));

    reset();
  },
};

// ---- Legacy global ----
if (typeof window !== 'undefined') {
  window.BW = window.BW || BW;
}

// ---- Auto heartbeat ----
(async () => {
  const user = await BW.getUser();
  if (user) BW.startHeartbeat(2);
})();







