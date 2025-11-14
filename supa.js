// ====== BookWide Supabase Helper (merged export + global) ======
// v20251115-guard-fix
// - Exports { supabase, BW } for ESM imports (for <script type="module">)
// - Also attaches window.BW / ensureAuth / getSessionUser for legacy inline usage
// - Light heartbeat when user is signed in

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---- Project keys (public anon) ----
const SUPABASE_URL = 'https://jeajrwpmrgczimmrflxo.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs...CI6MjA3NjI5NDkzOX0.3iFXdHH0JEuk177_R4TGFJmOxYK9V8XctON6rDe7-Do';

// ---- Client (singleton) ----
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// ---- Utilities (ESM + global) ----
export const BW = {
  supa: supabase,

  /** 取得目前登入者（沒有就回傳 null） */
  async getUser() {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) return null;
      return data?.user ?? null;
    } catch {
      return null;
    }
  },

  /**
   * 一般「需要登入」守門
   * options.redirect   : 未登入轉去的頁面（預設 /EduEnglish/index.html）
   * options.next       : 登入完成後要回來的網址（預設目前網址）
   */
  async requireLogin(options = {}) {
    const redirect = options.redirect || '/EduEnglish/index.html';
    const next =
      options.next ||
      (typeof window !== 'undefined'
        ? window.location.pathname + window.location.search
        : '');

    const user = await this.getUser();
    if (user) return user;

    if (typeof window !== 'undefined') {
      const base = redirect || '/EduEnglish/index.html';
      const hasQuery = base.includes('?');
      const url =
        base + (next ? (hasQuery ? '&' : '?') + 'next=' + encodeURIComponent(next) : '');
      window.location.href = url;
    }
    return null;
  },

  /**
   * 管理員守門（admin 主控台用）
   * profiles 表需有 is_admin:boolean
   */
  async requireAdmin(options = {}) {
    const redirectIfNoUser = options.redirectIfNoUser !== false;
    const redirectNonAdmin = options.redirectNonAdmin || '/EduEnglish/index.html';

    const user = await this.getUser();
    if (!user) {
      if (redirectIfNoUser && typeof window !== 'undefined') {
        window.location.href = redirectNonAdmin;
      }
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .maybeSingle();

      const isAdmin = !!data?.is_admin && !error;
      if (!isAdmin && typeof window !== 'undefined') {
        window.location.href = redirectNonAdmin;
        return null;
      }
      return user;
    } catch {
      if (typeof window !== 'undefined') {
        window.location.href = redirectNonAdmin;
      }
      return null;
    }
  },

  /** 簡易線上心跳（目前只寫 console，不打 API，避免出錯） */
  startHeartbeat(minutes = 2) {
    if (typeof window === 'undefined') return;
    if (this._hb) clearInterval(this._hb);
    const ms = Math.max(1, minutes) * 60 * 1000;
    const send = async () => {
      const u = await this.getUser();
      if (!u) return;
      console.log(
        `[BookWide] heartbeat – ${new Date().toISOString()} – ${u.email ?? u.id}`
      );
      // 如果之後要打 Edge Function，可以在這裡補上 fetch(...)
    };
    send();
    this._hb = setInterval(send, ms);
  },
};

// ---- Attach globals for inline player.html / others ----
if (typeof window !== 'undefined') {
  // 主物件
  window.BW = window.BW || BW;

  // 舊版命名：supaGetUser / getSessionUser
  window.supaGetUser =
    window.supaGetUser ||
    (async () => {
      return await BW.getUser();
    });

  window.getSessionUser =
    window.getSessionUser ||
    (async () => {
      return await BW.getUser();
    });

  // 舊版守門名稱：ensureAuth
  window.ensureAuth =
    window.ensureAuth ||
    (async (opts = {}) => {
      return await BW.requireLogin(opts);
    });

  // 也保留 requireAdmin 在 window 上（admin.html 方便用）
  window.requireAdmin =
    window.requireAdmin ||
    (async (opts = {}) => {
      return await BW.requireAdmin(opts);
    });
}

// ---- 自動心跳：登入頁載入後自動啟動 ----
(async () => {
  try {
    const user = await BW.getUser();
    if (user) {
      BW.startHeartbeat(2);
      if (typeof console !== 'undefined') {
        console.log(`[BookWide] heartbeat started for ${user.email || user.id}`);
      }
    }
  } catch {
    // ignore
  }
})();



