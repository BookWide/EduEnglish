// ====== BookWide Supabase Helper (single mobile + single desktop) ======
// 手機 1 台 + 桌機 1 台
// 同類型新登入 -> 舊裝置強制登出

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/* ========= Project (public anon) ========= */
export const SUPABASE_URL = 'https://jeajrwpmrgczimmrflxo.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplYWpyd3BtcmdjemltbXJmbHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA3MTg5MzksImV4cCI6MjA3NjI5NDkzOX0.3iFXdHH0JEuk177_R4TGFJmOxYK9V8XctON6rDe7-Do';

/* ========= Client (singleton) ========= */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/* ========= device helpers ========= */
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
  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
    window.innerWidth <= 900;
  return isMobile ? 'mobile' : 'desktop';
}

function getRootBase() {
  return (
    location.pathname.startsWith('/EduEnglish') ||
    location.hostname.includes('github.io')
  ) ? '/EduEnglish' : '';
}

function getLoginUrl(reason = 'kick') {
  const root = getRootBase();
  if (reason === 'timeout') return `${root}/index.html?timeout=1#login`;
  return `${root}/index.html?kick=1#login`;
}

async function forceLogout(redirect = getLoginUrl('kick')) {
  try {
    localStorage.setItem('bw_forced_logout', '1');
  } catch (_) {}

  try {
    await supabase.auth.signOut();
  } catch (_) {}

  location.href = redirect;
}

// 清掉舊 debug 殘留
try {
  localStorage.removeItem('bw_kick_detected');
} catch (_) {}

