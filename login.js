/* ===========================
 * QUIZ 模組（逐題提交＋即時顯示正誤；全答完才出現總分/評語/列印）
 * 依賴：右側容器 id="pane-quiz"
 * 檔案來源：data/quiz-<slug>.json
 * 題型：mcq(單選)、tf(是非)、fill(填空)
 * =========================== */

(function () {
  const QUIZ_SEL = "#pane-quiz";

  let quizData = [];           // 原始題目
  let userAnswers = [];        // 使用者作答（每題）
  let questionDone = [];       // 每題是否已提交
  let score = 0;               // 累計分數
  let slug = null;             // 當前影片 slug

  // --- Utils ---
  function getSlug() {
    const u = new URL(location.href);
    return u.searchParams.get("slug") || "mid-autumn";
  }
  const $  = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>[...r.querySelectorAll(s)];

  // 比對填空：忽略大小寫、前後空白、多個空白壓成單一空白
  function normText(t) {
    return String(t || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  // 老師評語（可依需要調整門檻與文字）
  function teacherComment(pct) {
    if (pct >= 90) return "表現非常好！繼續保持 👏";
    if (pct >= 75) return "不錯喔，再多練習就更棒了 💪";
    if (pct >= 60) return "有進步空間，建議回看影片再作答 🙂";
    return "建議重看影片並複習單字，下次一定更好！📚";
  }

  // --- 載入與渲染 ---
  async function loadQuiz(slug) {
    const url = `data/quiz-${slug}.json?v=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("載入測驗失敗");
    const json = await res.json();

    // 允許兩種包法：{questions:[...]} 或直接是陣列
    return Array.isArray(json) ? json : (json.questions || []);
  }

  function renderQuiz() {
    const wrap = $(QUIZ_SEL);
    if (!wrap) return;

    wrap.innerHTML = `
      <div id="quizWrap" class="quiz-wrap" style="display:flex;flex-direction:column;gap:16px">
        <div id="quizList"></div>
        <div id="quizSummary" style="display:none;border-top:1px dashed #334;padding-top:12px">
          <div id="quizScore" style="font-weight:700;margin-bottom:6px"></div>
          <div id="quizTeacherCm" style="margin-bottom:8px;color:#a8c5ff"></div>
          <button id="btnPrintQuiz" class="btn" style="display:none">列印題目</button>
        </div>
      </div>
    `;

    const list = $("#quizList", wrap);
    list.innerHTML = "";

    quizData.forEach((q, i) => {
      const card = document.createElement("div");
      card.className = "q-card";
      card.style.cssText = "border:1px solid #233150;border-radius:10px;padding:12px;";

      let body = "";
      if (q.type === "mcq") {
        const opts = q.options || [];
        const radios = opts.map((opt, k) => `
          <label style="display:block;margin:6px 0;cursor:pointer">
            <input type="radio" name="q_${i}" value="${k}" style="margin-right:6px"> ${opt}
          </label>
        `).join("");
        body = `
          <div class="q-text" style="font-weight:700;margin-bottom:6px">${i+1}. ${q.q}</div>
          <div class="q-body">${radios}</div>
        `;
      } else if (q.type === "tf") {
        body = `
          <div class="q-text" style="font-weight:700;margin-bottom:6px">${i+1}. ${q.q}</div>
          <div class="q-body">
            <label style="display:inline-flex;align-items:center;margin-right:10px;cursor:pointer">
              <input type="radio" name="q_${i}" value="true" style="margin-right:6px"> True
            </label>
            <label style="display:inline-flex;align-items:center;cursor:pointer">
              <input type="radio" name="q_${i}" value="false" style="margin-right:6px"> False
            </label>
          </div>
        `;
      } else if (q.type === "fill") {
        body = `
          <div class="q-text" style="font-weight:700;margin-bottom:6px">${i+1}. ${q.q}</div>
          <input id="fill_${i}" type="text" placeholder="請輸入答案"
                 style="width:100%;max-width:520px;padding:8px;border-radius:8px;border:1px solid #2a3a5c;background:#0c1734;color:#e7eaf3">
        `;
      }

      card.innerHTML = `
        ${body}
        <div class="q-actions" style="margin-top:10px;display:flex;gap:8px;align-items:center">
          <button class="btn" data-act="submit" data-i="${i}">提交本題</button>
          <span id="fb_${i}" class="q-feedback" style="display:none;margin-left:6px;"></span>
        </div>
      `;

      list.appendChild(card);
    });

    // 綁定單題提交
    list.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act='submit']");
      if (!btn) return;
      const i = parseInt(btn.getAttribute("data-i"), 10);
      if (questionDone[i]) return; // 已提交過就不重算

      const correct = gradeOne(i);
      // 顯示 feedback
      const fb = $(`#fb_${i}`, wrap);
      fb.style.display = "inline-block";
      fb.textContent = correct ? "✔ 正確" : "✘ 錯誤";
      fb.style.color = correct ? "#2ee2a6" : "#ff6b6b";

      // 鎖定該題（禁用輸入）
      lockQuestion(i);

      // 如果全部都完成 → 顯示總分 + 評語 + 列印鈕
      if (questionDone.every(Boolean)) {
        showSummary();
      }
    });

    // 列印鈕
    $("#btnPrintQuiz", wrap).addEventListener("click", printQuiz);
  }

  // 鎖定題目的輸入與按鈕
  function lockQuestion(i) {
    questionDone[i] = true;
    // 禁用所有輸入
    $$(`[name="q_${i}"]`).forEach(el => el.disabled = true);
    const fill = $(`#fill_${i}`);
    if (fill) fill.disabled = true;
    // 禁用按鈕
    const btn = $(`button[data-act="submit"][data-i="${i}"]`);
    if (btn) {
      btn.disabled = true;
      btn.textContent = "已提交";
      btn.style.opacity = "0.7";
      btn.style.cursor = "not-allowed";
    }
  }

  // 單題判分（並累計全域分數/使用者答案）
  function gradeOne(i) {
    const q = quizData[i];
    let ok = false;
    let ans = null;

    if (q.type === "mcq") {
      const picked = $(`[name="q_${i}"]:checked`);
      if (!picked) {
        alert("請先選擇答案");
        return false;
      }
      ans = parseInt(picked.value, 10);
      ok = (ans === q.a);
    } else if (q.type === "tf") {
      const picked = $(`[name="q_${i}"]:checked`);
      if (!picked) {
        alert("請先選擇答案");
        return false;
      }
      ans = (picked.value === "true");
      ok = (ans === !!q.a);
    } else if (q.type === "fill") {
      const t = $(`#fill_${i}`);
      if (!t || !t.value.trim()) {
        alert("請先輸入答案");
        return false;
      }
      ans = t.value;
      ok = (normText(ans) === normText(q.a));
    }

    userAnswers[i] = ans;
    if (ok) score += 1;
    return ok;
  }

  // 顯示總結 & 啟用列印
  function showSummary() {
    const total = quizData.length;
    const pct = Math.round((score / total) * 100);

    $("#quizScore").textContent = `你的分數：${score} / ${total}（${pct}%）`;
    $("#quizTeacherCm").textContent = `老師評語：${teacherComment(pct)}`;

    $("#quizSummary").style.display = "block";
    $("#btnPrintQuiz").style.display = "inline-block";
  }

  // 列印：題目＋使用者作答＋正解＋分數/評語（A4 直式一張）
  function printQuiz() {
    const total = quizData.length;
    const pct = Math.round((score / total) * 100);
    const cm = teacherComment(pct);

    const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>測驗列印 - ${slug}</title>
  <style>
    @page { size: A4 portrait; margin: 16mm; }
    body{font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif; color:#111;}
    h1{margin:0 0 8px 0;font-size:18px}
    .meta{margin:0 0 16px 0;color:#333}
    .q{margin:12px 0;padding:10px;border:1px solid #ddd;border-radius:8px}
    .q b{display:block;margin-bottom:6px}
    .ans{margin-top:6px}
    .ok{color:#0a8754}
    .bad{color:#c92a2a}
  </style>
</head>
<body>
  <h1>英文影片測驗（${slug}）</h1>
  <div class="meta">
    分數：${score} / ${total}（${pct}%）<br>
    老師評語：${cm}
  </div>
  ${quizData.map((q, i) => {
      const ua = userAnswers[i];
      const correct = (q.type === "mcq")
        ? (ua === q.a)
        : (q.type === "tf")
          ? (ua === !!q.a)
          : (normText(ua) === normText(q.a));

      const uaText = (() => {
        if (q.type === "mcq") return q.options?.[ua] ?? "（未作答）";
        if (q.type === "tf")  return ua === true ? "True" : ua === false ? "False" : "（未作答）";
        return ua ?? "（未作答）";
      })();

      const rightText = (() => {
        if (q.type === "mcq") return q.options?.[q.a] ?? "";
        if (q.type === "tf")  return q.a ? "True" : "False";
        return q.a;
      })();

      return `
        <div class="q">
          <b>${i+1}. ${q.q}</b>
          <div>你的作答：${uaText}</div>
          <div class="ans">正確答案：${rightText}　${
            correct ? '<span class="ok">✔ 正確</span>' : '<span class="bad">✘ 錯誤</span>'
          }</div>
        </div>
      `;
    }).join("")}
  <script>window.print();</script>
</body>
</html>
    `;

    const w = window.open("", "_blank");
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  // --- 對外初始化（在切到「測驗」分頁時呼叫即可）---
  async function initQuizTab() {
    try {
      slug = getSlug();
      quizData = await loadQuiz(slug);
      userAnswers = new Array(quizData.length).fill(null);
      questionDone = new Array(quizData.length).fill(false);
      score = 0;
      renderQuiz();
    } catch (err) {
      const wrap = $(QUIZ_SEL);
      if (wrap) wrap.innerHTML = `<div style="color:#ff7575">載入測驗失敗：${err.message}</div>`;
      console.error(err);
    }
  }

  // 暴露給外部使用
  window.initQuizTab = initQuizTab;
})();
























































