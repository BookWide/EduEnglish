// /shared/footer.js
// BookWide 全站共用 Footer（依照你提供的圖：紅底多欄 + 左側社群 + 底部公司資訊）

(function () {
  const LINKS = {
    home: "/index.html",
    signup: "/index.html#signup",
    login: "/index.html#login",
    rejoin: "/pricing.html",

    guide_first: "/help/first-time.html",
    guide_howto: "/help/howto.html",
    guide_pricing: "/pricing.html",
    guide_family: "/help/family.html",
    guide_browser: "/help/browser.html",

    other_reviews: "/help/reviews.html",
    other_faq: "/help/faq.html",

    company_sitemap: "/sitemap.html",
    company_terms: "/terms.html",
    company_trade: "/trade.html",
    company_privacy: "/privacy.html",
    company_jobs: "/jobs.html",

    // 社群（先放預設，你可改成真連結）
    fb: "#",
    yt: "#",
    ig: "#",
    tt: "#",
  };

  function icon(name) {
    // 內建 SVG（不依賴外部圖示庫）
    const common = `width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"`;
    if (name === "fb") {
      return `<svg ${common}><path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.88 3.77-3.88 1.09 0 2.23.2 2.23.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.77l-.44 2.89h-2.33v6.99A10 10 0 0 0 22 12z"/></svg>`;
    }
    if (name === "yt") {
      return `<svg ${common}><path d="M21.6 7.2a3 3 0 0 0-2.1-2.1C17.7 4.6 12 4.6 12 4.6s-5.7 0-7.5.5A3 3 0 0 0 2.4 7.2 31.4 31.4 0 0 0 2 12a31.4 31.4 0 0 0 .4 4.8 3 3 0 0 0 2.1 2.1c1.8.5 7.5.5 7.5.5s5.7 0 7.5-.5a3 3 0 0 0 2.1-2.1A31.4 31.4 0 0 0 22 12a31.4 31.4 0 0 0-.4-4.8zM10 15.5v-7l6 3.5-6 3.5z"/></svg>`;
    }
    if (name === "ig") {
      return `<svg ${common}><path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm10 2H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3zm-5 3.2A4.8 4.8 0 1 1 7.2 12 4.8 4.8 0 0 1 12 7.2zm0 2A2.8 2.8 0 1 0 14.8 12 2.8 2.8 0 0 0 12 9.2zM17.6 6.4a1 1 0 1 1-1 1 1 1 0 0 1 1-1z"/></svg>`;
    }
    // tiktok
    return `<svg ${common}><path d="M19.5 7.5c-1.2 0-2.4-.4-3.3-1.2v8.2a5.5 5.5 0 1 1-5.5-5.5c.3 0 .7 0 1 .1v2.7c-.3-.1-.6-.2-1-.2a2.8 2.8 0 1 0 2.8 2.8V2h2.7c.2 2 1.7 3.6 3.8 3.8v1.7z"/></svg>`;
  }

  function extMark() {
    // 右上角外連小箭頭
    return `<span class="bw-ext" aria-hidden="true">↗</span>`;
  }

  function render() {
    const root = document.getElementById("bw-footer");
    if (!root) return;

    // 避免重複插入
    if (root.dataset.ready === "1") return;
    root.dataset.ready = "1";

    root.innerHTML = `
      <footer class="bw-footer" role="contentinfo">
        <div class="bw-footer__inner">

          <!-- 左側：Logo + 社群 -->
          <div class="bw-footer__brand">
            <div class="bw-footer__logoBox">
              <div class="bw-footer__tiny">線上英語會話</div>
              <div class="bw-footer__logo">BookWide</div>
              <div class="bw-footer__social" aria-label="BookWide social links">
                <a class="bw-social" href="${LINKS.fb}" target="_blank" rel="noopener" aria-label="Facebook">${icon("fb")}</a>
                <a class="bw-social" href="${LINKS.yt}" target="_blank" rel="noopener" aria-label="YouTube">${icon("yt")}</a>
                <a class="bw-social" href="${LINKS.ig}" target="_blank" rel="noopener" aria-label="Instagram">${icon("ig")}</a>
                <a class="bw-social" href="${LINKS.tt}" target="_blank" rel="noopener" aria-label="TikTok">${icon("tt")}</a>
              </div>
            </div>
          </div>

          <!-- 右側：多欄連結（依照你圖） -->
          <div class="bw-footer__cols">

            <div class="bw-footer__row bw-footer__row--top">
              <div class="bw-footer__topTitle">BookWide</div>
              <div class="bw-footer__topLinks">
                <a href="${LINKS.home}">首頁</a>
                <a href="${LINKS.signup}">新用戶註冊</a>
                <a href="${LINKS.login}">登入</a>
                <a href="${LINKS.rejoin}">重新加入</a>
              </div>
            </div>

            <div class="bw-footer__grid">

              <div class="bw-col">
                <div class="bw-col__title">指南</div>
                <a class="bw-col__link" href="${LINKS.guide_first}">致初次使用者</a>
                <a class="bw-col__link" href="${LINKS.guide_howto}">使用方法</a>
                <a class="bw-col__link" href="${LINKS.guide_pricing}">關於費用</a>
                <a class="bw-col__link" href="${LINKS.guide_family}">關於家庭方案</a>
                <a class="bw-col__link" href="${LINKS.guide_browser}">支援的瀏覽器</a>
              </div>

              <div class="bw-col">
                <div class="bw-col__title">其他</div>
                <a class="bw-col__link" href="${LINKS.other_reviews}">問答結果 / 會員的心聲</a>
                <a class="bw-col__link" href="${LINKS.other_faq}" target="_blank" rel="noopener">常見問題 (FAQ) ${extMark()}</a>
              </div>

              <div class="bw-col bw-col--wide">
                <div class="bw-col__title">公司資訊</div>
                <a class="bw-col__link" href="${LINKS.company_sitemap}">網站導覽</a>
                <a class="bw-col__link" href="${LINKS.company_terms}">使用條款</a>
                <a class="bw-col__link" href="${LINKS.company_trade}">特別指定商業交易法</a>
                <a class="bw-col__link" href="${LINKS.company_privacy}">關於個人資訊處理</a>
                <a class="bw-col__link" href="${LINKS.company_jobs}" target="_blank" rel="noopener">徵才訊息 ${extMark()}</a>
              </div>

            </div>

          </div>
        </div>

        <!-- 底部公司資訊（依圖） -->
        <div class="bw-footer__bottom">
          <div class="bw-footer__bottomLine">
            聯鎖企業有限公司｜統一編號：53270306｜Taichung City, Taiwan
          </div>
          <div class="bw-footer__bottomLine">
            BookWide Enterprise Co., Ltd.　Tel: +886 4 24623591　e-mail : <a href="mailto:support@bookwide.net">support@bookwide.net</a>
          </div>
        </div>
      </footer>
    `;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();



