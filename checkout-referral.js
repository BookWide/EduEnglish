// checkout-referral.js
import { supabase } from './supa.js';

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const items = (urlParams.get('items') || '').split(',').filter(Boolean);
  const period = urlParams.get('period') || 'month';
  const refCode = urlParams.get('ref'); // 取得推薦碼

  const planList = document.querySelector('#plan-list');
  const subtotalEl = document.querySelector('#subtotal');
  const totalEl = document.querySelector('#total');
  const referralEl = document.querySelector('#referral');
  
  const priceMap = { month: 200, half: 960, year: 1680 };
  const unitPrice = priceMap[period] / (period === 'month' ? 1 : (period === 'half' ? 6 : 12));

  // 計算價格
  const subtotal = items.length * unitPrice;
  let discount = 0;
  let total = subtotal;

  // 有推薦碼就折扣
  if (refCode) {
    discount = subtotal * 0.1;  // 折扣 10%
    total = subtotal - discount;
    referralEl.innerHTML = `<p>推薦碼：${refCode}</p><p>已套用 9 折優惠</p>`;
  } else {
    referralEl.innerHTML = `<p>無推薦碼</p>`;
  }

  // 更新畫面
  planList.innerHTML = items.map(i => `<div>${i}</div>`).join('');
  subtotalEl.textContent = `$${subtotal}`;
  totalEl.textContent = `$${total}`;

  // 綁定按鈕
  document.querySelector('#checkoutBtn').addEventListener('click', async () => {
    const user = (await supabase.auth.getUser()).data.user;
    const body = {
      user_id: user?.id,
      items,
      period,
      total,
      referral_code: refCode || null
    };

    const { data, error } = await supabase.functions.invoke('create-ecpay-order', {
      body
    });

    if (error) {
      alert('建立訂單失敗：' + error.message);
      return;
    }
    window.location.href = data.ecpay_url;
  });
});


