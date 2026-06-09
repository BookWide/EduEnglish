// quiz.js  — 模組版（直接覆蓋）
// 匯出 initQuiz(slug) 供 player.js 呼叫

// ===== 工具：字串標準化 =====
// 目的：把 ' ’ “ ” 變成標準直引號；移除多餘空白、大小寫差異、變音符號等
function norm(s) {
  if (s == null) return '';
  return String(s)
    // 統一各種引號
    .replace(/[’‘‛`]/g, "'")
    .replace(/[“”„‟]/g, '"')
    // 轉半形
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')          // 去除變音符號（如 é -> e）
    .replace(/\s+/g, ' ')                     // 摺疊多空白
    .trim()                                   // 去頭尾空白
    .toLowerCase();                           // 大小寫不敏感
}

// 讀題庫
async function fetchQuiz(slug) {
  const url = `./data/quiz-${slug}.json`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`讀題庫失敗：${url} (${r.status})`);
  const raw = await r.json();
  return normalizeQuiz(raw);
}

// 統一題目結構 + 預先標準化正解與選項
function normalizeQuiz(raw) {
  const result = (raw || []).map((q, i) => {
    const type = (q.type || (q.options ? 'mcq' : 'sa')).toLowerCase();
    const question = q.question || q.q || '';
    const options = (q.options || q.choices || []).map(String);
    const answer = String(q.answer ?? q.ans ?? '');
    const explanation = q.explanation || q.ex || '';

    // 預先儲存標準化版本，判分時就不會出錯
    const answerKey = norm(answer);
    const optionKeys = options.map(norm);

    return {
      id: i + 1,
      type,               // 'mcq' | 'sa'
      question,
      options,
      optionKeys,
      answer,
      answerKey,
      explanation
    };
  });
  return result;
}

// ===== DOM 幫手 =====
const $  = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => [...el.querySelectorAll(sel)];

// ===== UI 產生 =====
function renderQuiz(list, questions) {
  list.innerHTML = '';
  const frag = document.createDocumentFragment();

  questions.forEach(q => {
    const li = document.createElement('li');
    li.dataset.id = q.id;
    li.style.margin = '12px 0';
    li.innerHTML = `
      <div style="font-weight:700;margin:6px 0">${q.id}. ${q.question}</div>
      <div class="quiz-body"></div>
      <div class="quiz-foot" style="margin-top:6px">
        <div class="quiz-msg" style="color:#9fb3d9"></div>
        <div class="quiz-ans" style="margin-top:4px;color:#9fb3d9;display:none">
          正解：<span class="ans-text"></span>
        </div>
      </div>
    `;
    const body = $('.quiz-body', li);
    const msg  = $('.quiz-msg', li);
    const ansBox = $('.quiz-ans', li);
    const ansText= $('.ans-text', li);
    ansText.textContent = q.answer;  // 顯示原始正解（不小寫、不去引號）

    if (q.type === 'mcq') {
      q.options.forEach((opt, idx) => {
        const row = document.createElement('label');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0;cursor:pointer';
        row.innerHTML = `
          <input type="radio" name="q${q.id}" value="${idx}" />
          <span>${opt}</span>
        `;
        const ipt = $('input', row);
        ipt.addEventListener('change', () => {
          const pickedKey = q.optionKeys[idx];        // 已標準化
          const ok = pickedKey === q.answerKey;
          li.dataset.correct = ok ? '1' : '0';
          msg.style.color = ok ? '#5bd3c7' : '#ff6b6b';
          msg.textContent = ok ? '✅ 正確' : '❌ 錯誤';
          if (!ok) ansBox.style.display = '';        // 答錯才自動顯示正解
        });
        body.appendChild(row);
      });
    } else {
      // SA：簡答
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0';
      wrap.innerHTML = `
        <input class="sa" type="text" placeholder="輸入答案…" 
               style="padding:8px 10px;border:1px solid #334155;border-radius:8px;background:#0f223b;color:#dbe7ff;min-width:260px"/>
        <button class="btnCheck" style="padding:6px 10px;border:1px solid #203057;background:#15224a;color:#fff;border-radius:6px;cursor:pointer">檢查</button>
      `;
      const ipt = $('.sa', wrap);
      const btn = $('.btnCheck', wrap);

      const doCheck = () => {
        const ok = norm(ipt.value) === q.answerKey;
        li.dataset.correct = ok ? '1' : '0';
        msg.style.color = ok ? '#5bd3c7' : '#ff6b6b';
        msg.textContent = ok ? '✅ 正確' : '❌ 錯誤';
        if (!ok) ansBox.style.display = '';
      };

      btn.addEventListener('click', doCheck);
      ipt.addEventListener('blur', doCheck);

      body.appendChild(wrap);
    }

    frag.appendChild(li);
  });

  list.appendChild(frag);
}

// 交卷評語
function commentFor(score) {
  if (score >= 100) return '滿分！太強了！集滿五張滿分可兌換一組 LINE 表情貼 🎉';
  if (score >= 90)  return '表現超棒！只差一步就滿分！繼續保持！';
  if (score >= 80)  return '很不錯！再複習幾題就更穩了！';
  if (score >= 70)  return '有進步！針對錯題回看影片會更有感！';
  if (score >= 60)  return '剛好及格！多練練就會更熟！';
  return '還差一點點～建議先看字幕再測驗，逐步累積就對了！';
}

// 列印（A4 單張）
function printReport({ slug, score, total, timeStr, listEl }) {
  const w = window.open('', '_blank');
  const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>成績單 - ${slug}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, Noto Sans, sans-serif; color:#111; }
  h1 { margin:0 0 6px; }
  .muted { color:#555; }
  .item { margin:10px 0; }
  .correct { color:#0a8a78; }
  .wrong { color:#c0392b; }
  .logo { height:40px; width:40px; background:#ddd; display:inline-block; vertical-align:middle; margin-right:8px; }
  .brand { font-weight:700; font-size:18px; }
</style>
</head>
<body>
  <div>
    <span class="logo"></span><span class="brand">（公司名稱）</span>
  </div>
  <h1>英語影片測驗 · ${slug}</h1>
  <div class="muted">${timeStr}</div>
  <h2>成績：${score} / 100（共 ${total} 題）</h2>
  <hr/>
  ${[...listEl.querySelectorAll('li')].map(li=>{
      const q = li.querySelector('.quiz-body')?.previousElementSibling?.textContent || '';
      const ans = li.querySelector('.ans-text')?.textContent || '';
      const ok = li.dataset.correct === '1';
      return `
        <div class="item">
          <div>${q}</div>
          <div class="${ok?'correct':'wrong'}">${ok?'✔ 已答對':'✘ 答錯'}；正解：${ans}</div>
        </div>`;
    }).join('')}
</body>
</html>`;
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}

// ===== 對外：初始化 =====
export default async function initQuiz(slug) {
  // 必備容器（存在才綁，不影響其他頁）
  const listEl   = $('#quizList');
  const submitEl = $('#btnSubmitQuiz');
  const printEl  = $('#btnPrintQuiz');
  const showEl   = $('#btnShowAnswer');
  const metaEl   = $('#quizMeta');

  if (!listEl) {
    console.warn('[quiz] #quizList not found (skip)');
    return;
  }

  // 題庫載入
  const questions = await fetchQuiz(slug);

  // UI
  renderQuiz(listEl, questions);
  if (metaEl) metaEl.textContent = `共 ${questions.length} 題（單選 / 簡答）`;

  // 顯示答案（切換）
  if (showEl) {
    showEl.addEventListener('click', () => {
      const vis = listEl.dataset.showAns === '1';
      listEl.dataset.showAns = vis ? '' : '1';
      $$('.quiz-ans', listEl).forEach(div => div.style.display = vis ? 'none' : '');
    });
  }

  // 交卷
  if (submitEl) {
    submitEl.addEventListener('click', () => {
      const total = questions.length;
      const correct = $$('#quizList li').filter(li => li.dataset.correct === '1').length;
      const score = Math.round((correct / total) * 100);

      if (metaEl) {
        metaEl.innerHTML =
          `你的分數：<b>${score}</b> / 100（已答對 ${correct} 題）　<span style="color:#9fb3d9">${commentFor(score)}</span>`;
      }
    });
  }

  // 列印
  if (printEl) {
    printEl.addEventListener('click', () => {
      const total = questions.length;
      const correct = $$('#quizList li').filter(li => li.dataset.correct === '1').length;
      const score = Math.round((correct / total) * 100);
      const timeStr = new Date().toLocaleString();
      printReport({ slug, score, total, timeStr, listEl });
    });
  }
}


