/* player.js  — V7.2 + Vocab(填空/朗讀/跳播/文法置中) 強化
   - 保留原有：影片/字幕/測驗（你的現有寫法）、左側工具列、跟隨/偏移
   - 單字分頁：例句填空、🔊朗讀、▶跳播、文法置於例句下方（不擠右欄）
   - Supabase 公桶優先、讀不到退本地（影片/字幕/單字）
=========================================================== */

(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // -------- DOM 參照（對齊你現有 player.html）--------
  const video      = $('#player');
  const videoWrap  = $('#videoWrap');

  // 左側工具列
  const btnPrev        = $('#btnPrev');
  const btnPlay        = $('#btnPlay');
  const btnNext        = $('#btnNext');
  const btnReplay      = $('#btnReplay');
  const btnAutoPause   = $('#btnAutoPause');
  const btnLoopSentence= $('#btnLoopSentence');
  const btnAB          = $('#btnAB');
  const btnPointLoop   = $('#btnPointLoop');
  const btnClearLoop   = $('#btnClearLoop');
  const btnFill        = $('#btnFill');
  const speedRange     = $('#speedRange');
  const speedVal       = $('#speedVal');

  // 右側：字幕
  const cuesBody   = $('#cuesBody');
  const cuesStatus = $('#cuesStatus');
  const chkFollow  = $('#chkFollow');
  const btnOffsetMinus = $('#btnOffsetMinus');
  const btnOffsetPlus  = $('#btnOffsetPlus');
  const offsetVal      = $('#offsetVal');

  // 分頁
  const tabs      = $$('.tab');
  const paneSub   = $('#pane-sub');
  const paneQuiz  = $('#pane-quiz');
  const paneVocab = $('#pane-vocab');
  const vocabStatus = $('#vocabStatus');
  const vocabBox    = $('#vocabBox');

  // -------- URL Query --------
  const params = new URLSearchParams(location.search);
  const slug   = params.get('slug') || 'mid-autumn';

  // -------- 狀態 --------
  let cues = [];           // {t,en,zh}
  let offset = 0;          // 偏移秒數（全域）
  let follow = true;       // 跟隨高亮
  let loopSentence = false;
  let abA = null, abB = null;
  let autoPause = false;

  // -------- 小工具 --------
  const toSec = (hhmmss) => {
    if (typeof hhmmss === 'number') return hhmmss;
    const p = String(hhmmss).split(':').map(Number);
    if (p.length === 3) return p[0]*3600 + p[1]*60 + p[2];
    if (p.length === 2) return p[0]*60 + p[1];
    return Number(hhmmss) || 0;
  };
  const fmt = (sec) => {
    sec = Math.max(0, sec|0);
    const m = (sec/60)|0, s = sec%60;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  };
  const esc = (s) => String(s??'')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

  // --- TTS 朗讀（英文）---
  function speak(text, rate=1){
    try{
      const u = new SpeechSynthesisUtterance(String(text||''));
      u.lang = 'en-US';
      u.rate = rate;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    }catch{}
  }

  const currentIndex = () => {
    const t = video.currentTime + offset;
    let i = 0;
    while (i+1 < cues.length && cues[i+1].t <= t + 0.0001) i++;
    return i;
  };
  const highlightRow = (idx) => {
    const trs = $$('#cuesBody tr');
    trs.forEach(tr=> tr.classList.remove('active'));
    const tr = trs[idx];
    if (tr) {
      tr.classList.add('active');
      if (follow) tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };
  const seekTo = (idx, play=true) => {
    if (!cues[idx]) return;
    video.currentTime = Math.max(0, cues[idx].t - offset + 0.0001);
    highlightRow(idx);
    if (play) video.play();
  };
  const sentenceRange = (idx) => {
    if (!cues[idx]) return [0,0];
    const s = cues[idx].t;
    const e = (idx+1<cues.length ? cues[idx+1].t : s+3);
    return [s,e];
  };

  // ================== Supabase 優先 + Fallback ==================
  let supa = null;
  (async () => {
    try { const m = await import('./videos/js/supa.js'); supa = m?.supa ?? null; }
    catch { supa = null; }
  })();

  const getPublicUrl = (bucket, path) => {
    if (!supa) return null;
    try { const { data } = supa.storage.from(bucket).getPublicUrl(path);
      return data?.publicUrl || null;
    } catch { return null; }
  };

  // 影片：Storage > 本地
  const resolveVideoUrl = async (sg) => {
    if (supa) {
      const u1 = getPublicUrl('videos', `${sg}.mp4`);
      if (u1) return u1;
    }
    return `./videos/${sg}.mp4`;
  };

  // 字幕：Storage cues/<slug>.json > 本地 data/cues-<slug>.json
  const resolveCues = async (sg) => {
    if (supa) {
      const u = getPublicUrl('cues', `${sg}.json`);
      if (u) {
        try {
          const rsp = await fetch(u, { cache:'no-store' });
          if (rsp.ok) {
            const json = await rsp.json();
            return (json||[]).map(r=>({ t: toSec(r.time), en:r.en||'', zh:r.zh||'' }));
          }
        } catch {}
      }
    }
    try {
      const rsp = await fetch(`./data/cues-${sg}.json`, { cache:'no-store' });
      if (rsp.ok) {
        const json = await rsp.json();
        return (json||[]).map(r=>({ t: toSec(r.time), en:r.en||'', zh:r.zh||'' }));
      }
    } catch {}
    return [];
  };

  // 單字：Storage vocab/<slug>.json > 本地 data/vocab-<slug>.json
  const resolveVocab = async (sg) => {
    if (supa) {
      const u = getPublicUrl('vocab', `${sg}.json`);
      if (u) {
        try { const rsp = await fetch(u, { cache:'no-store' }); if (rsp.ok) return await rsp.json(); } catch {}
      }
    }
    try { const rsp = await fetch(`./data/vocab-${sg}.json`, { cache:'no-store' }); if (rsp.ok) return await rsp.json(); } catch {}
    return null;
  };

  // ======================== 載入流程 ============================
  async function loadAll() {
    // 影片
    video.src = await resolveVideoUrl(slug);
    video.addEventListener('error', () => {
      if (cuesStatus) cuesStatus.textContent = `⚠️ 無法載入影片`;
    }, { once:true });

    // 字幕
    cues = await resolveCues(slug);
    renderCues();

    // 單字（即載）
    loadVocabUI();
  }

  // ------------------ 字幕表 -------------------
  function renderCues() {
    if (!cuesBody) return;
    cuesBody.innerHTML = '';
    if (!cues.length) { if(cuesStatus) cuesStatus.textContent = '⚠️ 查無字幕資料'; return; }
    if (cuesStatus) cuesStatus.textContent = '';

    cuesBody.innerHTML = cues.map((c,i)=>`
      <tr data-i="${i}">
        <td class="muted" style="width:80px">${c.t?fmt(c.t):''}</td>
        <td>${esc(c.en)}</td>
        <td style="width:40%">${esc(c.zh)}</td>
      </tr>
    `).join('');

    // 點列跳播
    $$('#cuesBody tr').forEach(tr=> tr.addEventListener('click', ()=>{
      const i = +tr.dataset.i;
      if (cuesBody.dataset.pointloop === '1') {
        loopSentence = true;
        btnLoopSentence?.classList.add('green');
      }
      seekTo(i, true);
    }));
  }

  // =================== 單字分頁（填空+朗讀+跳播+文法置中） ===================
  async function loadVocabUI(){
    if (!paneVocab) return;

    // 容器保險
    let vStatus = vocabStatus || $('#vocabStatus');
    let vBox    = vocabBox    || $('#vocabBox');
    if (!vStatus){
      vStatus = document.createElement('div');
      vStatus.id='vocabStatus';
      paneVocab.appendChild(vStatus);
    }
    if (!vBox){
      vBox = document.createElement('div');
      vBox.id='vocabBox';
      paneVocab.appendChild(vBox);
    }

    // 讀資料
    vStatus.textContent = '載入中…';
    const list = await resolveVocab(slug);
    if (!list || !list.length){ 
      vStatus.textContent='⚠️ 查無單字資料';
      vBox.innerHTML='';
      return; 
    }
    vStatus.textContent='';

    // 小工具：遮罩例句、跳播
    const maskSentence = (w, s) => {
      const word = String(w||'').trim();
      let txt = String(s||'');
      if (!word) return txt;
      const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\$&')}\\b`, 'ig');
      return txt.replace(re, '_____');
    };
    const go = (mmss) => {
      if(!video) return;
      const toS = (x)=>{
        if(typeof x==='number') return x;
        const p = String(x).split(':').map(Number);
        if(p.length===3) return p[0]*3600+p[1]*60+p[2];
        if(p.length===2) return p[0]*60+p[1];
        return Number(x)||0;
      };
      video.currentTime = Math.max(0,toS(mmss));
      video.play();
    };

    // 版面
    vBox.innerHTML = `
      <style>
        .voc-row{display:grid;grid-template-columns:120px 1fr 280px;gap:12px;padding:12px 10px;border-bottom:1px solid #14243b}
        .voc-time{display:flex;align-items:center;gap:8px;color:#9fb3d9}
        .voc-time .btn{border:1px solid #26406b;background:#0f223b;color:#dbe7ff;border-radius:8px;padding:4px 8px;cursor:pointer}
        .voc-core{min-width:0}
        .voc-sent{line-height:1.6}
        .voc-ipt{margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
        .voc-ipt input{padding:8px 10px;border:1px solid #334155;border-radius:8px;background:#0f223b;color:#dbe7ff;min-width:180px}
        .voc-ipt .ok{color:#5bd3c7}
        .voc-ipt .ng{color:#ff6b6b}
        .voc-gram{margin-top:6px;color:#9fb3d9;font-size:13px}
        .voc-right{border:1px solid #172a4a;background:#0f1a33;border-radius:10px;padding:10px}
        .voc-word{display:flex;align-items:center;gap:8px;font-weight:700;font-size:18px}
        .voc-pos{color:#9fb3d9;font-size:13px}
        .voc-zh{margin-top:6px}
        .voc-en{margin-top:2px;color:#9fb3d9;font-size:13px}
        .voc-actions{margin-top:8px;display:flex;gap:8px}
        .voc-actions .btn{border:1px solid #26406b;background:#0f223b;color:#dbe7ff;border-radius:8px;padding:4px 8px;cursor:pointer}
        @media(max-width:980px){ .voc-row{grid-template-columns:1fr} .voc-right{order:3} }
      </style>
      <div id="vocList"></div>
    `;
    const listBox = $('#vocList', vBox);

    // 渲染每一筆
    list.forEach((v)=>{
      const row = document.createElement('div');
      row.className = 'voc-row';

      // 左：時間/跳播
      const left = document.createElement('div');
      left.className = 'voc-time';
      left.innerHTML = `
        <button class="btn" data-act="jump">▶</button>
        <span class="time-link" style="cursor:pointer;text-decoration:underline;">${(v.time||'').toString()}</span>
      `;

      // 中：例句（填空）+ 文法（置中欄）
      const core = document.createElement('div');
      core.className = 'voc-core';
      const example = v.example || v.en || ''; // 沒 example 就用英文解釋
      core.innerHTML = `
        <div class="voc-sent">${esc(maskSentence(v.word, example))}</div>
        <div class="voc-ipt">
          <input type="text" placeholder="輸入這個空格的單字…" aria-label="answer">
          <button class="btn" data-act="check">檢查</button>
          <span class="msg"></span>
          <button class="btn" data-act="reveal">顯示答案</button>
        </div>
        ${v.grammar ? `<div class="voc-gram">文法：${esc(v.grammar)}</div>` : ``}
      `;

      // 右：答案卡 + 朗讀
      const right = document.createElement('div');
      right.className = 'voc-right';
      right.innerHTML = `
        <div class="voc-word">
          <span>${esc(v.word||'')}</span>
          <button class="btn" data-act="speak" title="朗讀 🔊">🔊</button>
        </div>
        <div class="voc-pos">${esc(v.pos||'')}</div>
        ${v.zh ? `<div class="voc-zh">${esc(v.zh)}</div>` : ``}
        ${v.en ? `<div class="voc-en">${esc(v.en)}</div>` : ``}
        <div class="voc-actions">
          <button class="btn" data-act="jump">跳到片段</button>
        </div>
      `;

      // 行為
      row.addEventListener('click', (e)=>{
        const act = e.target?.dataset?.act;
        if (!act) return;

        if (act==='jump'){ go(v.time||0); }
        else if (act==='speak'){ speak(v.word || v.en || v.example || v.zh || ''); }
        else if (act==='check'){
          const ipt = core.querySelector('input');
          const msg = core.querySelector('.msg');
          const ok = String(ipt.value||'').trim().toLowerCase()
                      === String(v.word||'').trim().toLowerCase();
          msg.textContent = ok ? '✅ 正確！' : '❌ 再試試';
          msg.className = `msg ${ok?'ok':'ng'}`;
        }
        else if (act==='reveal'){
          const ipt = core.querySelector('input');
          ipt.value = v.word||'';
          const msg = core.querySelector('.msg');
          msg.textContent = '（已填入答案）';
          msg.className = 'msg';
        }
      });

      // 點時間跳播
      left.querySelector('.time-link').addEventListener('click', ()=> go(v.time||0));

      row.appendChild(left);
      row.appendChild(core);
      row.appendChild(right);
      listBox.appendChild(row);
    });
  }

  // =================== 控制列 ===================
  if (speedRange) speedRange.addEventListener('input', ()=>{
    const r = Number(speedRange.value) || 1;
    video.playbackRate = r;
    if (speedVal) speedVal.textContent = `${r.toFixed(2)}x`;
  });

  btnPlay?.addEventListener('click', ()=>{ if(video.paused) video.play(); else video.pause(); });
  btnPrev?.addEventListener('click', ()=> seekTo(Math.max(0,currentIndex()-1),true));
  btnNext?.addEventListener('click', ()=> seekTo(Math.min(cues.length-1,currentIndex()+1),true));

  btnReplay?.addEventListener('click', ()=>{
    loopSentence = true;
    btnLoopSentence?.classList.add('green');
    seekTo(currentIndex(), true);
  });

  btnLoopSentence?.addEventListener('click', ()=>{
    loopSentence = !loopSentence;
    btnLoopSentence.classList.toggle('green', loopSentence);
  });

  btnAB?.addEventListener('click', ()=>{
    const now = video.currentTime + offset;
    if (abA === null) { abA = now; abB = null; btnAB.classList.add('green'); btnAB.textContent='🅱 設定 B（再次按取消）'; }
    else if (abB === null) { abB = now; if(abB<abA) [abA,abB]=[abB,abA]; btnAB.textContent='🅰🅱 A-B 循環中（再次按取消）'; }
    else { abA = abB = null; btnAB.classList.remove('green'); btnAB.textContent='🅰🅱 A-B 循環'; }
  });

  btnPointLoop?.addEventListener('click', ()=>{
    btnPointLoop.classList.toggle('green');
    if (cuesBody) cuesBody.dataset.pointloop = btnPointLoop.classList.contains('green') ? '1' : '';
  });

  btnClearLoop?.addEventListener('click', ()=>{
    loopSentence = false; abA = abB = null;
    btnLoopSentence?.classList.remove('green');
    btnAB?.classList.remove('green');
    if (btnAB) btnAB.textContent='🅰🅱 A-B 循環';
  });

  btnFill?.addEventListener('click', ()=>{
    // 切換填滿：#videoWrap.fill
    videoWrap?.classList.toggle('fill');
  });

  btnOffsetMinus?.addEventListener('click', ()=>{ offset -= 0.5; if(offsetVal) offsetVal.textContent=`${offset.toFixed(1)}s`; });
  btnOffsetPlus ?.addEventListener('click', ()=>{ offset += 0.5; if(offsetVal) offsetVal.textContent=`${offset.toFixed(1)}s`; });
  chkFollow    ?.addEventListener('change', ()=> follow = chkFollow.checked);
  btnAutoPause ?.addEventListener('click', ()=>{ autoPause=!autoPause; btnAutoPause.classList.toggle('green',autoPause); });

  // 播放事件（高亮、逐句暫停、單句循環、A-B 循環）
  video.addEventListener('timeupdate', ()=>{
    if (!cues.length) return;
    const i = currentIndex();
    highlightRow(i);
    const t = video.currentTime + offset;

    if (autoPause) {
      const [, e] = sentenceRange(i);
      if (t >= e - 0.02 && t < e + 0.2) video.pause();
    }
    if (loopSentence) {
      const [s, e] = sentenceRange(i);
      if (t >= e - 0.02) {
        video.currentTime = Math.max(0, s - offset + 0.0001);
        video.play();
      }
    }
    if (abA !== null && abB !== null) {
      if (t < abA || t >= abB - 0.02) {
        video.currentTime = Math.max(0, abA - offset + 0.0001);
        video.play();
      }
    }
  });

  // 分頁切換
  tabs.forEach(tab=>{
    tab.addEventListener('click', ()=>{
      tabs.forEach(x=>x.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      if (paneSub)   paneSub.style.display   = (name==='sub')  ? '' : 'none';
      if (paneQuiz)  paneQuiz.style.display  = (name==='quiz') ? '' : 'none';
      if (paneVocab) paneVocab.style.display = (name==='vocab')? '' : 'none';
    });
  });

  // 啟動
  (async function init(){
    const r = Number(speedRange?.value) || 1;
    video.playbackRate = r;
    if (speedVal) speedVal.textContent = `${r.toFixed(2)}x`;
    await loadAll();
  })();
})();
// ====== 以下整段覆蓋到 463 行之後 ======
async function bootQuizTab() {
  const pane = document.querySelector('#pane-quiz');
  if (!pane) return;

  // 讀 slug（與你播放器上方一致）
  const params = new URLSearchParams(location.search);
  const slug = params.get('slug') || 'mid-autumn';

  // 先放狀態
  pane.innerHTML = '（載入題目中…）';

  // 嘗試從 quiz.js 載入，失敗再退到 data/quiz-<slug>.json
  let questions = [];
  try {
    // 加 cache buster 以避免瀏覽器吃舊檔
    const mod = await import(`./quiz.js?v=${Date.now()}`);
    const src = mod.quizzes || mod.default || {};
    if (src && src[slug]) questions = Array.isArray(src[slug]) ? src[slug] : [];
  } catch (e) {
    // ignore; 退回到 data
  }
  if (!questions.length) {
    try {
      const r = await fetch(`./data/quiz-${slug}.json`, { cache: 'no-store' });
      if (r.ok) questions = await r.json();
    } catch { /* ignore */ }
  }

  if (!questions || !questions.length) {
    pane.textContent = '（尚未載入）';
    return;
  }

  // UI 容器
  pane.innerHTML = `
    <div id="quizToolbar" style="margin:8px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn" id="btnSubmitQuiz">交卷</button>
      <button class="btn" id="btnPrintReport" style="display:none">列印成績單</button>
      <button class="btn" id="btnToggleAns" style="display:none">顯示答案</button>
      <span id="quizMeta" class="muted"></span>
      <span id="quizCount" class="muted">共 ${questions.length} 題（單選 / 簡答）</span>
    </div>
    <ol id="quizList" style="line-height:1.6"></ol>
    <div id="quizScoreBox" style="margin-top:12px;display:none"></div>
  `;

  const listEl = document.getElementById('quizList');
  const metaEl = document.getElementById('quizMeta');
  const scoreBox = document.getElementById('quizScoreBox');
  const btnSubmit = document.getElementById('btnSubmitQuiz');
  const btnPrint = document.getElementById('btnPrintReport');
  const btnToggle = document.getElementById('btnToggleAns');

  // 工具：答案比對（忽略大小寫與多餘空白）
  // 取代舊的 norm，放在 463 行以下那段程式裡
const norm = s => String(s ?? '')
  .toLowerCase()
  // 移除變音符號 (é -> e, ü -> u …)
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  // 把各種彎引號等統一為普通撇或直接拿掉
  .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
  // 只保留英數字，其他通通換成空白（' 也去掉）
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();


  // 渲染一題
  const renderItem = (q, i) => {
    const li = document.createElement('li');
    li.style.margin = '10px 0';
    li.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px">${q.question || q.q || ''}</div>
      <div class="quiz-body"></div>
      <div class="quiz-result" style="margin-top:6px"></div>
      <div class="quiz-ans muted" style="margin-top:4px;display:none">正解：<span class="a"></span></div>
    `;
    const body = li.querySelector('.quiz-body');
    const res  = li.querySelector('.quiz-result');
    const ans  = li.querySelector('.quiz-ans .a');
    ans.textContent = q.answer ?? q.ans ?? '';

    // 單選題
    if (Array.isArray(q.options)) {
      q.options.forEach((opt, j) => {
        const id = `q${i}_${j}`;
        const row = document.createElement('div');
        row.innerHTML = `
          <label for="${id}" style="cursor:pointer;display:flex;gap:8px;align-items:center">
            <input type="radio" name="q${i}" id="${id}" value="${opt}">
            <span>${opt}</span>
          </label>
        `;
        body.appendChild(row);
      });
      // 即時判斷
      body.addEventListener('change', e => {
        if (e.target && e.target.name === `q${i}`) {
          const selected = e.target.value;
          const correct  = q.answer ?? q.ans ?? '';
          const ok = norm(selected) === norm(correct);
          res.textContent = ok ? '✅ 正確' : '❌ 錯誤';
          res.style.color = ok ? '#5bd3c7' : '#ff6b6b';
          li.dataset.answered = '1';
          li.dataset.correct  = ok ? '1' : '0';
          // 顯示正解
          li.querySelector('.quiz-ans').style.display = 'block';
        }
      });
    } else {
      // 簡答題
      const box = document.createElement('div');
      box.style.display = 'flex';
      box.style.gap = '8px';
      box.style.alignItems = 'center';
      box.innerHTML = `
        <input class="ipt" type="text" placeholder="請輸入答案…" 
               style="padding:8px 10px;border:1px solid #334155;border-radius:8px;background:#0f223b;color:#dbe7ff;min-width:220px">
        <button class="btn check">檢查</button>
      `;
      body.appendChild(box);
      const ipt = box.querySelector('.ipt');
      const btn = box.querySelector('.check');
      const doCheck = () => {
        const correct = q.answer ?? q.ans ?? '';
        const ok = norm(ipt.value) === norm(correct);
        res.textContent = ok ? '✅ 正確' : '❌ 錯誤';
        res.style.color = ok ? '#5bd3c7' : '#ff6b6b';
        li.dataset.answered = String(ipt.value.trim().length > 0 ? 1 : 0);
        li.dataset.correct  = ok ? '1' : '0';
        // 顯示正解
        li.querySelector('.quiz-ans').style.display = 'block';
      };
      btn.addEventListener('click', doCheck);
      ipt.addEventListener('keydown', e => { if (e.key === 'Enter') doCheck(); });
    }

    return li;
  };

  // 渲染所有題目
  listEl.innerHTML = '';
  questions.forEach((q, i) => listEl.appendChild(renderItem(q, i)));
  metaEl.textContent = '';

  // 交卷（統計）
  btnSubmit.addEventListener('click', () => {
    let answered = 0, correct = 0;
    listEl.querySelectorAll('li').forEach((li, i) => {
      // 補算未觸發即時判斷的題目（例如單選完全未選）
      if (!li.dataset.answered) {
        // 單選：看有沒有選中
        const any = li.querySelector('input[type="radio"]:checked');
        if (any) {
          const q = questions[i];
          const ok = norm(any.value) === norm(q.answer ?? q.ans ?? '');
          li.dataset.answered = '1';
          li.dataset.correct  = ok ? '1' : '0';
          const res = li.querySelector('.quiz-result');
          res.textContent = ok ? '✅ 正確' : '❌ 錯誤';
          res.style.color = ok ? '#5bd3c7' : '#ff6b6b';
          li.querySelector('.quiz-ans').style.display = 'block';
        } else {
          // 未作答算錯
          li.dataset.answered = '0';
          li.dataset.correct  = '0';
          const res = li.querySelector('.quiz-result');
          res.textContent = '❌ 錯誤（未作答）';
          res.style.color = '#ff6b6b';
          li.querySelector('.quiz-ans').style.display = 'block';
        }
      }
      if (li.dataset.answered === '1') answered++;
      if (li.dataset.correct  === '1') correct++;
    });

    const total = questions.length;
    const score = Math.round((correct / total) * 100);

    // 五組評語（含滿分+集點）
    let comment = '';
    if (score === 100) {
      comment = '滿分！太強了！集滿五張滿分可兌換一組 LINE 表情貼 🎉';
    } else if (score >= 90) {
      comment = '非常棒！只差一步到滿分，下一次挑戰就能拿滿分！';
    } else if (score >= 80) {
      comment = '表現不錯，再複習一下重點單字與句型，分數會更好！';
    } else if (score >= 60) {
      comment = '及格了！建議針對錯題回看影片，再練一次會更穩。';
    } else {
      comment = '先別氣餒！先把錯題的正解看一遍，再做第二次練習試試。';
    }

    scoreBox.style.display = 'block';
    scoreBox.innerHTML = `
      <div style="margin:8px 0;font-weight:700">你的分數：${score} / 100</div>
      <div style="color:#9fb3d9">${comment}</div>
    `;

    // 出現列印與顯示答案
    btnPrint.style.display = 'inline-block';
    btnToggle.style.display = 'inline-block';
  });

  // 顯示 / 隱藏 正解
  let showAns = false;
  btnToggle.addEventListener('click', () => {
    showAns = !showAns;
    btnToggle.textContent = showAns ? '隱藏答案' : '顯示答案';
    listEl.querySelectorAll('.quiz-ans').forEach(el => {
      el.style.display = showAns ? 'block' : 'none';
    });
  });

  // 列印成績單（A4 直式）
  btnPrint.addEventListener('click', () => {
    const total = questions.length;
    const correct = [...listEl.querySelectorAll('li')].filter(li => li.dataset.correct === '1').length;
    const score = Math.round((correct / total) * 100);

    const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>成績單 · ${slug}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", "Microsoft JhengHei", Arial, sans-serif; color:#111; }
  h1 { font-size:20px; margin:0 0 4px; }
  .muted { color:#555; }
  .logo { width:120px;height:40px;border:1px dashed #ccc; display:inline-block; vertical-align:middle; text-align:center; line-height:40px; color:#888; }
  .hdr { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
  .q { margin:10px 0; }
  .ok { color:#0a7d6c; }
  .bad{ color:#c0392b; }
  .small { color:#666;font-size:12px }
  .ans { margin-top:4px;color:#333 }
</style>
</head>
<body>
  <div class="hdr">
    <div>
      <h1>成績單（${slug}）</h1>
      <div class="small">得分：${score} / 100　日期：${new Date().toLocaleString()}</div>
    </div>
    <div class="logo">LOGO</div>
  </div>
  <hr>
  <div>
    ${questions.map((q, i) => {
      const li = listEl.children[i];
      const user = (() => {
        // 取使用者作答
        const checked = li.querySelector('input[type="radio"]:checked');
        if (checked) return checked.value;
        const ipt = li.querySelector('.ipt');
        return ipt ? ipt.value : '';
      })();
      const correct = q.answer ?? q.ans ?? '';
      const ok = norm(user) === norm(correct);
      const res = ok ? '<span class="ok">✔ 正確</span>' : '<span class="bad">✘ 錯誤</span>';
      return `
        <div class="q">
          <div><b>${i+1}. ${q.question || q.q || ''}</b>　${res}</div>
          ${Array.isArray(q.options) ? `<div class="small">選項：${q.options.join(' / ')}</div>` : ''}
          <div class="small">你的作答：${user ? user : '（未作答）'}</div>
          <div class="ans">正解：${correct}</div>
        </div>`;
    }).join('')}
  </div>
  <script>window.print();</script>
</body>
</html>`;
    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  });
}

// 預防有的頁面先載到、或切頁沒觸發就進來
try { bootQuizTab(); } catch (e) { console.error('[quiz] boot error:', e); }
// ====== 覆蓋段落結束 ======




















































































