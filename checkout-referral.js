// checkout-referral.js
// 功能：解析 URL → 渲染各主題金額 → 顯示推薦碼(若存在) → 計算折扣、總額
// 不會直接 submit 到綠界（只負責畫面＆金額）

// ---- 基本定價（每主題） ----
const PRICE_MAP = {
  month: 200,        // NT$200 / 月 / 主題
  half:  960,        // NT$960 / 半年 / 主題
  year:  1680        // NT$1680 / 年 / 主題
};
const PERIOD_LABEL = { month: "月", half: "半年", year: "年" };

// ---- DOM ----
const planTagsEl        = document.getElementById("planTags");
const periodTagEl       = document.getElementById("periodTag");
const itemsRowsEl       = document.getElementById("itemsRows");
const refBadgeEl        = document.getElementById("refBadge");
const discountRowEl     = document.getElementById("discountRow");
const discountAmountEl  = document.getElementById("discountAmount");
const subtotalAmountEl  = document.getElementById("subtotalAmount");
const taxAmountEl       = document.getElementById("taxAmount");
const totalAmountEl     = document.getElementById("totalAmount");
const payBtn            = document.getElementById("payBtn");

// ---- 解析 URL ----
const params = new URLSearchParams(location.search);
const itemsParam  = params.get("items") || "";          // e.g. "story,music"
const periodParam = (params.get("period") || "month").toLowerCase();

const chosenItems = itemsParam
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const perSubjectPrice = PRICE_MAP[periodParam] ?? PRICE_MAP.month;

// ---- 畫面：週期 & 方案 chips ----
periodTagEl.textContent = PERIOD_LABEL[periodParam] || "月";
planTagsEl.innerHTML = "";
chosenItems.forEach(name => {
  const tag = document.createElement("span");
  tag.className = "chip";
  tag.textContent = name;
  planTagsEl.appendChild(tag);
});

// ---- 建立單一 row（主題 + 金額） ----
function row(text, money) {
  const wrap = document.createElement("div");
  wrap.className = "row";
  const left = document.createElement("div");
  left.textContent = text;
  const right = document.createElement("div");
  right.className = "money";
  right.textContent = formatMoney(money);
  wrap.append(left, right);
  return wrap;
}

function formatMoney(n) {
  return `$${Number(n).toLocaleString()}`;
}

// ---- 讀推薦碼（優先順序：URL ?ref=xxx → localStorage） ----
function getReferralCode() {
  const urlRef = params.get("ref");
  if (urlRef) return urlRef;

  // 與 referral.html 對應的儲存 key（你前面頁面用的，可改成一致的 key）
  const lsKeys = ["bw_referral_code", "referral_code", "bw_ref_code"];
  for (const k of lsKeys) {
    const v = localStorage.getItem(k);
    if (v) return v;
  }
  return "";
}

const referralCode = getReferralCode();
if (referralCode) {
  refBadgeEl.textContent = referralCode;
  refBadgeEl.classList.remove("muted");
} else {
  refBadgeEl.textContent = "無推薦碼";
  refBadgeEl.classList.add("muted");
}

// ---- 渲染主題明細 ----
itemsRowsEl.innerHTML = "";
let subtotal = 0;
for (const item of chosenItems) {
  // 每主題金額
  itemsRowsEl.appendChild(row(item, perSubjectPrice));
  subtotal += perSubjectPrice;
}

// ---- 折扣（如果有推薦碼：9 折） ----
let discount = 0;
if (referralCode) {
  discount = Math.round(subtotal * 0.1); // 顯示「已套用 9 折」→ 折抵 10%
  discountAmountEl.textContent = `-${formatMoney(discount)}`;
  discountRowEl.classList.remove("hide");
} else {
  discountRowEl.classList.add("hide");
}

// ---- 稅額＆總額 ----
const tax = 0;
const total = subtotal - discount + tax;

subtotalAmountEl.textContent = formatMoney(subtotal);
taxAmountEl.textContent      = formatMoney(tax);
totalAmountEl.textContent    = formatMoney(total);

// ---- 付款按鈕（僅示範：導去你的 edge function 建立訂單 → 再轉綠界） ----
payBtn.addEventListener("click", () => {
  // 這裡先保留空白：不直接送綠界
  // 你要串 edge function 時，用 fetch 呼叫自己的 create-order，
  // 將 { items: chosenItems, period: periodParam, total, referral_code: referralCode } 帶過去，
  // 再把回傳的支付頁 URL 導轉即可。
  alert("目前僅顯示結帳金額，未直接送出。");
});


