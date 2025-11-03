// supa.js  — 單檔共用
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ★★ 換成你自己的專案參數 ★★
export const SUPABASE_URL = 'https://jeajrwpmrgczimmrflxo.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplYWpyd3BtcmdjemltbXJmbHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA3MTg5MzksImV4cCI6MjA3NjI5NDkzOX0.3iFXdHH0JEuk177_R4TGFJmOxYK9V8XctON6rDe7-Do';

// 1) 建立 client（保留你原本設定）
export const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/* ==============================
   2) 停權檢查（登入/刷新 Token 都會觸發）
   ============================== */
async function enforceNotPaused() {
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return;

  const { data: profile, error } = await supa
    .from('profiles')
    .select('is_paused')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.warn('[pause-check] profiles 讀取失敗：', error);
    return;
  }

  if (profile?.is_paused) {
    await supa.auth.signOut();
    alert('此帳號已被暫停登入，請聯絡管理員。');
    location.href = './index.html';
    throw new Error('ACCOUNT_PAUSED');
  }
}

// 登入/刷新 token 時自動檢查
supa.auth.onAuthStateChange(async (evt) => {
  if (evt === 'SIGNED_IN' || evt === 'TOKEN_REFRESHED') {
    await enforceNotPaused();
  }
});

// 初次載入也檢查一次（頁面載入後立即）
enforceNotPaused();

/* ==============================
   3) 常用工具
   ============================== */
export async function requireAuth() {
  const { data: { user } } = await supa.auth.getUser();
  if (!user) {
    alert('請先登入');
    location.href = './index.html';
    throw new Error('NOT_SIGNED_IN');
  }
  await enforceNotPaused();
  return user;
}

export async function requireAdmin() {
  const user = await requireAuth();
  const { data: prof, error } = await supa
    .from('profiles')
    .select('is_admin, is_paused')
    .eq('id', user.id)
    .maybeSingle();

  if (error) throw error;
  if (!prof?.is_admin) {
    alert('需要管理員身分才能進入。');
    location.href = './index.html';
    throw new Error('NOT_ADMIN');
  }
  if (prof?.is_paused) {
    await supa.auth.signOut();
    alert('此帳號已被暫停登入，請聯絡管理員。');
    location.href = './index.html';
    throw new Error('ACCOUNT_PAUSED');
  }
  return user;
}

// （可選）上線心跳：每 N 分鐘更新 last_seen_at
let __hb;
export function startHeartbeat(minutes = 2) {
  stopHeartbeat();
  __hb = setInterval(async () => {
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return;
    try {
      await supa.from('profiles')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', user.id);
    } catch (_) {}
  }, minutes * 60 * 1000);
}
export function stopHeartbeat() { if (__hb) clearInterval(__hb); }

/* ==============================
   4) Admin 動作（授權/移除/暫停/解除）
   ============================== */
async function adminPatch(email, patch) {
  const { error } = await supa.from('profiles').update(patch).eq('email', email);
  if (error) throw error;
}
export async function adminGrant(email)  { await adminPatch(email, { is_admin: true  }); }
export async function adminRevoke(email) { await adminPatch(email, { is_admin: false }); }
export async function adminPause(email)  { await adminPatch(email, { is_paused: true  }); }
export async function adminUnpause(email){ await adminPatch(email, { is_paused: false }); }

export async function getProfileByEmail(email) {
  const { data, error } = await supa
    .from('profiles')
    .select('id,email,display_name,is_admin,is_paused,last_sign_in_at,last_seen_at,expires_at')
    .eq('email', email)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/* ==============================
   5) 兼容舊頁面：掛到 window
   ============================== */
window.supa = supa;
window.BW = {
  requireAuth,
  requireAdmin,
  startHeartbeat,
  stopHeartbeat,
  adminGrant,
  adminRevoke,
  adminPause,
  adminUnpause,
  getProfileByEmail,
};
