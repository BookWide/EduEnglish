// ====== BookWide Supabase Helper ======
// ✅ 一手機 + 一桌機 限制版（正式守門）

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://jeajrwpmrgczimmrflxo.supabase.co';
export const SUPABASE_ANON_KEY = '你的anon key';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/* ========= 裝置 ========= */

function getDeviceId() {
  let id = localStorage.getItem('bw_device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('bw_device_id', id);
  }
  return id;
}

function getDeviceType() {
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|Mobile/i.test(ua) ? 'mobile' : 'desktop';
}

function getDeviceColumn(type) {
  return type === 'mobile'
    ? 'current_mobile_device_id'
    : 'current_desktop_device_id';
}

/* ========= 核心 ========= */

export const BW = {
  supa: supabase,

  async getUser() {
    const { data } = await supabase.auth.getUser();
    return data?.user || null;
  },

  async markCurrentDevice() {
    const user = await this.getUser();
    if (!user) return;

    const deviceId = getDeviceId();
    const type = getDeviceType();
    const col = getDeviceColumn(type);

    const payload = {
      last_seen_at: new Date().toISOString(),
    };
    payload[col] = deviceId;

    await supabase
      .from('profiles')
      .update(payload)
      .eq('id', user.id);
  },

  async forceLogout() {
    try { localStorage.setItem('bw_kicked', '1'); } catch(e){}
    await supabase.auth.signOut();
    location.href = '/login.html?kick=1';
  },

  startHeartbeat(min = 2) {
    let running = false;
    const myId = getDeviceId();
    const type = getDeviceType();
    const col = getDeviceColumn(type);

    const beat = async () => {
      if (running) return;
      running = true;

      try {
        const user = await this.getUser();
        if (!user) return;

        const { data } = await supabase
          .from('profiles')
          .select(col)
          .eq('id', user.id)
          .single();

        const current = data?.[col];

        // ❗ 核心：裝置被換掉 → 強制登出
        if (current && current !== myId) {
          console.warn('被其他裝置取代 → 強制登出');
          await this.forceLogout();
          return;
        }

        // heartbeat 更新
        await supabase
          .from('profiles')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', user.id);

      } catch (e) {
        console.error('heartbeat error', e);
      } finally {
        running = false;
      }
    };

    beat();
    return setInterval(beat, min * 60 * 1000);
  },

  showKickMsg() {
    if (localStorage.getItem('bw_kicked') === '1') {
      localStorage.removeItem('bw_kicked');
      alert('此帳號已在其他裝置登入');
    }
  }
};

/* ========= 自動啟動 ========= */

supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN' && session?.user) {
    await BW.markCurrentDevice();
    BW.startHeartbeat(1);
  }
});

(async () => {
  BW.showKickMsg();

  const user = await BW.getUser();
  if (user) {
    await BW.markCurrentDevice();
    BW.startHeartbeat(1);
  }
})();








