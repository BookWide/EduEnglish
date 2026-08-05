'use strict';
let products=[], current=null, selectedLabel='';
const labels=window.RUNEC_LABELS||[];
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function api(path){
  const r=await fetch(path,{cache:'no-store'}); const j=await r.json();
  if(!r.ok||!j.ok) throw new Error(j.error||`HTTP ${r.status}`); return j;
}
async function boot(){
  try{
    const h=await api('/api/health');
    $('dbStatus').textContent=`✅ PostgreSQL ${h.host}:${h.port}/${h.database} 已連線（唯讀）`;
    await loadProducts('');
  }catch(e){
    $('dbStatus').textContent='❌ PostgreSQL 未連線';
    $('categoryTree').innerHTML=`<div class="db-error">${esc(e.message)}<br>請用 START_V0.4_POSTGRES_TEST.bat 開啟，不要從 GitHub Pages 測試。</div>`;
  }
}
async function loadProducts(q=''){
  $('categoryTree').innerHTML='<div class="empty">正在讀取 PostgreSQL 真實產品...</div>';
  const data=await api('/api/products'+(q?`?search=${encodeURIComponent(q)}`:''));
  products=data.products||[]; buildTree(products);
  if(products[0]) selectProduct(products[0]);
  else $('categoryTree').innerHTML='<div class="empty">資料庫沒有找到產品。可輸入真實品號搜尋。</div>';
}
function buildTree(list){
  const groups={}; list.forEach(p=>(groups[p.category||'PostgreSQL 真實產品']??=[]).push(p));
  $('categoryTree').innerHTML=Object.entries(groups).map(([g,ps])=>`<div class="group"><div class="group-name">📂 ${esc(g)}</div>${ps.map((p,i)=>`<button class="tree-product" data-idx="${i}" data-oid="${esc(p._oid)}">🔧 ${esc(p.id)}－${esc(p.name)}</button>`).join('')}</div>`).join('');
  document.querySelectorAll('.tree-product').forEach(b=>b.onclick=()=>selectProduct(list[Number(b.dataset.idx)]));
}
function selectProduct(p){
  if(!p)return; current=p; selectedLabel='';
  document.querySelectorAll('.tree-product').forEach(x=>x.classList.toggle('active',x.dataset.oid===String(p._oid)));
  $('crumbCategory').textContent=p.category||'PostgreSQL'; $('crumbId').textContent=p.id||p._oid;
  const defaults={memo:'',internalMemo:'',reference:'',unit:'',substitute:'',startDate:'',endDate:'',itemClass:'',status:'DB READ-ONLY',updatedAt:''};
  ['id','name','memo','internalMemo','reference','unit','substitute','startDate','endDate','itemClass','status','updatedAt'].forEach(k=>$(k).value=p[k]??defaults[k]??'');
  $('stockable').checked=!!p.stockable; $('taxable').checked=!!p.taxable; $('pinned').checked=false;
  $('productPhoto').src=p.photo||'';
  renderRows('partnerRows',[],['partner','code','name','memo','level']); renderRows('safeRows',[],['warehouse','low','high']); renderRows('stockRows',[],['warehouse','qty']); renderRows('attachmentRows',[],['content','memo']);
  renderLabels(); refreshPreview();
}
function renderRows(id,rows,keys){$(id).innerHTML=rows.length?rows.map(r=>`<tr>${keys.map(k=>`<td>${esc(r[k])}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${keys.length}" class="empty">V0.4 尚未接此關聯表</td></tr>`;}
function normalized(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function matchedLabels(){const q=normalized($('labelSearch').value),pid=normalized(current?.id);return labels.filter(l=>{const n=normalized(l.name);return(!q||n.includes(q))&&(!q?(n.includes(pid)||pid.includes(n.slice(0,Math.min(8,n.length)))):true);});}
function renderLabels(){let list=matchedLabels();if(!list.length&&!$('labelSearch').value)list=labels;$('labelCount').textContent=`${list.length} 個模板`;$('labelPool').innerHTML=list.length?list.map(l=>`<div class="label-card ${selectedLabel===l.name?'selected':''}"><b>${esc(l.name)}</b><small>${esc(l.category)}</small><div><button data-pick="${esc(l.name)}">套用模板</button> <a href="${encodeURI(l.file)}" download>下載 EZP</a></div></div>`).join(''):'<div class="empty">找不到模板。</div>';document.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{selectedLabel=b.dataset.pick;renderLabels();refreshPreview();activateTab('preview');});}
function activateTab(id){document.querySelectorAll('.tab,.panel').forEach(x=>x.classList.remove('active'));document.querySelector(`.tab[data-tab="${id}"]`)?.classList.add('active');$(id).classList.add('active');}
async function search(){const q=$('searchInput').value.trim();try{await loadProducts(q);}catch(e){alert('搜尋失敗：'+e.message);}}

const CODE39={'0':'nnnwwnwnn','1':'wnnwnnnnw','2':'nnwwnnnnw','3':'wnwwnnnnn','4':'nnnwwnnnw','5':'wnnwwnnnn','6':'nnwwwnnnn','7':'nnnwnnwnw','8':'wnnwnnwnn','9':'nnwwnnwnn','A':'wnnnnwnnw','B':'nnwnnwnnw','C':'wnwnnwnnn','D':'nnnnwwnnw','E':'wnnnwwnnn','F':'nnwnwwnnn','G':'nnnnnwwnw','H':'wnnnnwwnn','I':'nnwnnwwnn','J':'nnnnwwwnn','K':'wnnnnnnww','L':'nnwnnnnww','M':'wnwnnnnwn','N':'nnnnwnnww','O':'wnnnwnnwn','P':'nnwnwnnwn','Q':'nnnnnnwww','R':'wnnnnnwwn','S':'nnwnnnwwn','T':'nnnnwnwwn','U':'wwnnnnnnw','V':'nwwnnnnnw','W':'wwwnnnnnn','X':'nwnnwnnnw','Y':'wwnnwnnnn','Z':'nwwnwnnnn','-':'nwnnnnwnw','.':'wwnnnnwnn',' ':'nwwnnnwnn','*':'nwnnwnwnn'};
function barcodeHTML(value){const text='*'+String(value||'').toUpperCase().replace(/[^0-9A-Z.\- ]/g,'-')+'*';let bars='';for(const ch of text){const p=CODE39[ch]||CODE39['-'];for(let i=0;i<9;i++){const wide=p[i]==='w';bars+=`<i class="${i%2===0?'bar':'gap'} ${wide?'wide':''}"></i>`;}bars+='<i class="gap"></i>';}return `<div class="barcode-bars">${bars}</div><div class="barcode-text">${esc(value)}</div>`;}
function labelMarkup(){const no=$('id').value,name=$('name').value,spec=$('labelSpec').value||$('internalMemo').value||$('memo').value;const lot=$('batchNo').value||'',qty=$('packQty').value||'',date=$('labelDate').value||'';return `<article class="print-label"><div class="label-brand">PMKTOOLS</div><div class="label-no">${esc(no)}</div><div class="label-name">${esc(name)}</div><div class="label-spec">${esc(spec)}</div>${barcodeHTML(no)}<div class="label-meta"><span>LOT ${esc(lot)}</span><span>QTY ${esc(qty)}</span><span>${esc(date)}</span></div><div class="template-name">${esc(selectedLabel||'BookWide 標準模板')}</div></article>`;}
function refreshPreview(){if(!current)return;$('labelSpec').value=$('labelSpec').value||current.internalMemo||current.memo||'';const size=$('labelSize').value.split('x');document.documentElement.style.setProperty('--label-w',size[0]+'mm');document.documentElement.style.setProperty('--label-h',size[1]+'mm');$('labelPreview').innerHTML=labelMarkup();const copies=Math.max(1,Math.min(200,Number($('printQty').value)||1));$('printSheet').innerHTML=Array.from({length:copies},labelMarkup).join('');$('selectedTemplate').textContent=selectedLabel||'BookWide 標準模板';}
function printLabels(){refreshPreview();window.print();}

document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>activateTab(t.dataset.tab));
$('searchBtn').onclick=search;$('searchInput').addEventListener('keydown',e=>{if(e.key==='Enter')search();});$('labelSearch').addEventListener('input',renderLabels);['batchNo','printQty','packQty','labelDate','labelSpec','labelSize'].forEach(id=>$(id).addEventListener('input',refreshPreview));$('printBtn').onclick=printLabels;$('reloadBtn').onclick=()=>loadProducts($('searchInput').value.trim());$('copyBtn').onclick=()=>alert('V0.4 是 PostgreSQL 唯讀測試版，尚未開放複製或寫入。');$('labelDate').value=new Date().toISOString().slice(0,10);boot();
