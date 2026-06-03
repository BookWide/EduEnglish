// player-guard.js
import { supabase } from './supa.js';

export async function requireActiveSubscription(plan = 'story-monthly') {
  const { data: { user }, error: uerr } = await supabase.auth.getUser();
  if (uerr) {
    console.error('[guard] getUser error', uerr);
    location.href = './login.html?next=' + encodeURIComponent(location.pathname + location.search);
    return false;
  }
  if (!user) {
    location.href = './login.html?next=' + encodeURIComponent(location.pathname + location.search);
    return false;
  }

  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .eq('plan', plan)
    .order('paid_at', { ascending: false })
    .limit(1);
  if (error) {
    console.error('[guard] query error', error);
    alert('讀取訂閱狀態失敗，請稍後再試');
    return false;
  }

  const hasActive = Array.isArray(data) && data.length > 0;
  if (!hasActive) {
    alert('此內容需訂閱才能觀看，將引導至方案頁');
    location.href = './pricing.html';
    return false;
  }

  console.log('[guard] subscription ok');
  return true;
}

requireActiveSubscription().catch(console.error);
