// ====== BookWide Supabase Helper (guard final single core) ======
// 一般會員：手機 1 台 + 桌機 1 台
// admin：不受裝置限制
// 閒置 30 分鐘自動登出（由各頁啟動）

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://jeajrwpmrgczimmrflxo.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplYWpyd3BtcmdjemltbXJmbHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA3MTg5MzksImV4cCI6MjA3NjI5NDkzOX0.3iFXdHH0JEuk177_R4TGFJmOxYK9V8XctON6rDe7-Do';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

function getRootBase() {
  return (
    location.pathname.startsWith('/EduEnglish') ||
    location.hostname.includes('github.io')
  ) ? '/EduEnglish' : '';
}

function defaultIndexUrl(extra = '') {
  return `${getRootBase()}/index.html${extra}`;
}

function getDeviceId() {
  let id = localStorage.getItem('bw_device_id');
  if (!id) {
    id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
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

async function forceLogout(redirect = defaultIndexUrl('?kick=1')) {
  try { localStorage.setItem('bw_forced_logout', '1'); } catch (_) {}
  try { await supabase.auth.signOut(); } catch (_) {}
  location.href = redirect;
}

try { localStorage.removeItem('bw_kick_detected'); } catch (_) {}

export const BW = {
  supa: supabase,
  _profileCache: null,
  _profileCacheAt: 0,
  _heartbeatTimer: null,
  _idleTimer: null,
  _pageGuardPromise: null,
  _pageGuardDone: false,

  async getUser() {
    const { data } = await supabase.auth.getUser();
    return data?.user ?? null;
  },

  async getProfile(force = false) {
    const user = await this.getUser();
    if (!user) return null;

    const now = Date.now();
    if (!force && this._profileCache && (now - this._profileCacheAt) < 5000) {
      return this._profileCache;
    }

    const r = await supabase
      .from('profiles')
      .select('is_admin,current_mobile_device_id,current_desktop_device_id,last_seen_at')
      .eq('id', user.id)
      .maybeSingle();

    if (r.error) {
      console.warn('[BW] getProfile error', r.error);
      return this._profileCache;
    }

    this._profileCache = r.data || null;
    this._profileCacheAt = now;
    return this._profileCache;
  },

  clearProfileCache() {
    this._profileCache = null;
    this._profileCacheAt = 0;
  },

  async requireAdmin(redirect = defaultIndexUrl('?noadmin=1')) {
    const user = await this.getUser();
    if (!user) {
      location.href = defaultIndexUrl('#login');
      throw new Error('not logged in');
    }

    const profile = await this.getProfile(true);
    if (!profile?.is_admin) {
      location.href = redirect;
      throw new Error('not admin');
    }

    return true;
  },

  async isAdmin() {
    const profile = await this.getProfile();
    return !!profile?.is_admin;
  },

  async markCurrentDevice() {
    const user = await this.getUser();
    if (!user) return true;

    if (await this.isAdmin()) return true;

    const deviceId = getDeviceId();
    const deviceType = getDeviceType();
    const payload = { last_seen_at: new Date().toISOString() };

    if (deviceType === 'mobile') {
      payload.current_mobile_device_id = deviceId;
    } else {
      payload.current_desktop_device_id = deviceId;
    }

    const r = await supabase.from('profiles').update(payload).eq('id', user.id);
    if (r.error) {
      console.warn('[BW] markCurrentDevice error', r.error);
      return false;
    }

    this.clearProfileCache();
    return true;
  },

  async guardCurrentDeviceNow(redirect = defaultIndexUrl('?kick=1')) {
    const user = await this.getUser();
    if (!user) return true;

    const profile = await this.getProfile(true);
    if (!profile) return true;
    if (profile.is_admin) return true;

    const myDevice = getDeviceId();
    const currentId = getDeviceType() === 'mobile'
      ? profile.current_mobile_device_id
      : profile.current_desktop_device_id;

    if (currentId && currentId !== myDevice) {
      console.warn('[BW] device replaced -> force logout');
      await forceLogout(redirect);
      return false;
    }

    return true;
  },

  startHeartbeat(minutes = 2, redirect = defaultIndexUrl('?kick=1')) {
    clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;

    const intervalMs = Math.max(1, minutes) * 60 * 1000;
    let running = false;

    const beat = async () => {
      if (running) return;
      running = true;
      try {
        const user = await this.getUser();
        if (!user) return;
        if (await this.isAdmin()) return;

        const ok = await this.guardCurrentDeviceNow(redirect);
        if (!ok) return;

        await this.markCurrentDevice();
      } finally {
        running = false;
      }
    };

    beat();
    this._heartbeatTimer = setInterval(beat, intervalMs);
    return this._heartbeatTimer;
  },

  stopHeartbeat() {
    clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;
  },

  popForcedLogoutHint() {
    try {
      if (localStorage.getItem('bw_forced_logout') === '1') {
        localStorage.removeItem('bw_forced_logout');
        alert('此帳號同類型裝置已在另一台登入，您已被強制登出');
      }
    } catch (_) {}
  },

  startIdleLogout(minutes = 30, redirect = defaultIndexUrl('?timeout=1')) {
    const ms = Math.max(1, minutes) * 60 * 1000;
    clearTimeout(this._idleTimer);

    const reset = () => {
      clearTimeout(this._idleTimer);
      this._idleTimer = setTimeout(async () => {
        try { await supabase.auth.signOut(); } catch (_) {}
        location.href = redirect;
      }, ms);
    };

    if (!window.__BW_IDLE_EVENTS_BOUND__) {
      ['click', 'mousemove', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
        window.addEventListener(evt, reset, { passive: true });
      });
      window.__BW_IDLE_EVENTS_BOUND__ = true;
      window.__BW_IDLE_RESET__ = reset;
    } else {
      window.__BW_IDLE_RESET__ = reset;
    }

    reset();
  },

  async initPageGuard(options = {}) {
    if (this._pageGuardDone) return true;
    if (this._pageGuardPromise) return this._pageGuardPromise;

    const idleMinutes = options.idleMinutes ?? 30;
    const heartbeatMinutes = options.heartbeatMinutes ?? 2;
    const kickRedirect = options.kickRedirect ?? defaultIndexUrl('?kick=1');
    const timeoutRedirect = options.timeoutRedirect ?? defaultIndexUrl('?timeout=1');

    this._pageGuardPromise = (async () => {
      this.popForcedLogoutHint();

      const user = await this.getUser();
      if (!user) {
        this.startIdleLogout(idleMinutes, timeoutRedirect);
        this._pageGuardDone = true;
        return false;
      }

      const ok = await this.guardCurrentDeviceNow(kickRedirect);
      if (!ok) return false;

      await this.markCurrentDevice();
      this.startHeartbeat(heartbeatMinutes, kickRedirect);
      this.startIdleLogout(idleMinutes, timeoutRedirect);
      this._pageGuardDone = true;
      return true;
    })();

    try {
      return await this._pageGuardPromise;
    } finally {
      this._pageGuardPromise = null;
    }
  },
};

if (typeof window !== 'undefined') {
  window.BW = window.BW || BW;
  window.supa = window.supa || supabase;
}

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    BW.stopHeartbeat();
    BW.clearProfileCache();
    BW._pageGuardDone = false;
  }
});
