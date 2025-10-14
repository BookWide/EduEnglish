// checkout-referral.js
import { supabase } from './supa.js'; // checkout.html 與 supa.js 同層

const STORAGE_KEY = 'referrer_code';

(function bootstrapReferrer() {
  const params = new URLSearchParams(location.search);
  const ref = params.get('ref');
  if (ref) {
    localStorage.setItem(STORAGE_KEY, ref);
    console.debug('[referral] stored from URL:', ref);
  }
})();

export function getReferrer() {
  return localStorage.getItem(STORAGE_KEY) || null;
}

export function setReferrer(code) {
  if (code) localStorage.setItem(STORAGE_KEY, code);
  else localStorage.removeItem(STORAGE_KEY);
}

export async function recordSubscription({ plan, amount, meta = {} } = {}) {
  try {
    const { data: { user }, error: uerr } = await supabase.auth.getUser();
    if (uerr) throw uerr;
    if (!user) {
      alert('尚未登入，請先登入再結帳');
      return { ok: false, error: 'NO_USER' };
    }

    const payload = {
      user_id: user.id,
      plan: plan || 'story-monthly',
      amount: amount ?? 0,
      referrer_code: getReferrer(),
      paid_at: new Date().toISOString(),
      meta
    };

    const { error } = await supabase.from('subscriptions').insert(payload);
    if (error) throw error;

    console.log('[subscription] created:', payload);
    return { ok: true };
  } catch (err) {
    console.error('[subscription] failed:', err);
    alert('建立訂閱紀錄失敗，請聯絡客服');
    return { ok: false, error: err?.message || String(err) };
  }
}

const autoBtn = document.querySelector('#btnConfirm, .confirm-pay');
if (autoBtn) {
  autoBtn.addEventListener('click', async () => {
    await recordSubscription({ plan: 'story-monthly', amount: 200 });
  });
}
