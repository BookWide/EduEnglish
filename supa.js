// ====== BookWide Supabase Helper (merged export + global) ======
// v20251228-device-fix2
// - 修正 SyntaxError：把 ANON KEY 改成「單行純字串」(不可換行、不可少引號)

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

/* ========= device id ========= */
function getDeviceId() {
  let id = localStorage.getItem('bw_device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('bw_device_id', id);
  }
  return id;
}

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

  isOnlineWithin(ts, minutes = 10) {
    if (!ts) return false;
    const d = new Date(ts);
    if (isNaN(d)) return false;
    return (Date.now() - d.getTime()) <= minutes * 60 * 1000;
  },

  async markCurrentDevice() {
    const user = await this.getUser();
    if (!user) return;

    const deviceId = getDeviceId();
    const r = await supabase
      .from('profiles')
      .update({
        current_device_id: deviceId,
        last_seen_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (r.error) console.warn('markCurrentDevice error', r.error);
  },

  startHeartbeat(minutes = 2) {
    let running = false;
    const myDevice = getDeviceId();

    const beat = async () => {
      if (running) return;
      running = true;
      try {
        const user = await this.getUser();
        if (!user) return;

        const r = await supabase
          .from('profiles')
          .select('current_device_id')
          .eq('id', user.id)
          .maybeSingle();

        if (r.error) {
          console.warn('heartbeat profiles read error', r.error);
          return;
        }

        if (r.data?.current_device_id && r.data.current_device_id !== myDevice) {
          localStorage.setItem('bw_forced_logout', '1');

          // ✅ Global sign-out (invalidate refresh token too)
          try { await supabase.auth.signOut({ scope: 'global' }); }
          catch (_) { try { await supabase.auth.signOut(); } catch (__){ } }

          // ✅ Redirect to login (avoid being bounced to pricing by player subscription check)
          const next = encodeURIComponent(location.pathname + location.search);
          location.href = `/login.html?kick=1&next=${next}`;
          return;
        }

        const u = await supabase
          .from('profiles')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', user.id);

        if (u.error) console.warn('heartbeat update error', u.error);
      } finally {
        running = false;
      }
    };

    beat();
    return setInterval(beat, Math.max(1, minutes) * 60 * 1000);
  },

  popForcedLogoutHint() {
    if (localStorage.getItem('bw_forced_logout') === '1') {
      localStorage.removeItem('bw_forced_logout');
      alert('此帳號已在另一個裝置登入，您已被登出');
    }
  },

  startIdleLogout(minutes = 30, redirect = '/login.html?timeout=1') {
    const ms = minutes * 60 * 1000;
    let timer;

    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try { await supabase.auth.signOut({ scope: 'global' }); }
        catch (_) { try { await supabase.auth.signOut(); } catch (__){ } }
        location.href = redirect;
      }, ms);
    };

    ['click', 'mousemove', 'keydown', 'touchstart', 'scroll']
      .forEach(evt => window.addEventListener(evt, reset, { passive: true }));

    reset();
  },
};

if (typeof window !== 'undefined') {
  window.BW = window.BW || BW;
}

supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN' && session?.user) {
    await BW.markCurrentDevice();
    BW.startHeartbeat(2);
  }
});

(async () => {
  const user = await BW.getUser();
  if (user) BW.startHeartbeat(2);
})();