export const BW = {
  supa: supabase,

  async getUser() {
    const { data } = await supabase.auth.getUser();
    return data?.user ?? null;
  },

  async requireAdmin(redirect = '/index.html?noadmin=1') {
    const user = await this.getUser();
    if (!user) {
      location.href = '/index.html#login';
      throw new Error('not logged in');
    }

    const r = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();

    if (r.error) {
      console.warn('requireAdmin profiles read error', r.error);
      location.href = redirect;
      throw r.error;
    }

    if (!r.data?.is_admin) {
      location.href = redirect;
      throw new Error('not admin');
    }

    return true;
  },

  async isAdmin() {
    const user = await this.getUser();
    if (!user) return false;

    const r = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();

    return !!r.data?.is_admin;
  },

  isOnlineWithin(ts, minutes = 10) {
    if (!ts) return false;
    const d = new Date(ts);
    if (isNaN(d)) return false;
    return (Date.now() - d.getTime()) <= minutes * 60 * 1000;
  },

  async markCurrentDevice() {
    const user = await this.getUser();
    if (!user) return;

    const isAdmin = await this.isAdmin();
    if (isAdmin) return; // admin 不受限制

    const deviceId = getDeviceId();
    const deviceType = getDeviceType();

    const payload = {
      last_seen_at: new Date().toISOString(),
    };

    if (deviceType === 'mobile') {
      payload.current_mobile_device_id = deviceId;
    } else {
      payload.current_desktop_device_id = deviceId;
    }

    const r = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', user.id);

    if (r.error) console.warn('markCurrentDevice error', r.error);
  },

  async guardCurrentDeviceNow() {
    const user = await this.getUser();
    if (!user) return true;

    const isAdmin = await this.isAdmin();
    if (isAdmin) return true; // admin 不受限制

    const myDevice = getDeviceId();
    const deviceType = getDeviceType();

    const r = await supabase
      .from('profiles')
      .select('current_mobile_device_id,current_desktop_device_id')
      .eq('id', user.id)
      .maybeSingle();

    if (r.error) {
      console.warn('guardCurrentDeviceNow read error', r.error);
      return true;
    }

    const currentId =
      deviceType === 'mobile'
        ? r.data?.current_mobile_device_id
        : r.data?.current_desktop_device_id;

    if (currentId && currentId !== myDevice) {
      console.warn('[BW] device replaced -> force logout');
      await forceLogout(getLoginUrl('kick'));
      return false;
    }

    return true;
  },

  startHeartbeat(minutes = 2) {
    if (typeof window !== 'undefined' && window.__BW_HEARTBEAT__) {
      clearInterval(window.__BW_HEARTBEAT__);
    }
    let running = false;
    const myDevice = getDeviceId();
    const deviceType = getDeviceType();

    const beat = async () => {
      if (running) return;
      running = true;

      try {
        const user = await this.getUser();
        if (!user) return;

        const isAdmin = await this.isAdmin();
        if (isAdmin) return; // admin 不受限制

        const r = await supabase
          .from('profiles')
          .select('current_mobile_device_id,current_desktop_device_id')
          .eq('id', user.id)
          .maybeSingle();

        if (r.error) {
          console.warn('heartbeat profiles read error', r.error);
          return;
        }

        const currentId =
          deviceType === 'mobile'
            ? r.data?.current_mobile_device_id
            : r.data?.current_desktop_device_id;

        if (currentId && currentId !== myDevice) {
          console.warn('[BW] device mismatch -> force logout');
          await forceLogout(getLoginUrl('kick'));
          return;
        }

        const updatePayload = {
          last_seen_at: new Date().toISOString(),
        };

        if (deviceType === 'mobile') {
          updatePayload.current_mobile_device_id = myDevice;
        } else {
          updatePayload.current_desktop_device_id = myDevice;
        }

        const u = await supabase
          .from('profiles')
          .update(updatePayload)
          .eq('id', user.id);

        if (u.error) console.warn('heartbeat update error', u.error);
      } finally {
        running = false;
      }
    };

    beat();
    const timer = setInterval(beat, Math.max(1, minutes) * 60 * 1000);
    if (typeof window !== 'undefined') window.__BW_HEARTBEAT__ = timer;
    return timer;
  },

  popForcedLogoutHint() {
    if (localStorage.getItem('bw_forced_logout') === '1') {
      localStorage.removeItem('bw_forced_logout');
      alert('此帳號同類型裝置已在另一台登入，您已被強制登出');
    }
  },

  startIdleLogout(minutes = 30, redirect = getLoginUrl('timeout')) {
    const ms = minutes * 60 * 1000;

    if (typeof window !== 'undefined' && window.__BW_IDLE_RESET__) {
      ['click', 'mousemove', 'keydown', 'touchstart', 'scroll'].forEach(evt =>
        window.removeEventListener(evt, window.__BW_IDLE_RESET__)
      );
    }

    if (typeof window !== 'undefined' && window.__BW_IDLE_TIMER__) {
      clearTimeout(window.__BW_IDLE_TIMER__);
    }

    const reset = () => {
      if (typeof window !== 'undefined' && window.__BW_IDLE_TIMER__) {
        clearTimeout(window.__BW_IDLE_TIMER__);
      }
      const timer = setTimeout(async () => {
        try {
          await supabase.auth.signOut();
        } catch (_) {}
        location.href = redirect;
      }, ms);
      if (typeof window !== 'undefined') window.__BW_IDLE_TIMER__ = timer;
    };

    ['click', 'mousemove', 'keydown', 'touchstart', 'scroll'].forEach(evt =>
      window.addEventListener(evt, reset, { passive: true })
    );

    if (typeof window !== 'undefined') window.__BW_IDLE_RESET__ = reset;
    reset();
  },
};

if (typeof window !== 'undefined') {
  window.BW = window.BW || BW;
}

supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN' && session?.user) {
    await BW.markCurrentDevice();
    await BW.guardCurrentDeviceNow();
    BW.startHeartbeat(2);
  }

  if (event === 'INITIAL_SESSION' && session?.user) {
    await BW.guardCurrentDeviceNow();
    BW.startHeartbeat(2);
  }
});

(async () => {
  BW.popForcedLogoutHint();

  const user = await BW.getUser();
  if (user) {
    const ok = await BW.guardCurrentDeviceNow();
    if (ok) {
      await BW.markCurrentDevice();
      BW.startHeartbeat(2);
    }
  }
})();







