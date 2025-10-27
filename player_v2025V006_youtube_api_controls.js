/*! BookWide – YouTube Iframe API add-on for V006 (v006a)
 * 不改 V006；偵測任何 <iframe src="...youtube.com/embed/..."> 後，用 Iframe API 取代，
 * 並接上左下工具列：播放/暫停、上一句、下一句、重複本句、速度。
 */
(function () {
  if (window.BW_YT_API_READY) return;
  window.BW_YT_API_READY = true;

  // --- route / cues helpers ---------------------------------------------------
  function getRoute() {
    const qp = new URLSearchParams(location.search);
    const cat  = (qp.get('cat')  || 'story').trim().toLowerCase();
    const slug = (qp.get('slug') || 'mid-autumn').trim();
    let path = location.pathname;
    if (path.endsWith('/')) path = path.slice(0, -1);
    const BASE = path.substring(0, path.lastIndexOf('/')) || '';
    return { cat, slug, BASE };
  }

  function sniffCuesFromDOM() {
    const nodes = Array.from(document.querySelectorAll('[data-time],[data-t],[data-ts]'));
    const toSec = s => {
      if (typeof s === 'number') return s;
      const m = String(s).trim().match(/(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)/);
      if (!m) return NaN;
      if (m[4] != null) return parseFloat(m[4]);
      const h = + (m[1] || 0), mi = + (m[2] || 0), se = + (m[3] || 0);
      return h*3600 + mi*60 + se;
    };
    const list = nodes.map(n=>{
      const v = n.dataset.time ?? n.dataset.t ?? n.dataset.ts;
      const t = toSec(v);
      return isFinite(t) ? { t } : null;
    }).filter(Boolean).sort((a,b)=>a.t-b.t);
    return list.length ? list : null;
  }

  async function loadCuesViaJSON(route) {
    const url = `${route.BASE}/data/${route.cat}/cues-${route.slug}.json?v=${Date.now()}`;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw 0;
      const j = await r.json();
      const arr = j.items || j.cues || j.lines || [];
      const list = arr.map(x=>{
        const t = x.t ?? x.start ?? x.ts;
        return isFinite(+t) ? { t:+t } : null;
      }).filter(Boolean).sort((a,b)=>a.t-b.t);
      return list.length ? list : null;
    } catch { return null; }
  }

  async function getCueList() {
    return sniffCuesFromDOM() || await loadCuesViaJSON(getRoute());
  }

  // --- YouTube Iframe API -----------------------------------------------------
  function ensureYTScript() {
    return new Promise((resolve)=>{
      if (window.YT && window.YT.Player) return resolve();
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof prev === 'function') prev();
        resolve();
      };
    });
  }

  // 找任意的 YouTube 內嵌 iframe（不要求 id）
  function findEmbedIframe() {
    return document.querySelector('iframe[src*="youtube.com/embed/"]');
  }

  // 等待 V006 把 iframe 插入（最多重試 40 次 * 250ms ≈ 10 秒）
  async function waitForIframe() {
    for (let i=0;i<40;i++){
      const f = findEmbedIframe();
      if (f) return f;
      await new Promise(r=>setTimeout(r,250));
    }
    return null;
  }

  async function upgradeToAPI() {
    const iframe = await waitForIframe();
    if (!iframe) return null;

    const m = iframe.src.match(/embed\/([^?&]+)/);
    if (!m) return null;
    const videoId = decodeURIComponent(m[1]);

    const host = iframe.parentElement || document.body;
    const holder = document.createElement('div');
    holder.id = 'yt-api-player';
    holder.style.width = '100%';
    // 若拿不到高度就讓 YT 自適應
    if (iframe.height) holder.style.height = iframe.height + 'px';
    host.replaceChild(holder, iframe);

    await ensureYTScript();

    return new Promise(resolve=>{
      const player = new YT.Player('yt-api-player', {
        videoId,
        playerVars: { rel:0, modestbranding:1 },
        events: { onReady(){ resolve(player); } }
      });
    });
  }

  function makeMediaFromYT(player) {
    return {
      play(){ try{ player.playVideo(); }catch{} },
      pause(){ try{ player.pauseVideo(); }catch{} },
      get paused(){ try{ return player.getPlayerState() !== YT.PlayerState.PLAYING; }catch{ return true; } },
      get currentTime(){ try{ return player.getCurrentTime(); }catch{ return 0; } },
      get duration(){ try{ return player.getDuration(); }catch{ return 0; } },
      setRate(r){ try{ player.setPlaybackRate(r); }catch{} },
      getRate(){ try{ return player.getPlaybackRate?.() ?? 1; }catch{ return 1; } },
      seekTo(t){ try{ player.seekTo(Math.max(0,t), true); }catch{} },
      seekBy(dt){ try{ player.seekTo(Math.max(0, player.getCurrentTime()+dt), true); }catch{} },
    };
  }

  // --- 綁定工具列（盡量不依賴固定結構） --------------------------------------
  function findBtnByRoleOrText(roleSel, text){
    let btn = roleSel ? document.querySelector(roleSel) : null;
    if (btn) return btn;
    const all = Array.from(document.querySelectorAll('button,[role="button"]'));
    return all.find(b => (b.textContent||'').includes(text)) || null;
  }
  function findSpeedRange() {
    const byRole = document.querySelector('[data-role="speed"]');
    if (byRole) return byRole;
    const blocks = Array.from(document.querySelectorAll('*')).filter(n=>/速度/.test(n.textContent||''));
    for (const blk of blocks) {
      const r = blk.querySelector('input[type="range"]');
      if (r) return r;
    }
    return document.querySelector('input[type="range"]');
  }
  function makeCueNavigator(cues){
    if (!cues || !cues.length) return null;
    const ts = cues.map(x=>x.t);
    const idxAt = (t)=>{
      let lo=0, hi=ts.length-1, ans=0;
      while(lo<=hi){ const mid=(lo+hi)>>1; if(ts[mid]<=t){ans=mid;lo=mid+1;} else hi=mid-1; }
      return ans;
    };
    return {
      prev(t){ return Math.max(0, idxAt(t-0.001)-1); },
      next(t){ return Math.min(ts.length-1, idxAt(t)+1); },
      at(i){ return ts[Math.max(0, Math.min(i, ts.length-1))]; }
    };
  }

  async function boot(){
    const apiPlayer = await upgradeToAPI();
    if (!apiPlayer) return; // 不是 YouTube（或找不到），不動作

    const media = makeMediaFromYT(apiPlayer);
    window.BW_MEDIA = media;

    const cues = await getCueList();
    const nav  = makeCueNavigator(cues);
    const fallbackJump = 3;

    const btnPrev   = findBtnByRoleOrText('[data-role="btn-prev"]',   '上一句');
    const btnPlay   = findBtnByRoleOrText('[data-role="btn-play"]',   '播放');
    const btnNext   = findBtnByRoleOrText('[data-role="btn-next"]',   '下一句');
    const btnRepeat = findBtnByRoleOrText('[data-role="btn-repeat"]', '重複本句');
    const speedRange = findSpeedRange();

    btnPlay   && btnPlay.addEventListener('click', ()=>{ media.paused ? media.play() : media.pause(); });
    btnPrev   && btnPrev.addEventListener('click', ()=>{
      const t = media.currentTime;
      if (nav) media.seekTo(nav.at(nav.prev(t))); else media.seekBy(-fallbackJump);
    });
    btnNext   && btnNext.addEventListener('click', ()=>{
      const t = media.currentTime;
      if (nav) media.seekTo(nav.at(nav.next(t))); else media.seekBy(+fallbackJump);
    });
    btnRepeat && btnRepeat.addEventListener('click', ()=>{
      const t = media.currentTime;
      if (nav) media.seekTo(nav.at(nav.prev(t))); else media.seekTo(Math.max(0, t-fallbackJump));
      media.play();
    });
    if (speedRange){
      const apply = ()=>{ const v = parseFloat(speedRange.value); if (isFinite(v)&&v>0) media.setRate(v); };
      speedRange.addEventListener('input', apply);
      speedRange.addEventListener('change', apply);
      setTimeout(apply,0);
    }

    console.log('[YT-API v006a] wired. cues=', cues ? cues.length : 0);
  }

  // 等 DOM 完成再啟動（再加一點延遲確保 V006 先 render）
  const start = ()=> setTimeout(boot, 200);
  (document.readyState === 'loading')
    ? document.addEventListener('DOMContentLoaded', start, { once:true })
    : start();
})();


