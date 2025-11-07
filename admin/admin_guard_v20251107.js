
/*! BookWide Admin Guard v2025-11-07c (diagnostic) */
(async () => {
  const VERSION = 'v2025-11-07c';
  const REDIRECT_LOGIN = '/EduEnglish/index.html?login=1&next=' + encodeURIComponent(location.pathname + location.search);

  function badge(msg){
    const b = document.createElement('div');
    b.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999;background:#0b1324;color:#eaf1ff;border:1px solid #1f2a44;padding:6px 10px;border-radius:8px;font:12px/1.4 system-ui,Segoe UI,Roboto,"Noto Sans TC",Arial';
    b.textContent = msg;
    document.body.appendChild(b);
    return b;
  }
  function block(reason, detail){
    document.body.innerHTML = `
      <main style="max-width:900px;margin:48px auto;padding:24px;border-radius:14px;background:#0b1324;color:#eaf1ff;border:1px solid rgba(255,255,255,.12);font-family:system-ui, -apple-system, Segoe UI, Roboto, 'Noto Sans TC', Arial">
        <h1 style="margin:0 0 12px">非管理員</h1>
        <p style="opacity:.85">此頁僅限管理員瀏覽。（${reason}）</p>
        <pre style="white-space:pre-wrap;background:#0a1020;padding:10px;border-radius:8px;border:1px dashed #223455;color:#9cc1ff">${detail}</pre>
        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
          <a href="/EduEnglish/index.html" style="padding:10px 14px;border:1px solid #30415e;border-radius:10px;color:#eaf1ff;text-decoration:none">回首頁</a>
          <a href="/EduEnglish/index.html?login=1" style="padding:10px 14px;border:1px solid #30415e;border-radius:10px;color:#eaf1ff;text-decoration:none">重新登入</a>
          <a href="/EduEnglish/admin/index.html" style="padding:10px 14px;border:1px solid #30415e;border-radius:10px;color:#eaf1ff;text-decoration:none">Admin 首頁</a>
        </div>
      </main>`;
  }

  try{
    let supa = window.supa || window.supabase;
    if (!supa) {
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      const SUPABASE_URL='https://jeajrwpmrgczimmrflxo.supabase.co';
      const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplYWpyd3BtcmdjemltbXJmbHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA3MTg5MzksImV4cCI6MjA3NjI5NDkzOX0.3iFXdHH0JEuk177_R4TGFJmOxYK9V8XctON6rDe7-Do';
      supa = window.supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }

    const { data:{ session } } = await supa.auth.getSession();
    const user = session?.user || null;
    if (!user) {
      location.replace(REDIRECT_LOGIN);
      return;
    }

    const email = (user.email || '').trim();
    const emailLower = email.toLowerCase();
    const emailTypo = emailLower.replace('@gmail.com', '@gamil.com');
    let info = { version: VERSION, email, id: user.id, idHit: false, emailHit: false, typoHit: false, errors: [] };

    // id check
    try{
      const r1 = await supa.from('profiles').select('is_admin,email').eq('id', user.id).maybeSingle();
      if (!r1.error && r1.data?.is_admin === true) info.idHit = true;
      if (r1.error) info.errors.push('idCheck: ' + r1.error.message);
    }catch(e){ info.errors.push('idCheck exception: '+ e.message); }

    // email check
    if (!info.idHit) {
      try{
        const r2 = await supa.from('profiles').select('is_admin').eq('email', emailLower).maybeSingle();
        if (!r2.error && r2.data?.is_admin === true) info.emailHit = true;
        if (r2.error) info.errors.push('emailCheck: ' + r2.error.message);
      }catch(e){ info.errors.push('emailCheck exception: ' + e.message); }
    }

    // typo check
    if (!info.idHit && !info.emailHit && emailTypo !== emailLower) {
      try{
        const r3 = await supa.from('profiles').select('is_admin').eq('email', emailTypo).maybeSingle();
        if (!r3.error && r3.data?.is_admin === true) info.typoHit = true;
        if (r3.error) info.errors.push('typoCheck: ' + r3.error.message);
      }catch(e){ info.errors.push('typoCheck exception: ' + e.message); }
    }

    const isAdmin = info.idHit || info.emailHit || info.typoHit;
    badge(`AdminGuard ${VERSION} • ${email} • admin=${isAdmin ? 'YES' : 'NO'}`);

    if (!isAdmin) {
      block('Guard 拒絕', JSON.stringify(info, null, 2));
      return;
    }
    // admin OK
  }catch(e){
    console.error('[AdminGuard] fatal:', e);
    block('程式錯誤', String(e));
  }
})();
