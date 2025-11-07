
/*! BookWide Admin Guard v2025-11-07b (id OR email) */
(async () => {
  const REDIRECT_LOGIN = '/EduEnglish/index.html?login=1&next=' + encodeURIComponent(location.pathname + location.search);
  function show(blockHtml){
    document.body.innerHTML = blockHtml;
    document.documentElement.style.background = '#0f172a';
  }
  try{
    // 1) Supabase client
    let supa = window.supa || window.supabase;
    if (!supa) {
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      const SUPABASE_URL='https://jeajrwpmrgczimmrflxo.supabase.co';
      const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplYWpyd3BtcmdjemltbXJmbHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA3MTg5MzksImV4cCI6MjA3NjI5NDkzOX0.3iFXdHH0JEuk177_R4TGFJmOxYK9V8XctON6rDe7-Do';
      supa = window.supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }

    // 2) session
    const { data:{ session } } = await supa.auth.getSession();
    const user = session?.user || null;
    if (!user) {
      location.replace(REDIRECT_LOGIN);
      return;
    }

    const email = (user.email || '').trim();
    const emailLower = email.toLowerCase();
    const emailTypo = emailLower.replace('@gmail.com', '@gamil.com'); // 容錯：常見拼字

    // 3) check by id
    let isAdmin = false;
    try{
      const r1 = await supa.from('profiles')
        .select('is_admin,email')
        .eq('id', user.id)
        .maybeSingle();
      if (!r1.error && r1.data && (r1.data.is_admin === true)) {
        isAdmin = true;
      }
      // 4) fallback by email (case-insensitive) if not admin yet
      if (!isAdmin) {
        const r2 = await supa
          .from('profiles')
          .select('is_admin')
          .ilike('email', emailLower)
          .maybeSingle();
        if (!r2.error && r2.data && (r2.data.is_admin === true)) {
          isAdmin = true;
        }
      }
      // 5) extra fallback: gamil.com typo
      if (!isAdmin && emailTypo !== emailLower) {
        const r3 = await supa
          .from('profiles')
          .select('is_admin')
          .eq('email', emailTypo)
          .maybeSingle();
        if (!r3.error && r3.data && (r3.data.is_admin === true)) {
          isAdmin = true;
        }
      }
    }catch(e){ /* ignore, will show non-admin */ }

    if (!isAdmin) {
      show(`
      <main style="max-width:900px;margin:48px auto;padding:24px;border-radius:14px;background:#0b1324;color:#eaf1ff;border:1px solid rgba(255,255,255,.12);font-family:system-ui, -apple-system, Segoe UI, Roboto, 'Noto Sans TC', Arial">
        <h1 style="margin:0 0 12px">非管理員</h1>
        <p style="opacity:.85">此頁僅限管理員瀏覽。若這是錯誤，請聯絡站長，或重新登入後再試。</p>
        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
          <a href="/EduEnglish/index.html" style="padding:10px 14px;border:1px solid #30415e;border-radius:10px;color:#eaf1ff;text-decoration:none">回首頁</a>
          <a href="/EduEnglish/index.html?login=1" style="padding:10px 14px;border:1px solid #30415e;border-radius:10px;color:#eaf1ff;text-decoration:none">重新登入</a>
          <a href="/EduEnglish/admin/index.html" style="padding:10px 14px;border:1px solid #30415e;border-radius:10px;color:#eaf1ff;text-decoration:none">Admin 首頁</a>
        </div>
      </main>`);
      return;
    }
    // admin OK → let original page render
  }catch(e){
    console.error('[AdminGuard] error:', e);
  }
})();
