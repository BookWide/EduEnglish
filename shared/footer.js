// BookWide Shared Footer Injector (v1)
(function(){
  const mount = document.getElementById('bw-footer');
  if(!mount) return;

  // 避免重複注入
  if(mount.dataset.ready === '1') return;
  mount.dataset.ready = '1';

  // 今年
  const year = new Date().getFullYear();

  // 你要正式填的資訊（先給安全預設）
  const COMPANY = {
    name: "BookWide",
    legal: "BookWide",
    phone: "+886-2-0000-0000",
    serviceHours: "週一～週五 14:00–22:00",
    email: "support@bookwide.net",
    address: "Taipei City, Taiwan",
    vat: "統一編號：（待填）",
  };

  const icon = {
    phone: `<svg class="bw-ico" viewBox="0 0 24 24" fill="none"><path d="M6.6 10.8c1.6 3.1 3.5 5 6.6 6.6l2.2-2.2c.3-.3.7-.4 1.1-.3 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.1 21 3 13.9 3 5c0-.6.4-1 1-1h3.3c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.3 1.1L6.6 10.8Z" fill="currentColor"/></svg>`,
    mail: `<svg class="bw-ico" viewBox="0 0 24 24" fill="none"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5v-11Zm2.3-.7 5.3 4.2c.3.2.7.2 1 0l5.3-4.2H6.3Zm11.9 1.8-4.8 3.8 4.8 4V7.6Zm-.9 10.9-5-4.2-.3.2c-.6.4-1.4.4-2 0l-.3-.2-5 4.2h12.6ZM5.8 15.6l4.8-4-4.8-3.8v7.8Z" fill="currentColor"/></svg>`,
    pin: `<svg class="bw-ico" viewBox="0 0 24 24" fill="none"><path d="M12 22s7-5.2 7-12a7 7 0 1 0-14 0c0 6.8 7 12 7 12Zm0-9.2a2.8 2.8 0 1 1 0-5.6 2.8 2.8 0 0 1 0 5.6Z" fill="currentColor"/></svg>`,
    fb: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 22v-8h2.8l.4-3H13.5V9.1c0-.9.3-1.5 1.6-1.5h1.7V5c-.3 0-1.5-.1-2.9-.1-2.9 0-4.9 1.8-4.9 5V11H6v3h3.3v8h4.2Z"/></svg>`,
    ig: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm10 2H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3Zm-5 4.2A3.8 3.8 0 1 1 8.2 12 3.8 3.8 0 0 1 12 8.2Zm0 2A1.8 1.8 0 1 0 13.8 12 1.8 1.8 0 0 0 12 10.2ZM17.7 7.4a.9.9 0 1 1-.9-.9.9.9 0 0 1 .9.9Z"/></svg>`,
    yt: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M21.6 7.2a2.7 2.7 0 0 0-1.9-1.9C18 5 12 5 12 5s-6 0-7.7.3A2.7 2.7 0 0 0 2.4 7.2 28.5 28.5 0 0 0 2 12c0 1.6.1 3.2.4 4.8a2.7 2.7 0 0 0 1.9 1.9C6 19 12 19 12 19s6 0 7.7-.3a2.7 2.7 0 0 0 1.9-1.9c.3-1.6.4-3.2.4-4.8s-.1-3.2-.4-4.8ZM10 15V9l6 3-6 3Z"/></svg>`,
    line: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c5.2 0 9.5 3.3 9.5 7.4 0 3.7-3.4 6.7-8 7.3-.3 0-.7.2-.8.5l-1 2.2c-.2.4-.8.4-1 0l-1-2.2c-.1-.3-.4-.5-.8-.5-4.6-.6-8-3.6-8-7.3C2.5 6.3 6.8 3 12 3Zm-3 6.2c-.4 0-.7.3-.7.7v4c0 .4.3.7.7.7s.7-.3.7-.7v-4c0-.4-.3-.7-.7-.7Zm3 0c-.4 0-.7.3-.7.7v4c0 .4.3.7.7.7s.7-.3.7-.7v-1.5l1.7 1.9c.2.2.5.3.8.2.3-.1.5-.4.5-.7v-4c0-.4-.3-.7-.7-.7s-.7.3-.7.7v1.7L12.8 9.4a.7.7 0 0 0-.6-.2ZM17.5 9.2h-1.8c-.4 0-.7.3-.7.7v4c0 .4.3.7.7.7h1.8c.4 0 .7-.3.7-.7s-.3-.7-.7-.7h-1.1v-.9h1c.4 0 .7-.3.7-.7s-.3-.7-.7-.7h-1v-.8h1.1c.4 0 .7-.3.7-.7s-.3-.7-.7-.7Z"/></svg>`,
    tiktok: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16 3c.3 2.2 1.9 3.9 4 4.2V11c-1.6 0-3-.5-4-1.3v6.5c0 3.3-2.7 6-6 6s-6-2.7-6-6 2.7-6 6-6c.4 0 .7 0 1 .1v3.6c-.3-.2-.7-.3-1-.3-1.3 0-2.4 1.1-2.4 2.4 0 1.3 1.1 2.4 2.4 2.4 1.6 0 2.6-1 2.6-3V3h3.4Z"/></svg>`,
  };

  // ⚠️ 這些 link 你之後可以換成真的頁面
  const links = {
    about: [
      ["關於我們", "/about.html"],
      ["新聞中心", "/news.html"],
      ["CEFR 分級", "/cefr.html"],
      ["教學中心", "/help.html"],
      ["學習專區", "/learning.html"],
    ],
    channels: [
      ["Story", "/?cat=story"],
      ["Music", "/?cat=music"],
      ["Movie", "/?cat=movie"],
      ["News", "/?cat=news"],
      ["Pro / Grammar", "/?cat=pro"],
    ],
    services: [
      ["企業培訓", "/enterprise.html"],
      ["常見問題", "/faq.html"],
      ["合作夥伴", "/partners.html"],
      ["菁英榜單", "/leaderboard.html"],
    ],
    policy: [
      ["隱私權政策", "/privacy.html"],
      ["服務條款", "/terms.html"],
      ["著作權聲明", "/copyright.html"],
      ["網路安全提醒", "/security.html"],
    ],
    contact: {
      phone: COMPANY.phone,
      hours: COMPANY.serviceHours,
      email: COMPANY.email,
      addr: COMPANY.address,
    },
    social: [
      ["Facebook", "#", icon.fb],
      ["Instagram", "#", icon.ig],
      ["YouTube", "#", icon.yt],
      ["LINE", "#", icon.line],
      ["TikTok", "#", icon.tiktok],
    ],
  };

  const li = (arr)=> arr.map(([t,h])=>`<li><a href="${h}">${t}</a></li>`).join("");

  mount.innerHTML = `
    <footer class="bw-footer">
      <div class="bw-wrap">
        <div class="bw-grid">
          <div class="bw-brand">
            <div class="bw-logo">
              <div class="bw-mark" aria-hidden="true"></div>
              <div>
                <div class="bw-name">${COMPANY.name}</div>
                <div class="bw-tag">ENGLISH LEARNING · 影片字幕 · 測驗 · 單字 · AI 互動</div>
              </div>
            </div>
            <div class="bw-tag">
              價格、到期提醒與訂閱狀態以系統最新訂單為準。<br>
              若需協助，請來信 <a href="mailto:${COMPANY.email}">${COMPANY.email}</a>
            </div>
          </div>

          <div>
            <h4>關於我們</h4>
            <ul>${li(links.about)}</ul>
          </div>

          <div>
            <h4>更多頻道</h4>
            <ul>${li(links.channels)}</ul>
          </div>

          <div>
            <h4>其他服務</h4>
            <ul>${li(links.services)}</ul>
          </div>

          <div>
            <h4>政策條款</h4>
            <ul>${li(links.policy)}</ul>
          </div>

          <div>
            <h4>聯絡我們</h4>
            <div class="bw-contact">
              <div class="row">${icon.phone}<div>${links.contact.phone}</div></div>
              <div class="row">${icon.mail}<div><a href="mailto:${links.contact.email}">${links.contact.email}</a></div></div>
              <div class="row">${icon.pin}<div>${links.contact.addr}<br><span style="color:var(--bw-footer-muted);font-size:12px;">${links.contact.hours}</span></div></div>
            </div>

            <div class="bw-social" aria-label="追蹤我們">
              ${links.social.map(([title,href,svg])=>`
                <a href="${href}" target="_blank" rel="noopener" title="${title}" aria-label="${title}">
                  ${svg}
                </a>`).join("")}
            </div>

            <div class="bw-store" aria-label="下載 App">
              <a class="bw-badge" href="#" target="_blank" rel="noopener">
                 App Store <small>（即將上架）</small>
              </a>
              <a class="bw-badge" href="#" target="_blank" rel="noopener">
                ▶ Google Play <small>（即將上架）</small>
              </a>
            </div>
          </div>
        </div>

        <div class="bw-bottom">
          <div>© ${year} ${COMPANY.legal}. All rights reserved.</div>
          <div>
            <a href="/privacy.html">Privacy</a> ·
            <a href="/terms.html">Terms</a> ·
            <a href="/security.html">Security</a>
          </div>
        </div>
      </div>
    </footer>
  `;
})();
