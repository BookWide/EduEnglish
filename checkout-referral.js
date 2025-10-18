<!-- 如果你是用 <script type="module" src="checkout-referral.js"></script> 引入，覆蓋這個檔案即可 -->
<script type="module">
// === checkout-referral.js · fixed ===
// 僅負責：讀取網址上的 ?ref= 並在「有帶」時儲存；沒帶就清除，避免殘留

const STORAGE_KEY = 'ref_code';

/** 讀URL參數 */
const p = new URLSearchParams(location.search);
const ref = (p.get('ref') || '').trim();

/** 有帶推薦碼就更新，沒帶就清空 */
try {
  if (ref) {
    localStorage.setItem(STORAGE_KEY, ref);
    console.debug('[referral] stored from URL:', ref);
  } else {
    localStorage.removeItem(STORAGE_KEY);
    console.debug('[referral] cleared (no ref in URL)');
  }
} catch (e) {
  console.warn('[referral] localStorage error:', e);
}

/** 導出工具（如果其他頁面要用可以匯入） */
export function getReferralCode() {
  try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
}
export function clearReferralCode() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}
</script>

