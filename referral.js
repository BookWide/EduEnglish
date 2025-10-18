// referral.js
import { supabase } from './supa.js';

// 建立或更新（使用目前登入者）
export async function recordReferral(amount) {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) throw new Error('NOT_SIGNED_IN');

  const payload = { user_id: auth.user.id, total_amount: amount };

  const { data, error } = await supabase
    .from('referral_stats')
    .upsert(payload, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// 只讀取「我自己」的推薦統計
export async function getMyReferralStats() {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) throw new Error('NOT_SIGNED_IN');

  const { data, error } = await supabase
    .from('referral_stats')
    .select('user_id,total_amount,updated_at')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (error) throw error;
  // 沒資料時回傳預設值，避免前端顯示「載入失敗」
  return data ?? { user_id: auth.user.id, total_amount: 0, updated_at: null };
}

