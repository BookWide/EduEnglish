/* player.js — V7.3 最終版
   - 分頁：字幕 / 測驗 / 單字
   - 測驗：四分區（Vocabulary / Grammar / Reading / Mixed），上方切換、下方三鍵
   - 單字：詞卡樣式（與你要的 UI class 對齊）
   - 列印：表頭（logo / 機構名 / 日期 / 分數 / 評語）
   - 不依賴外部框架；題庫/字幕/單字皆讀 ./data 下檔案，影片讀 ./videos/<slug>.mp4
*/

(() => {
  const $  = (s, el=document) => el.querySelector(s);
  const $$ = (s, el=document) => [...el.querySelectorAll(s)];

  // DOM
  const video      = $('#player');
  const videoWrap  = $('#videoWrap');

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

  const tabs      = $$('.tab');
  const paneSub   = $('#pane-sub');
  const paneQuiz  = $('#pane-quiz');
  const paneVocab = $('#pane-vocab');

  const cuesBody   = $('#cuesBody');
  const cuesStatus = $('#cuesStatus');
  const chkFollow  = $('#chkFollow');
  const btnOffsetMinus = $('#btnOffsetMinus');
  const btnOffsetPlus  = $('#btnOffsetPlus');
  const offsetVal      = $('#offsetVal');

  // URL
  const params = new URLSearchParams(location.search);
  const slug   = params.get('slug') || 'mid-autumn';

  // 狀態
  let cues = [];
  let offset = 0;
  let follow = true;
  let loopSentence = false;
  let abA = null, abB = null;
  let autoPause = false;

  // utils
  const toSec = (t) => {
    if (typeof t === 'number') return t;
    const p = String(t).split(':').map(Number);
    if (p.length===3) return p[0]*3600 + p[1]*60 + p[2];
    if (p.length===2) return p[0]*60 + p[1];
    return Number(t)||0;
  };
  const fmt = (sec) => {
    sec=Math.max(0, sec|0); const m=(sec/60)|0, s=sec%60;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  };
  const esc = (s) => String(s??'')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

  // ====== 載入 ======
  async function loadVideo() {
    video.src = `./videos/${slug}.mp4`;
    video.addEventListener('error',()=>{ if(cuesStatus) cuesStatus.textContent='⚠️ 無法載入影片';},{once:true});
  }
  async function loadCues() {
    try{
      const r = await fetch(`./data/cues-${slug}.json?v=${Date.now()}`,{cache:'no-store'});
      if(!r.ok) throw 0;
      const json = await r.json();
      cues = (json||[]).map(x=>({t:toSec(x.time), en:x.en||'', zh:x.zh||''}));
    }catch{ cues = []; }
    renderCues();
  }
  function renderCues(){
    cuesBody.innerHTML='';
    if(!cues.length){ cuesStatus.textContent='⚠️ 查無字幕資料'; return; }
    cuesStatus.textContent='';
    cuesBody.innerHTML = cues.map((c,i)=>`
      <tr data-i="${i}">
        <td class="muted" style="width:80px">${c.t?fmt(c.t):''}</td>
        <td>${esc(c.en)}</td>
        <td style="width:40%">${esc(c.zh)}</td>
      </tr>
    `).join('');
    $$('#cuesBody tr').forEach(tr=> tr.addEventListener('click',()=>{
      const i=+tr.dataset.i;
      if (cuesBody.dataset.pointloop==='1'){ loopSentence=true; btnLoopSentence?.classList.add('green'); }
      seekTo(i,true);
    }));
  }

  const currentIndex = () => {
    const t = video.currentTime + offset;
    let i=0; while(i+1<cues.length && cues[i+1].t <= t+0.0001) i++; return i;
  };
  const highlightRow = (idx) => {
    const trs = $$('#cuesBody tr'); trs.forEach(tr=>tr.classList.remove('active'));
    const tr = trs[idx]; if(!tr) return; tr.classList.add('active');
    if (follow) tr.scrollIntoView({block:'center',behavior:'smooth'});
  };
  const seekTo = (idx, play=true) => {
    if(!cues[idx]) return;
    video.currentTime = Math.max(0,cues[idx].t - offset + 0.0001);
    highlightRow(idx); if(play) video.play();
  };
  const sentenceRange = (idx)=>{
    if(!cues[idx]) return [0,0];
    const s=cues[idx].t, e=(idx+1<cues.length?cues[idx+1].t:s+3);
    return [s,e];
  };

  // ====== 單字（詞卡） ======
  async function loadVocabUI(){
    const vStatus = $('#vocabStatus'), vBox = $('#vocabBox');
    vStatus.textContent='載入中…';
    let list=null;
    try{
      const r=await fetch(`./data/vocab-${slug}.json?v=${Date.now()}`,{cache:'no-store'});
      if(r.ok) list=await r.json();
    }catch{}
    if(!list||!list.length){ vStatus.textContent='⚠️ 查無單字資料'; vBox.innerHTML=''; return; }
    vStatus.textContent='';

    const maskSentence=(w,s)=>{
      const word=String(w||'').trim(); let txt=String(s||'');
      if(!word) return txt;
      const re=new RegExp(`\\b${word.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\$&')}\\b`,'ig');
      return txt.replace(re,'_____');
    };
    const go=(mmss)=>{ const p=toSec(mmss); video.currentTime=Math.max(0,p); video.play(); };

    vBox.innerHTML = '<div id="vocList"></div>';
    const listBox = $('#vocList', vBox);

    list.forEach(v=>{
      const row=document.createElement('div'); row.className='voc-row';

      const left=document.createElement('div'); left.className='voc-time';
      left.innerHTML=`<button class="btn" data-act="jump">▶</button>
                      <span class="time-link">${(v.time||'').toString()}</span>`;

      const core=document.createElement('div'); core.className='voc-core';
      const example = v.example || v.en || '';
      core.innerHTML=`
        <div class="voc-sent">${esc(maskSentence(v.word, example))}</div>
        <div class="voc-ipt">
          <input type="text" placeholder="輸入這個空格的單字…" aria-label="answer">
          <button class="btn" data-act="check">檢查</button>
          <span class="msg"></span>
          <button class="btn" data-act="reveal">顯示答案</button>
        </div>
        ${v.grammar?`<div class="voc-gram">文法：${esc(v.grammar)}</div>`:''}
      `;

      const right=document.createElement('div'); right.className='voc-right';
      right.innerHTML=`
        <div class="voc-word">
          <span>${esc(v.word||'')}</span>
          <button class="btn" data-act="speak" title="朗讀 🔊">🔊</button>
        </div>
        <div class="voc-pos">${esc(v.pos||'')}</div>
        ${v.zh?`<div class="voc-zh">${esc(v.zh)}</div>`:''}
        ${v.en?`<div class="voc-en">${esc(v.en)}</div>`:''}
        <div class="voc-actions"><button class="btn" data-act="jump">跳到片段</button></div>
      `;

      row.addEventListener('click',(e)=>{
        const act=e.target?.dataset?.act; if(!act) return;
        if(act==='jump'){ go(v.time||0); }
        else if(act==='speak'){ try{
          const u=new SpeechSynthesisUtterance(String(v.word||v.en||v.example||v.zh||''));
          u.lang='en-US'; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
        }catch{} }
        else if(act==='check'){
          const ipt=core.querySelector('input'); const msg=core.querySelector('.msg');
          const ok=String(ipt.value||'').trim().toLowerCase()===String(v.word||'').trim().toLowerCase();
          msg.textContent=ok?'✅ 正確！':'❌ 再試試'; msg.className=`msg ${ok?'ok':'ng'}`;
        }else if(act==='reveal'){
          const ipt=core.querySelector('input'); ipt.value=v.word||'';
          const msg=core.querySelector('.msg'); msg.textContent='（已填入答案）'; msg.className='msg';
        }
      });
      left.querySelector('.time-link').addEventListener('click',()=>go(v.time||0));

      row.appendChild(left); row.appendChild(core); row.appendChild(right);
      listBox.appendChild(row);
    });
  }

  // ====== 測驗（四分區） ======
  async function bootQuizTab(){
    const pane = paneQuiz;
    if(!pane){ console.warn('[quiz] #pane-quiz not found'); return; }

    const $q=(s)=>pane.querySelector(s);
    const listEl=$q('#quizList'), metaEl=$q('#quizMeta');
    const btnSubmit=$q('#btnSubmitQuiz'), btnPrint=$q('#btnPrintQuiz'), btnShowAns=$q('#btnShowAnswer');
    const resultEl=$q('#quizResult');

    // load
    let raw=[];
    try{
      const r=await fetch(`./data/quiz-${slug}.json?v=${Date.now()}`,{cache:'no-store'});
      if(!r.ok) throw new Error(`${r.status}`);
      raw=await r.json(); if(!Array.isArray(raw)&&!raw.sections) throw 0;
    }catch(e){
      metaEl.textContent='⚠️ 題庫載入失敗'; console.error(e); return;
    }

    // 正規化：支援 「整包」或「sections 格式」
    let questions=[];
    if (Array.isArray(raw)){
      questions = raw.map(q => ({
        section:(q.section||'Mixed'),
        type:(String(q.type||'MCQ').toUpperCase()==='SA')?'SA':'MCQ',
        question:q.question||q.q||'',
        options:q.options||q.choices||[],
        answer:q.answer??q.ans??'',
        explanation:q.explanation||q.ex||''
      }));
    }else if (raw.sections){
      const push=(sec,arr=[])=>arr.forEach(q=>questions.push({
        section:sec, type:(String(q.type||'MCQ').toUpperCase()==='SA')?'SA':'MCQ',
        question:q.question||'', options:q.options||[], answer:q.answer??'',
        explanation:q.explanation||''
      }));
      push('Vocabulary',raw.sections.vocab);
      push('Grammar',raw.sections.grammar);
      push('Reading',raw.sections.reading);
      push('Mixed',raw.sections.mixed);
    }

    const sections=['Vocabulary','Grammar','Reading','Mixed'];
    let currentSection='Vocabulary';

    function renderSection(sec){
      currentSection=sec;
      const data=questions.filter(q=>q.section===sec);
      if(!data.length){ listEl.innerHTML='<li style="color:#9fb3ff">（此分區無題目）</li>'; metaEl.textContent='0 題'; return; }
      listEl.innerHTML=data.map((q,i)=>{
        const idx=i+1;
        if(q.type==='MCQ'){
          const opts=q.options.map(opt=>`
            <label style="display:block;margin:4px 0">
              <input type="radio" name="q${sec}-${idx}" value="${String(opt)}"> ${String(opt)}
            </label>`).join('');
          return `<li data-sec="${sec}" data-idx="${idx}" data-type="MCQ" data-ans="${String(q.answer)}">
            <div style="font-weight:700;margin:4px 0">${idx}. ${esc(q.question)}</div>
            <div>${opts}</div>
            <div class="msg" style="margin-top:4px"></div>
            <div class="exp" style="margin-top:4px;color:#9fb3ff"></div>
          </li>`;
        }else{
          return `<li data-sec="${sec}" data-idx="${idx}" data-type="SA" data-ans="${String(q.answer)}">
            <div style="font-weight:700;margin:4px 0">${idx}. ${esc(q.question)}</div>
            <input type="text" placeholder="輸入答案…" style="padding:6px 8px;border:1px solid #334155;border-radius:6px;background:#0f223b;color:#dbe7ff">
            <button class="btn btn-check" style="margin-left:6px">檢查</button>
            <div class="msg" style="margin-top:4px"></div>
            <div class="exp" style="margin-top:4px;color:#9fb3ff"></div>
          </li>`;
        }
      }).join('');
      metaEl.textContent=`${sec}：${data.length} 題`;

      // 點「檢查」(SA)
      listEl.addEventListener('click', e=>{
        if(!e.target.classList.contains('btn-check')) return;
        const li=e.target.closest('li'); const ipt=li.querySelector('input[type="text"]');
        const msg=li.querySelector('.msg'); const exp=li.querySelector('.exp');
        const user=(ipt.value||'').trim().toLowerCase();
        const ans=String(li.dataset.ans||'').trim().toLowerCase();
        const ok=(user===ans);
        msg.textContent = ok?'✅ 正確':'❌ 錯誤';
        msg.style.color = ok?'#5bd3c7':'#ff6b6b';
        exp.textContent = ok?'':`正解：${li.dataset.ans}`;
      }, { once:true });
    }

    // 上方按鈕
    pane.querySelectorAll('.qtab').forEach(b=>{
      b.addEventListener('click',()=>{
        pane.querySelectorAll('.qtab').forEach(x=>x.classList.remove('on'));
        b.classList.add('on'); renderSection(b.dataset.sec);
      });
    });

    // 交卷
    btnSubmit.onclick=()=>{
      const items=[...listEl.querySelectorAll('li')]; if(!items.length) return;
      let got=0, total=items.length;
      items.forEach(li=>{
        const type=li.dataset.type; const ans=String(li.dataset.ans||'').trim();
        if(type==='MCQ'){
          const sel=li.querySelector('input[type="radio"]:checked'); const user=sel?sel.value:'';
          const ok=(user===ans); if(ok) got++;
          const msg=li.querySelector('.msg'), exp=li.querySelector('.exp');
          msg.textContent=ok?'✅ 正確':'❌ 錯誤'; msg.style.color=ok?'#5bd3c7':'#ff6b6b';
          exp.textContent=ok?'':`正解：${ans}`;
        }else{
          const ipt=li.querySelector('input[type="text"]'); const user=(ipt.value||'').trim();
          const ok=(user.toLowerCase()===ans.toLowerCase()); if(ok) got++;
          const msg=li.querySelector('.msg'), exp=li.querySelector('.exp');
          msg.textContent=ok?'✅ 正確':'❌ 錯誤'; msg.style.color=ok?'#5bd3c7':'#ff6b6b';
          exp.textContent=ok?'':`正解：${ans}`;
        }
      });
      const score = got*5; const full = total*5; const comment=getComment(score,full);
      $('#quizScore').textContent = `本分區分數：${score} / ${full}`;
      resultEl.style.display='block';
      resultEl.innerHTML = `<div style="margin-top:8px;color:#9fb3ff">${comment}</div>`;
      btnPrint.style.display='inline-block'; btnShowAns.style.display='inline-block';

      // 填列印表頭
      fillPrintHeader({
        title: slugTitle(slug),
        section: currentSection,
        score: `${score} / ${full}`,
        comment
      });
    };

    // 顯示答案
    btnShowAns.onclick=()=>{
      listEl.querySelectorAll('li').forEach(li=>{
        const exp=li.querySelector('.exp'); if(exp && !exp.textContent) exp.textContent=`正解：${li.dataset.ans}`;
      });
    };

    // 列印
    btnPrint.onclick=()=>window.print();

    // 先顯示單字
    renderSection('Vocabulary');
  }

  function getComment(score, full){
    const p=(score/full)*100;
    if(p===100) return '滿分！太強了！集滿五張滿分可兌換一組 LINE 表情貼 🎉';
    if(p>=90) return '很棒！細節再加強，就更完美。';
    if(p>=80) return '不錯的基礎，建議複習錯題字彙與句型。';
    if(p>=70) return '有進步空間，回看文本與關鍵字。';
    if(p>=60) return '及格！再練閱讀理解與文法點。';
    return '先別灰心！重作錯題、背關鍵字，再試一次會更好。';
  }
  function slugTitle(s){
    if(s==='mid-autumn') return 'Mid-Autumn Festival';
    if(s==='houyi') return 'Hou Yi (Ten Suns)';
    if(s==='lantern') return 'Lantern Festival';
    return s;
  }
  function fillPrintHeader({title, section, score, comment}){
    $('#ph-title').textContent = title || '—';
    $('#ph-section').textContent = section || '—';
    $('#ph-score-val').textContent = score || '—';
    $('#ph-comment').textContent = comment || '';
    const d=new Date();
    const pad=x=>String(x).padStart(2,'0');
    $('#ph-date').textContent = `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())}`;
  }

  // ====== 控制列 ======
  speedRange?.addEventListener('input',()=>{
    const r=Number(speedRange.value)||1; video.playbackRate=r;
    if(speedVal) speedVal.textContent=`${r.toFixed(2)}x`;
  });
  btnPlay?.addEventListener('click',()=>{ if(video.paused) video.play(); else video.pause(); });
  btnPrev?.addEventListener('click',()=>seekTo(Math.max(0,currentIndex()-1),true));
  btnNext?.addEventListener('click',()=>seekTo(Math.min(cues.length-1,currentIndex()+1),true));
  btnReplay?.addEventListener('click',()=>{ loopSentence=true; btnLoopSentence?.classList.add('green'); seekTo(currentIndex(),true); });
  btnLoopSentence?.addEventListener('click',()=>{ loopSentence=!loopSentence; btnLoopSentence.classList.toggle('green',loopSentence); });
  btnAB?.addEventListener('click',()=>{
    const now=video.currentTime+offset;
    if(abA===null){ abA=now; abB=null; btnAB.classList.add('green'); btnAB.textContent='🅱 設定 B（再次按取消）'; }
    else if(abB===null){ abB=now; if(abB<abA)[abA,abB]=[abB,abA]; btnAB.textContent='🅰🅱 A-B 循環中（再次按取消）'; }
    else{ abA=abB=null; btnAB.classList.remove('green'); btnAB.textContent='🅰🅱 A-B 循環'; }
  });
  btnPointLoop?.addEventListener('click',()=>{
    btnPointLoop.classList.toggle('green');
    if(cuesBody) cuesBody.dataset.pointloop = btnPointLoop.classList.contains('green') ? '1' : '';
  });
  btnClearLoop?.addEventListener('click',()=>{
    loopSentence=false; abA=abB=null; btnLoopSentence?.classList.remove('green');
    btnAB?.classList.remove('green'); if(btnAB) btnAB.textContent='🅰🅱 A-B 循環';
  });
  btnFill?.addEventListener('click',()=> videoWrap?.classList.toggle('fill') );
  btnOffsetMinus?.addEventListener('click',()=>{ offset-=0.5; if(offsetVal) offsetVal.textContent=`${offset.toFixed(1)}s`; });
  btnOffsetPlus ?.addEventListener('click',()=>{ offset+=0.5; if(offsetVal) offsetVal.textContent=`${offset.toFixed(1)}s`; });
  chkFollow    ?.addEventListener('change',()=> follow=chkFollow.checked);

  // 播放事件
  video.addEventListener('timeupdate',()=>{
    if(!cues.length) return;
    const i=currentIndex(); highlightRow(i);
    const t=video.currentTime+offset;

    if(autoPause){ const [,e]=sentenceRange(i); if(t>=e-0.02 && t<e+0.2) video.pause(); }
    if(loopSentence){ const [s,e]=sentenceRange(i); if(t>=e-0.02){ video.currentTime=Math.max(0,s-offset+0.0001); video.play(); } }
    if(abA!==null && abB!==null){ if(t<abA || t>=abB-0.02){ video.currentTime=Math.max(0,abA-offset+0.0001); video.play(); } }
  });
  btnAutoPause?.addEventListener('click',()=>{ autoPause=!autoPause; btnAutoPause.classList.toggle('green',autoPause); });

  // 分頁切換
  tabs.forEach(tab=>{
    tab.addEventListener('click',()=>{
      tabs.forEach(x=>x.classList.remove('active')); tab.classList.add('active');
      const name=tab.dataset.tab;
      paneSub.style.display   = (name==='sub')  ? '' : 'none';
      paneQuiz.style.display  = (name==='quiz') ? '' : 'none';
      paneVocab.style.display = (name==='vocab')? '' : 'none';
    });
  });

  // 啟動
  (async function init(){
    const r=Number(speedRange?.value)||1; video.playbackRate=r;
    if(speedVal) speedVal.textContent=`${r.toFixed(2)}x`;
    await loadVideo(); await loadCues(); await loadVocabUI(); await bootQuizTab();
  })();
})();
