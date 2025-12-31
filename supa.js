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

  // global signOut (cleaner across tabs/devices) with fallback
  async _signOutGlobal() {
    try { await supabase.auth.signOut({ scope: 'global' }); }
    catch(_){ try { await BW._signOutGlobal(); } catch(__){} }
  },

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

  startHeartbeat(minutes = 0.25, opts = {}) {
    // Stable guard:
    // - last-login-wins: we try to claim device on load
    // - never "instant-kick" on a single mismatch read
    // - only kick when we *cannot* reclaim twice in a row AND reclaim is not blocked
    const myDevice = getDeviceId();
    const intervalMs = Math.max(5, minutes * 60) * 1000;
    const strikesKey = 'bw_device_strikes';
    const maxStrikesToKick = 2;

    let running = false;

    const beat = async () => {
      if (running) return;
      running = true;
      try {
        const user = await this.getUser();
        if (!user) return;

        // read current holder
        const r = await supabase
          .from('profiles')
          .select('current_device_id')
          .eq('id', user.id)
          .maybeSingle();

        if (r.error) {
          console.warn('[BW] heartbeat profiles read error', r.error);
          return;
        }

        const cur = r.data?.current_device_id || null;

        if (cur && cur !== myDevice) {
          // try to reclaim (last-login-wins)
          const strikes = parseInt(localStorage.getItem(strikesKey) || '0', 10);

          const claim = await supabase
            .from('profiles')
            .update({
              current_device_id: myDevice,
              last_seen_at: new Date().toISOString(),
            })
            .eq('id', user.id)
            .select('current_device_id')
            .maybeSingle();

          if (claim.error) {
            // If blocked (RLS) or transient error: do NOT kick (prevents "1-second kick" loop)
            console.warn('[BW] heartbeat reclaim blocked', claim.error);
            localStorage.setItem(strikesKey, String(Math.min(strikes + 1, 9)));
            return;
          }

          if (claim.data?.current_device_id === myDevice) {
            // reclaimed successfully
            localStorage.removeItem(strikesKey);
            return;
          }

          // not reclaimed
          const nextStrikes = strikes + 1;
          localStorage.setItem(strikesKey, String(Math.min(nextStrikes, 9)));

          if (nextStrikes >= maxStrikesToKick) {
            localStorage.setItem('bw_forced_logout', '1');
            await BW._signOutGlobal();
            // redirect to login to avoid being mis-sent to pricing(noactive)
            const next = encodeURIComponent(location.pathname + location.search);
            location.href = `/login.html?kick=1&next=${next}`;
            return;
          }
          return;
        }

        // normal heartbeat update
        const u = await supabase
          .from('profiles')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', user.id);

        if (u.error) console.warn('[BW] heartbeat update error', u.error);
        localStorage.removeItem(strikesKey);
      } finally {
        running = false;
      }
    };

    beat();
    return setInterval(beat, intervalMs);
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
        await BW._signOutGlobal();
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
  if (!user) return;
  // claim on page load (last-login-wins)
  try { await BW.markCurrentDevice(); } catch(e) { console.warn('[BW] markCurrentDevice init error', e); }
  BW.startHeartbeat(0.25);
})();








