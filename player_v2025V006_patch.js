/*! BookWide Player Patch v2025V006 (A~E) - external JS
   功能：
   - 依 URL ?cat&slug 讀取 /data/{cat}/{cat}-index.json
   - 若有 youtubeId/yt → 以 YouTube 嵌入播放
   - 否則 → 播放 /videos/{cat}/{slug}.mp4
   - 不改你原本的結構；只在最後覆蓋播放器區塊
*/
(function () {
  // 防重複載入
  if (window.BWV006_EXT_LOADED) return;
  window.BWV006_EXT_LOADED = true;

  try {
    // 解析參數
    var qp = new URLSearchParams(location.search);
    var cat = (qp.get('cat') || 'story').trim().toLowerCase();
    var slug = (qp.get('slug') || 'mid-autumn').trim();

    // 安全計算 BASE/DATA（同時支援 .../player.html 與 .../player）
    var path = location.pathname;
    if (path.endsWith('/')) path = path.slice(0, -1);
    var BASE = path.substring(0, path.lastIndexOf('/')) || '';
    var DATA = BASE + '/data/' + cat + '/';
    var INDEX_URL = DATA + cat + '-index.json?v=' + Date.now();

    // 小工具
    function pickHost() {
      return document.querySelector('#video')
          || document.querySelector('video')?.parentElement
          || document.body;
    }

    // 讀取索引、決定播放來源
    fetch(INDEX_URL, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('index fetch ' + r.status);
        return r.json();
      })
      .then(function (json) {
        var items = json.items || [];
        var item = items.find(function (x) { return (x.slug || '').trim() === slug; }) || items[0];
        if (!item) throw new Error('index empty');

        var yt = item.youtubeId || item.yt || '';
        var host = pickHost();
        var v = document.querySelector('video');

        if (yt) {
          // 有 YouTube → 用 iframe（先移除舊 video）
          if (v) try { v.remove(); } catch (_) {}
          host.innerHTML = '<iframe id="yt" width="100%" height="360" ' +
            'src="https://www.youtube.com/embed/' + yt + '?autoplay=0&rel=0" ' +
            'frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>';
          console.log('[V006] use YouTube:', yt);
        } else {
          // 無 YouTube → 播本地 mp4
          if (!v) {
            v = document.createElement('video');
            v.controls = true;
            v.id = 'bw-video';
            host.prepend(v);
          }
          v.src = BASE + '/videos/' + cat + '/' + slug + '.mp4';
          v.load();
          console.log('[V006] use local mp4:', v.src);
        }
      })
      .catch(function (e) {
        console.error('[V006] patch error:', e);
      });
  } catch (e) {
    console.error('[V006] fatal:', e);
  }
})();



