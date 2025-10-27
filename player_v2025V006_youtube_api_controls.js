/*! BookWide – YouTube Iframe API add-on for V006 (controls: play/pause, prev/next sentence, repeat, speed)
 * 不改你的 V006 補丁；偵測 V006 產生的 <iframe id="yt">，自動換成 Iframe API 可控制的播放器。
 * 並嘗試綁定左下工具列：上一句 / 播放‧暫停 / 下一句 / 重複本句 / 速度。
 * 若抓不到字幕時間點，上一句/下一句會退回 ±3s；重複本句回放 3s。
 */
(function () {
  if (window.BW_YT_API_READY) return;
  window.BW_YT_API_READY = true;

  // ---- 你可以在這裡微調綁定的選擇器（盡量維持現狀也能自動偵測） ----
  const SEL = {
    // 若頁面已給 data-role，優先使用；否則會 fallback 以文字比對
    btnPrev   : '[data-role="btn-prev"]',
    btnPlay   : '[data-role="btn-play"]',
    btnNext   : '[data-role="btn-next"]',
    btnRepeat : '[data-role="btn-repeat"]',
    speedCtl  : '[data-role="speed"]', // 若有；否則自動偵測「速度」區塊的 range
  };

  // 取得 cat/slug 與 BASE，供載入 cues
  function getRoute() {
    const qp = new URLSearchParams(location.search);
    const cat = (qp.get('cat') || 'story').trim().toLowerCase();
    const slug = (qp.get('slug') || 'mid-autumn').trim();
    let path = location.pathname;
    if (path.endsWith('/')) path = path.slice(0, -1);
    const BASE = path.substring(0, path.lastIndexOf('/')) || '';
    return { cat, slug, BASE };
  }

  // 嘗試抓右側字幕面板上的時間標籤（常見做法：每行帶 data-time 或 data-t）
  function sniffCuesFromDOM() {
    const nodes = Array.from(
      document.querySelectorAll('[data-time],[data-t],[data-ts]')
    );
    const toSec = s => {
      if (typeof s === 'number') return s;
      // 支援 "00:01:23.456" / "01:23" / "12.3"
      const m = String(s).trim().match(/(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)/);
      if (!m) return NaN;
      if (m[4] != null) return parseFloat(m[4]);
      const h = parseFloat(m[1] || 0), mi = parseFloat(m[2] || 0), se = parseFloat(m[3] || 0);
      return h * 3600 + mi * 60 + se;
    };
    const list = nodes
      .map(n => {
        const v = n.dataset.time ?? n.dataset.t ?? n.dataset.ts;
        const t = toSec(v);
        return isFinite(t) ? { t } : null;
      })
      .filter(Boolean)
      .sort((a,b) => a.t - b.t);
    return list.length ? list : null;
  }

  // 從 /data/{cat}/cues-{slug}.json 嘗試載入字幕時間（若 schema 不合，忽略）
  async function loadCuesViaJSON(route) {
    const url = `${route.BASE}/data/${route.cat}/cues-${route.slug}.json?v=${Date.now()}`;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw 0;
      const j = await r.json();
      // 嘗試常見字段：items[].t / cues[].t / lines[].start
      const array = j.items || j.cues || j.lines || [];
      const mapT = (x) => {
        if (x.t != null) return +x.t;
        if (x.start != null) return +x.start;
        if (x.ts != null) return +x.ts;
        return NaN;
      };
      const list = array
        .map(x => ({ t: mapT(x) }))
        .filter(x => isFinite(x.t))
        .sort((a,b) => a.t - b.t);
      return list.length ? list : null;
    } catch {
      return null;
    }
  }

  // 綜合策略：先抓 DOM，沒抓到再抓 JSON；都沒有則回傳 null
  async function getCueList() {
    const dom = sniffCuesFromDOM();
    if (dom) return dom;
    const route = getRoute();
    const json = await loadCuesViaJSON(route);
    return json;
  }

  // 掛上 YouTube Iframe API（必要）
  function ensureYTScript() {
    return new Promise((resolve) => {
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

  // 尋找由 V006 產生的 iframe#yt，若存在，改用 API player 取代之
  async function upgradeToAPI() {
    const iframe = document.querySelector('iframe#yt[src*="youtube.com/embed/"]');
    if (!iframe) return false;

    // 解析 videoId
    const m = iframe.src.match(/embed\/([^?&]+)/);
    if (!m) return false;
    const videoId = decodeURIComponent(m[1]);

    // 宿主
    const host = iframe.parentElement || document.body;
    // 置換成 API 容器
    const holder = document.createElement('div');
    holder.id = 'yt-api-player';
    holder.style.width = '100%';
    holder.style.height = iframe.height ? (iframe.height + 'px') : '360px';
    host.replaceChild(holder, iframe);

    await ensureYTScript();

    return new Promise((resolve) => {
      // 建立 API Player
      const player = new YT.Player('yt-api-player', {
        videoId,
        playerVars: {
          rel: 0,
          modestbranding: 1
        },
        events: {
          onReady() {
            resolve(player);
          }
        }
      });
    });
  }

  // 建一層抽象，統一控制（給工具列用）
  function makeMediaFromYT(player) {
    return {
      play() { try { player.playVideo(); } catch {} },
      pause() { try { player.pauseVideo(); } catch {} },
      get paused() { try { return player.getPlayerState() !== YT.PlayerState.PLAYING; } catch { return true; } },
      get currentTime() { try { return player.getCurrentTime(); } catch { return 0; } },
      get duration() { try { return player.getDuration(); } catch { return 0; } },
      setRate(r) { try { player.setPlaybackRate(r); } catch {} },
      getRate() { try { return player.getPlaybackRate?.() ?? 1; } catch { return 1; } },
      seekTo(t) { try { player.seekTo(Math.max(0, t), true); } catch {} },
      seekBy(dt) { try { player.seekTo(Math.max(0, player.getCurrentTime() + dt), true); } catch {} },
    };
  }

  // 找出按鈕（優先 data-role；否則用文字比對）
  function findBtn(selector, textIncludes) {
    let btn = selector ? document.querySelector(selector) : null;
    if (btn) return btn;
    const all = Array.from(document.querySelectorAll('button, [role="button"]'));
    btn = all.find(b => (b.textContent || '').includes(textIncludes));
    return btn || null;
  }

  // 嘗試綁定「速度」控制（若有 range）
  function findSpeedRange() {
    // data-role 優先
    const byRole = document.querySelector(SEL.speedCtl);
    if (byRole) return byRole;
    // 嘗試在含「速度」字樣的區塊內找 range
    const blocks = Array.from(document.querySelectorAll('*'))
      .filter(n => /速度/.test(n.textContent || ''));
    for (const blk of blocks) {
      const r = blk.querySelector('input[type="range"]');
      if (r) return r;
    }
    // 全頁搜尋 range（最後手段）
    return document.querySelector('input[type="range"]');
  }

  // 把秒數轉成就近字幕 index
  function makeCueNavigator(cues) {
    if (!cues || !cues.length) return null;
    const ts = cues.map(x => x.t);
    const findIdx = (t) => {
      let lo = 0, hi = ts.length - 1, ans = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (ts[mid] <= t) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      return ans;
    };
    return {
      prev(t) { const i = findIdx(t); return Math.max(0, i - 1); },
      next(t) { const i = findIdx(t); return Math.min(ts.length - 1, i + 1); },
      at(i) { return ts[Math.max(0, Math.min(i, ts.length - 1))]; }
    };
  }

  async function boot() {
    // 只在有 V006 產生的 YouTube iframe 時啟用
    const apiPlayer = await upgradeToAPI();
    if (!apiPlayer) return; // 沒有 yt，不動作（mp4 照舊）

    const media = makeMediaFromYT(apiPlayer);
    window.BW_MEDIA = media; // 方便你日後在 console 或其它程式需要

    // 憑 DOM/JSON 取得 cue list（若沒有會回傳 null）
    const cues = await getCueList();
    const nav  = makeCueNavigator(cues);
    const fallbackJump = 3; // 無 cue 時，上一句/下一句的退場策略（秒）

    // 綁定工具列
    const btnPrev   = findBtn(SEL.btnPrev,   '上一句');
    const btnPlay   = findBtn(SEL.btnPlay,   '播放');
    const btnNext   = findBtn(SEL.btnNext,   '下一句');
    const btnRepeat = findBtn(SEL.btnRepeat, '重複本句');
    const speedRange = findSpeedRange();

    if (btnPlay) {
      btnPlay.addEventListener('click', () => {
        if (media.paused) media.play(); else media.pause();
      });
    }
    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        const t = media.currentTime;
        if (nav) {
          const idx = nav.prev(t);
          media.seekTo(nav.at(idx));
        } else {
          media.seekBy(-fallbackJump);
        }
      });
    }
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        const t = media.currentTime;
        if (nav) {
          const idx = nav.next(t);
          media.seekTo(nav.at(idx));
        } else {
          media.seekBy(+fallbackJump);
        }
      });
    }
    if (btnRepeat) {
      btnRepeat.addEventListener('click', () => {
        const t = media.currentTime;
        if (nav) {
          // 找當前句起點，回放
          const iPrev = (function findPrevIdx() {
            // 若 nav.prev(t) 正好回到同一 index 可能跳不動，略往前推一點
            const i = nav.prev(t - 0.001);
            return i;
          })();
          media.seekTo(nav.at(iPrev));
          media.play();
        } else {
          media.seekTo(Math.max(0, t - fallbackJump));
          media.play();
        }
      });
    }
    if (speedRange) {
      // 讓速度調整能控制 YouTube
      const apply = () => {
        const v = parseFloat(speedRange.value);
        if (isFinite(v) && v > 0) media.setRate(v);
      };
      speedRange.addEventListener('input', apply);
      speedRange.addEventListener('change', apply);
      // 初始同步一次
      setTimeout(apply, 0);
    }

    console.log('[YT-API] controls wired (play/pause, prev/next, repeat, speed). Cues:', cues ? cues.length : 0);
  }

  // 等 V006 先把 iframe 產生出來再接管
  const start = () => setTimeout(boot, 100); // 小延遲讓 V006 完成 render
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
