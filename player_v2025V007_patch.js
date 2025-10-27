/*! BookWide Player Patch v2025V007 - Stable (A~E + YouTube fix)
 * 功能：
 *  - 支援 story / music / movie / news / pro 五類 JSON
 *  - 自動讀取 /data/{cat}/{cat}-index.json
 *  - 若有 yt / youtubeId → 使用 YouTube iframe 嵌入
 *  - 否則 → 播放 /videos/{cat}/{slug}.mp4
 *  - 修正 GitHub Pages Permissions Policy (unload not allowed)
 *  - 增加 YouTube 自動重試機制
 */
(function () {
  if (window.BWV007_EXT_LOADED) return;
  window.BWV007_EXT_LOADED = true;

  console.log("[V007] BookWide Player Patch loaded");

  try {
    const qp = new URLSearchParams(location.search);
    const cat = (qp.get("cat") || "story").trim().toLowerCase();
    const slug = (qp.get("slug") || "mid-autumn").trim();

    // 計算 BASE 與 DATA 路徑
    let path = location.pathname;
    if (path.endsWith("/")) path = path.slice(0, -1);
    const BASE = path.substring(0, path.lastIndexOf("/")) || "";
    const DATA = BASE + "/data/" + cat + "/";
    const INDEX_URL = DATA + cat + "-index.json?v=" + Date.now();

    console.log("[V007] Load index:", INDEX_URL);

    function pickHost() {
      return (
        document.querySelector("#video") ||
        document.querySelector("video")?.parentElement ||
        document.body
      );
    }

    fetch(INDEX_URL, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("index fetch " + r.status);
        return r.json();
      })
      .then((json) => {
        const items = json.items || [];
        const item =
          items.find((x) => (x.slug || "").trim() === slug) || items[0];
        if (!item) throw new Error("index empty");

        const yt = item.youtubeId || item.yt || "";
        const host = pickHost();
        let v = document.querySelector("video");

        if (yt) {
          if (v) try { v.remove(); } catch (_) {}

          // 動態建立 iframe with full permissions
          const iframe = document.createElement("iframe");
          iframe.id = "yt";
          iframe.width = "100%";
          iframe.height = "360";
          iframe.src =
            "https://www.youtube.com/embed/" +
            yt +
            "?autoplay=0&rel=0&modestbranding=1";
          iframe.frameBorder = "0";
          iframe.allow =
            "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen";
          iframe.allowFullscreen = true;
          iframe.referrerPolicy = "strict-origin-when-cross-origin";
          host.innerHTML = "";
          host.appendChild(iframe);

          console.log("[V007] YouTube embed:", yt);

          // 🔁 若 YouTube 播放失敗 → 嘗試重新載入一次
          iframe.addEventListener("error", () => {
            console.warn("[V007] iframe error, retrying...");
            setTimeout(() => {
              iframe.src =
                "https://www.youtube.com/embed/" +
                yt +
                "?autoplay=0&rel=0&modestbranding=1";
            }, 1500);
          });
        } else {
          if (!v) {
            v = document.createElement("video");
            v.controls = true;
            v.id = "bw-video";
            host.prepend(v);
          }
          v.src = BASE + "/videos/" + cat + "/" + slug + ".mp4";
          v.load();
          console.log("[V007] Local video:", v.src);
        }
      })
      .catch((e) => {
        console.error("[V007] patch error:", e);
      });
  } catch (e) {
    console.error("[V007] fatal:", e);
  }
})();
