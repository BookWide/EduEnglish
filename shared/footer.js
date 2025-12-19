// /shared/footer-patch.js
// Non-invasive patch layer:
// 1) Replace mailto:support@bookwide.net with a friendly /contact.html page (avoid Windows Mail popups)
// 2) Ensure a floating LINE button exists (bottom-right)
//
// Usage: include AFTER /shared/footer.js
// <script defer src="/shared/footer.js?v=..."></script>
// <script defer src="/shared/footer-patch.js?v=20251219"></script>

(function () {
  function onReady(fn){
    if (document.readyState === 'complete' || document.readyState === 'interactive') return fn();
    document.addEventListener('DOMContentLoaded', fn, { once:true });
  }

  function fixSupportLinks(){
    const targets = Array.from(document.querySelectorAll('a[href]'))
      .filter(a => {
        const href = (a.getAttribute('href') || '').trim();
        return /^mailto:/i.test(href) && href.toLowerCase().includes('support@bookwide.net');
      });

    for (const a of targets){
      a.setAttribute('href', '/contact.html');
      a.setAttribute('title', '聯絡我們');
      // If the anchor text is exactly the email, keep it; otherwise leave as-is.
    }
  }

  function ensureLineBubble(){
    if (document.getElementById('bw-line-float')) return;

    // ✅ Put your LINE official account / invite link here:
    // Example: https://line.me/R/ti/p/@yourid  or https://line.me/ti/p/xxxxxxxx
    const LINE_URL = window.BW_LINE_URL || 'https://line.me/R/ti/p/@YOUR_LINE_ID';

    const a = document.createElement('a');
    a.id = 'bw-line-float';
    a.href = LINE_URL;
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = 'LINE 聯絡 BookWide';

    // You can place the icon at /assets/line.png (recommended)
    // If you already have a different path, just change ICON_URL.
    const ICON_URL = window.BW_LINE_ICON || '/assets/line.png';

    a.innerHTML = `<img alt="LINE" src="${ICON_URL}">`;

    const css = document.createElement('style');
    css.textContent = `
      #bw-line-float{
        position: fixed;
        right: 18px;
        bottom: 18px;
        width: 56px;
        height: 56px;
        border-radius: 999px;
        background: rgba(255,255,255,.92);
        border: 1px solid rgba(15,23,42,.12);
        box-shadow: 0 10px 30px rgba(15,23,42,.18);
        display:flex;
        align-items:center;
        justify-content:center;
        z-index: 9999;
        transition: transform .12s ease, box-shadow .12s ease;
      }
      #bw-line-float:hover{
        transform: translateY(-1px);
        box-shadow: 0 14px 34px rgba(15,23,42,.22);
      }
      #bw-line-float img{
        width: 34px;
        height: 34px;
        display:block;
      }
      @media (max-width: 520px){
        #bw-line-float{ right: 14px; bottom: 14px; width: 52px; height: 52px; }
        #bw-line-float img{ width: 32px; height: 32px; }
      }
    `;
    document.head.appendChild(css);
    document.body.appendChild(a);
  }

  onReady(() => {
    // footer.js is defer-loaded; wait a tick for it to render footer DOM
    setTimeout(() => {
      fixSupportLinks();
      ensureLineBubble();
    }, 60);
  });
})();
