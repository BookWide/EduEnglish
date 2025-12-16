/* BookWide Shared Footer v1 */
(function(){
  const el = document.getElementById('bw-footer');
  if(!el) return;

  // 你之後如果要全站換內容，只要改這裡
  const links = {
    about: [
      { t:'關於我們', href:'/about.html' },
      { t:'新聞中心', href:'/news-center.html' },
      { t:'CEFR 分級', href:'/cefr.html' },
      { t:'教學中心', href:'/teaching.html' },
      { t:'學習專區', href:'/learning.html' },
    ],
    channels: [
      { t:'Story', href:'/index.html?cat=story' },
      { t:'Music', href:'/index.html?cat=music' },
      { t:'Movie', href:'/index.html?cat=movie' },
      { t:'News', href:'/index.html?cat=news' },
      { t:'Pro / Grammar', href:'/index.html?cat=pro' },
    ],
    services: [
      { t:'企業培訓', href:'/enterprise.html' },
      { t:'常見問題', href:'/faq.html' },
      { t:'合作夥伴', href:'/partners.html' },
      { t:'菁英榜單', href:'/leaderboard.html' },
    ],
    policy: [
      { t:'隱私權政策', href:'/privacy.html' },
      { t:'服務條款', href:'/terms.html' },
      { t:'著作權聲明', href:'/copyright.html' },
      { t:'網路安全提醒', href:'/security.html' },
    ],
    social: [
      // 先留空也可以，之後有正式連結再換
      { k:'fb',  title:'Facebook', href:'#', label:'f' },
      { k:'ig',  title:'Instagram', href:'#', label:'◎' },
      { k:'yt',  title:'YouTube', href:'#', label:'▶' },
      { k:'line',title:'LINE', href:'#', label:'LINE' },
      { k:'tt',  title:'TikTok', href:'#', label:'♪' },
    ],
  };

  const year = new Date().getFullYear();

  el.innerHTML = `
    <div class="bw-footer-wrap">
      <div class="bw-footer-grid">

        <div class="bw-col">
          <div class="bw-brand">
            <div class="bw-logo" aria-hidden="true"></div>
            <div>
              <h3>BookWide</h3>
              <p>
                ENGLISH LEARNING・影片<br/>
                字幕・測驗・單字・AI 互動<br/>
                價格、到期提醒與訂閱狀態以系統最新訂單為準。
              </p>
              <div class="bw-support">
                若需協助，請來信：<a href="mailto:support@bookwide.net">support@bookwide.net</a>
              </div>
            </div>
          </div>
        </div>

        <div class="bw-col">
          <h4>關於我們</h4>
          ${links.about.map(x=>`<a href="${x.href}">${x.t}</a>`).join('')}
        </div>

        <div class="bw-col">
          <h4>更多頻道</h4>
          ${links.channels.map(x=>`<a href="${x.href}">${x.t}</a>`).join('')}
        </div>

        <div class="bw-col">
          <h4>其他服務</h4>
          ${links.services.map(x=>`<a href="${x.href}">${x.t}</a>`).join('')}
        </div>

        <div class="bw-col">
          <h4>政策條款</h4>
          ${links.policy.map(x=>`<a href="${x.href}">${x.t}</a>`).join('')}
        </div>

        <div class="bw-col">
          <h4>聯絡我們</h4>

          <div class="bw-contact">
            <div class="bw-contact-item">
              <span class="bw-ico" aria-hidden="true">☎</span>
              <div>+886-4-24623591</div>
            </div>
            <div class="bw-contact-item">
              <span class="bw-ico" aria-hidden="true">✉</span>
              <div><a href="mailto:support@bookwide.net" style="color:var(--bw-footer-muted);text-decoration:none;">support@bookwide.net</a></div>
            </div>
            <div class="bw-contact-item">
              <span class="bw-ico" aria-hidden="true">⌖</span>
              <div>Taichung City, Taiwan</div>
            </div>
            <div class="bw-contact-item">
              <span class="bw-ico" aria-hidden="true">⏱</span>
              <div>週一～週五 14:00–22:00</div>
            </div>

            <div class="bw-social" aria-label="social links">
              ${links.social.map(s=>`
                <a href="${s.href}" title="${s.title}" aria-label="${s.title}">
                  <span style="font-size:${s.k==='line' ? '11px':'14px'};font-weight:${s.k==='line' ? '700':'600'}">${s.label}</span>
                </a>
              `).join('')}
            </div>

            <div class="bw-badges">
              <div class="bw-badge">
                <div class="left">
                  <div class="mark"></div>
                  <div class="txt">
                    <b>App Store</b>
                    <span>Download on the App Store</span>
                  </div>
                </div>
                <div class="tag">即將上架</div>
              </div>

              <div class="bw-badge">
                <div class="left">
                  <div class="mark">▶</div>
                  <div class="txt">
                    <b>Google Play</b>
                    <span>Get it on Google Play</span>
                  </div>
                </div>
                <div class="tag">即將上架</div>
              </div>
            </div>

          </div>
        </div>

      </div>

      <div class="bw-footer-bottom">
        <div>© ${year} BookWide ・建議使用最新 Chrome / Edge / Safari</div>
        <div>
          <a href="/sitemap.html">網站地圖</a>
          <span style="opacity:.6;">|</span>
          <a href="/privacy.html">Privacy policy</a>
        </div>
      </div>
    </div>
  `;
})();

