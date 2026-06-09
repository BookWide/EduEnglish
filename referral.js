// referral.js — minimal, working version
// Depends on: supa.js exporting { supabase }
// Place this file next to referral.html and include via:
//   <script type="module" src="referral.js"></script>

import { supabase } from './supa.js';

// ---- small helpers ---------------------------------------------------------
const $  = (s, r=document)=> r.querySelector(s);
const $$ = (s, r=document)=> Array.from(r.querySelectorAll(s));
const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));

function toast(msg='已複製到剪貼簿'){
  let box = $('#toast');
  if(!box){
    box = document.createElement('div');
    box.id = 'toast';
    box.className = 'toast hide';
    box.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);padding:10px 14px;border-radius:10px;background:#111a2b;color:#e6f0ff;z-index:9999;';
    document.body.appendChild(box);
  }
  box.textContent = msg;
  box.classList.remove('hide');
  setTimeout(()=> box.classList.add('hide'), 1400);
}

// ---- wire page -------------------------------------------------------------
async function boot(){
  // 1) auth
  const { data: { user }, error } = await supabase.auth.getUser();
  const linkIpt = $('#refLink') || $('input[type="text"]');
  const copyBtn = $('#btnCopy') || $('button');
  const codeBox = $('#myCode') || $('[data-ref="code"]');
  const statsBox = $('#referralStats');

  if (error || !user){
    linkIpt && (linkIpt.value = '請先登入');
    codeBox && (codeBox.textContent = '--');
    return;
  }

  // 2) build my referral link
  const base = location.origin + (location.pathname.includes('/EduEnglish/') ? '/EduEnglish/' : '/');
  const myLink = `${base}?ref=${encodeURIComponent(user.id)}`;
  if (linkIpt) linkIpt.value = myLink;

  // 3) copy
  if (copyBtn && !copyBtn.dataset.bound){
    copyBtn.dataset.bound = '1';
    copyBtn.addEventListener('click', async ()=>{
      try{
        await navigator.clipboard.writeText(linkIpt?.value || myLink);
        toast('已複製到剪貼簿');
      }catch(e){
        toast('複製失敗，請手動選取複製');
      }
    });
  }

  // 4) referral code
  if (codeBox){
    const code = user.user_metadata?.ref_code || (user.id || '').slice(0, 8);
    codeBox.textContent = code || '--';
  }

  // 5) load stats (best-effort; works with either `referrals` or `referral_stats` schema)
  if (statsBox){
    try{
      // Try detailed referrals table first
      let okCount = 0, amount = 0;
      let { data, error } = await supabase
        .from('referrals')
        .select('amount,status')
        .eq('referrer_id', user.id);
      if (!error && Array.isArray(data)){
        data.forEach(r=>{
          const success = (r.status||'').toLowerCase().includes('success') || (r.status||'') === 'paid';
        if (success) { okCount += 1; amount += Number(r.amount||0); }
        });
      }else{
        // Fallback to summary table
        const res = await supabase
          .from('referral_stats')
          .select('success_count,total_amount,expires_at')
          .eq('user_id', user.id)
          .maybeSingle();
        if (!res.error && res.data){
          okCount = Number(res.data.success_count||0);
          amount  = Number(res.data.total_amount||0);
          if (res.data.expires_at){
            const d = new Date(res.data.expires_at);
            statsBox.dataset.expires = isNaN(+d) ? '' : d.toISOString().slice(0,10);
          }
        }
      }

      // Render
      const exp = statsBox.dataset.expires || '--';
      statsBox.innerHTML = `
        <div class="ref-stat"><span>✅ 成功推薦：</span><strong>${okCount}</strong> 位</div>
        <div class="ref-stat"><span>🥇 累積金額：</span><strong>${amount}</strong> 元</div>
        <div class="ref-stat"><span>⏳ 有效期限：</span><strong>${exp}</strong></div>
      `;
      statsBox.style.display = '';
    }catch(e){
      // keep quiet on failure
      console.warn('[referral] stats load error', e);
      statsBox && (statsBox.style.display = '');
    }
  }
}

// auto start
if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', boot, { once:true });
}else{
  boot();
}


