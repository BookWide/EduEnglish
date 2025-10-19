// checkout-referral.js
// 需求：supa.js 要 export { supabase }
import { supabase } from './supa.js';

const $ = (sel) => document.querySelector(sel);
const formatMoney = (n) => `$${(Math.round(n)).toLocaleString()}`;

document.addEventListener('DOMContentLoaded', async () => {
  const url = new URL(window.location.href);
  const params = url.searchParams;

  // 1) 讀取 query：items、period、ref
  const items = (params.get('items') || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const period = (params.get('period') || 'month'); // month / half / year
  const refCode = params.get('ref') || '';          // 推薦碼（可空）

  // 2) UI：標示週期
  $('#period-pill').textContent = `週期：${period === 'month' ? '月' : period === 'half' ? '半年' : '年'}`;

  // 3) 沒選方案就保護
  if (!items.length) {
    $('#plan-list').innerHTML = `<span class="chip">尚未選擇方案</span>`;
    $('#err').style.display = 'block';
    $('#err').textContent = '未選擇任何主題，請返回上一頁。';
    $('#checkoutBtn').disabled = true;
    return;
  }

  // 4) 列出方案 chip
  $('#plan-list').innerHTML = items.map(i => `<span class="chip">${i}</span>`).join('');

  // 5) 計價
  // 單價邏輯：月 200 / 半年 960 => 160 * 6 / 年 1680 => 140 * 12
  const unitMap = { month: 200, half: 160, year: 140 }; // 每月單價
  const unitPrice = unitMap[period] ?? 200;
  const months = period === 'month' ? 1 : period === 'half' ? 6 : 12;
  const subtotal = items.length * unitPrice * months;

  let discount = 0;
  let total = subtotal;

  if (refCode) {
    // 範例：推薦碼 9 折
    discount = Math.round(subtotal * 0.10);
    total = subtotal - discount;

    $('#referral').innerHTML = `
      <div class="ok">推薦碼：<strong>${refCode}</strong> 已套用 9 折優惠</div>
    `;
    $('#discount-row').style.display = 'flex';
    $('#discount').textContent = `-${formatMoney(discount)}`;
  } else {
    $('#referral').innerHTML = `<div class="none">無推薦碼</div>`;
    $('#discount-row').style.display = 'none';
  }

  $('#subtotal').textContent = formatMoney(subtotal);
  $('#total').textContent = formatMoney(total);

  // 6) 綁定確認付款 → 呼叫 Edge Function 建立綠界訂單
  $('#checkoutBtn').addEventListener('click', async () => {
    try {
      $('#checkoutBtn').disabled = true;

      // 取得登入使用者（未登入也允許建立訂單，但 user_id 會是 null）
      const { data: userData } = await supabase.auth.getUser();
      const user_id = userData?.user?.id ?? null;

      const payload = {
        user_id,
        items,
        period,     // "month" / "half" / "year"
        total,      // 實際金額（已含折扣）
        referral_code: refCode || null
      };

      const { data, error } = await supabase.functions.invoke('create-ecpay-order', { body: payload });

      if (error) throw error;
      if (!data?.ecpay_url) throw new Error('沒有取得金流導向網址');

      // 導向綠界
      window.location.href = data.ecpay_url;
    } catch (err) {
      console.error(err);
      $('#err').style.display = 'block';
      $('#err').textContent = `建立訂單失敗：${err.message || err}`;
      $('#checkoutBtn').disabled = false;
    }
  });
});


