\'use strict\';
let products=[], current=null, selectedLabel='';
const labels=window.RUNEC_LABELS||[];
const categoryState=new Map();
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
    await loadCategories();
  }catch(e){
    $('dbStatus').textContent='❌ PostgreSQL 未連線';
    $('categoryTree').innerHTML=`<div class="db-error">${esc(e.message)}<br>請用 START_V0.7_POSTGRES_TREE.bat 開啟。</div>`;
  }
}
async function loadCategories(refresh=false){
  $('categoryTree').innerHTML='<div class="empty">正在讀取產品分類...</div>';
  const data=await api('/api/categories'+(refresh?'?refresh=1':''));
  categoryState.clear();
  $('treeSummary').textContent=`${data.categories.reduce((n,c)=>n+c.count,0)} 個產品`;
  $('categoryTree').innerHTML=data.categories.map(c=>categoryHTML(c)).join('')||'<div class="empty">找不到產品分類。</div>';
  bindCategoryButtons();
}
function categoryHTML(c){
  const key=encodeURIComponent(c.id);
  return `<section class="tree-category" data-category="${esc(c.id)}"><button class="category-toggle" data-key="${key}" aria-expanded="false"><span class="twisty">＋</span><span class="folder">📁</span><span class="category-name">${esc(c.name)}</span><span class="category-count">${c.count}</span></button><div class="category-children" hidden></div></section>`;
}
function bindCategoryButtons(){
  document.querySelectorAll('.category-toggle').forEach(btn=>btn.onclick=()=>toggleCategory(btn));
}
async function toggleCategory(btn){
  const section=btn.closest('.tree-category'); const category=section.dataset.category;
  const children=section.querySelector('.category-children'); const expanded=btn.getAttribute('aria-expanded')==='true';
  if(expanded){btn.setAttribute('aria-expanded','false');btn.querySelector('.twisty').textContent='＋';children.hidden=true;children.innerHTML='';categoryState.delete(category);return;}
  btn.setAttribute('aria-expanded','true');btn.querySelector('.twisty').textContent='－';children.hidden=false;children.innerHTML='<div class="empty small">載入中...</div>';
  categoryState.set(category,{page:1,products:[]});
  await loadCategoryPage(category,section,1);
}
async function loadCategoryPage(category,section,page){
  try{
    const data=await api(`/api/category-products?category=${encodeURIComponent(category)}&page=${page}&pageSize=100`);
    const state=categoryState.get(category)||{page:1,products:[]}; state.page=page; state.products.push(...(data.products||[])); categoryState.set(category,state);
    const children=section.querySelector('.category-children');
    if(page===1)children.innerHTML='';
    const offset=state.products.length-(data.products||[]).length;
    children.insertAdjacentHTML('beforeend',(data.products||[]).map((p,i)=>productHTML(p,category,offset+i)).join(''));
    children.querySelectorAll('.tree-product:not([data-bound])').forEach(b=>{b.dataset.bound='1';b.onclick=()=>{const st=categoryState.get(category);selectProduct(st?.products[Number(b.dataset.idx)]);};});
    children.querySelector('.load-more')?.remove();
    if(data.hasMore)children.insertAdjacentHTML('beforeend',`<button class="load-more" type="button">再載入 100 筆（${state.products.length}/${data.total}）</button>`);
    children.querySelector('.load-more')?.addEventListener('click',()=>loadCategoryPage(category,section,page+1));
    if(!data.products?.length)children.innerHTML='<div class="empty small">此分類沒有產品。</div>';
  }catch(e){section.querySelector('.category-children').innerHTML=`<div class="db-error">${esc(e.message)}</div>`;}
}
function productHTML(p,category,idx){return `<button class="tree-product" data-idx="${idx}" data-oid="${esc(p._oid)}">🔧 ${esc(p.id)}－${esc(p.name)}</button>`;}
function collapseAll(){document.querySelectorAll('.category-toggle[aria-expanded="true"]').forEach(btn=>{btn.setAttribute('aria-expanded','false');btn.querySelector('.twisty').textContent='＋';const c=btn.closest('.tree-category').querySelector('.category-children');c.hidden=true;c.innerHTML='';});categoryState.clear();}
async function search(){
  const q=$('searchInput').value.trim();
  if(!q){await loadCategories();return;}
  $('categoryTree').innerHTML='<div class="empty">正在資料庫搜尋...</div>';
  try{const data=await api(`/api/products?search=${encodeURIComponent(q)}`);products=data.products||[];$('treeSummary').textContent=`搜尋結果 ${products.length} 筆`;$('categoryTree').innerHTML=`<section class="tree-category search-results"><div class="search-title">🔎 ${esc(q)}</div><div class="category-children">${products.map((p,i)=>productHTML(p,'__search__',i)).join('')}</div></section>`||'<div class="empty">找不到產品。</div>';document.querySelectorAll('.tree-product').forEach(b=>b.onclick=()=>selectProduct(products[Number(b.dataset.idx)]));if(products[0])selectProduct(products[0]);else $('categoryTree').innerHTML='<div class="empty">找不到產品。</div>';}catch(e){$('categoryTree').innerHTML=`<div class="db-error">搜尋失敗：${esc(e.message)}</div>`;}
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
function renderRows(id,rows,keys){$(id).innerHTML=rows.length?rows.map(r=>`<tr>${keys.map(k=>`<td>${esc(r[k])}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${keys.length}" class="empty">V0.7 尚未接此關聯表</td></tr>`;}
function normalized(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function matchedLabels(){const q=normalized($('labelSearch').value),pid=normalized(current?.id);return labels.filter(l=>{const n=normalized(l.name);return(!q||n.includes(q))&&(!q?(n.includes(pid)||pid.includes(n.slice(0,Math.min(8,n.length)))):true);});}
function renderLabels(){let list=matchedLabels();if(!list.length&&!$('labelSearch').value)list=labels;$('labelCount').textContent=`${list.length} 個模板`;$('labelPool').innerHTML=list.length?list.map(l=>`<div class="label-card ${selectedLabel===l.name?'selected':''}"><b>${esc(l.name)}</b><small>${esc(l.category)}</small><div><button data-pick="${esc(l.name)}">套用模板</button> <a href="${encodeURI(l.file)}" download>下載 EZP</a></div></div>`).join(''):'<div class="empty">找不到模板。</div>';document.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{selectedLabel=b.dataset.pick;renderLabels();refreshPreview();activateTab('preview');});}
function activateTab(id){document.querySelectorAll('.tab,.panel').forEach(x=>x.classList.remove('active'));document.querySelector(`.tab[data-tab="${id}"]`)?.classList.add('active');$(id).classList.add('active');}
const CODE39={'0':'nnnwwnwnn','1':'wnnwnnnnw','2':'nnwwnnnnw','3':'wnwwnnnnn','4':'nnnwwnnnw','5':'wnnwwnnnn','6':'nnwwwnnnn','7':'nnnwnnwnw','8':'wnnwnnwnn','9':'nnwwnnwnn','A':'wnnnnwnnw','B':'nnwnnwnnw','C':'wnwnnwnnn','D':'nnnnwwnnw','E':'wnnnwwnnn','F':'nnwnwwnnn','G':'nnnnnwwnw','H':'wnnnnwwnn','I':'nnwnnwwnn','J':'nnnnwwwnn','K':'wnnnnnnww','L':'nnwnnnnww','M':'wnwnnnnwn','N':'nnnnwnnww','O':'wnnnwnnwn','P':'nnwnwnnwn','Q':'nnnnnnwww','R':'wnnnnnwwn','S':'nnwnnnwwn','T':'nnnnwnwwn','U':'wwnnnnnnw','V':'nwwnnnnnw','W':'wwwnnnnnn','X':'nwnnwnnnw','Y':'wwnnwnnnn','Z':'nwwnwnnnn','-':'nwnnnnwnw','.':'wwnnnnwnn',' ':'nwwnnnwnn','*':'nwnnwnwnn'};
function barcodeHTML(value){const text='*'+String(value||'').toUpperCase().replace(/[^0-9A-Z.\- ]/g,'-')+'*';let bars='';for(const ch of text){const p=CODE39[ch]||CODE39['-'];for(let i=0;i<9;i++){const wide=p[i]==='w';bars+=`<i class="${i%2===0?'bar':'gap'} ${wide?'wide':''}"></i>`;}bars+='<i class="gap"></i>';}return `<div class="barcode-bars">${bars}</div><div class="barcode-text">${esc(value)}</div>`;}
function labelMarkup(){const no=$('id').value,name=$('name').value,spec=$('labelSpec').value||$('internalMemo').value||$('memo').value;const lot=$('batchNo').value||'',qty=$('packQty').value||'',date=$('labelDate').value||'';return `<article class="print-label"><div class="label-brand">PMKTOOLS</div><div class="label-no">${esc(no)}</div><div class="label-name">${esc(name)}</div><div class="label-spec">${esc(spec)}</div>${barcodeHTML(no)}<div class="label-meta"><span>LOT ${esc(lot)}</span><span>QTY ${esc(qty)}</span><span>${esc(date)}</span></div><div class="template-name">${esc(selectedLabel||'BookWide 標準模板')}</div></article>`;}
function refreshPreview(){if(!current)return;$('labelSpec').value=$('labelSpec').value||current.internalMemo||current.memo||'';const size=$('labelSize').value.split('x');document.documentElement.style.setProperty('--label-w',size[0]+'mm');document.documentElement.style.setProperty('--label-h',size[1]+'mm');$('labelPreview').innerHTML=labelMarkup();const copies=Math.max(1,Math.min(200,Number($('printQty').value)||1));$('printSheet').innerHTML=Array.from({length:copies},labelMarkup).join('');$('selectedTemplate').textContent=selectedLabel||'BookWide 標準模板';}
function printLabels(){refreshPreview();window.print();}


document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>activateTab(t.dataset.tab));
$('searchBtn').onclick=search;$('searchInput').addEventListener('keydown',e=>{if(e.key==='Enter')search();});
$('collapseAllBtn').onclick=collapseAll;
$('labelSearch').addEventListener('input',renderLabels);['batchNo','printQty','packQty','labelDate','labelSpec','labelSize'].forEach(id=>$(id).addEventListener('input',refreshPreview));$('printBtn').onclick=printLabels;$('reloadBtn').onclick=()=>loadCategories(true);$('copyBtn').onclick=()=>alert('V0.7 是 PostgreSQL 唯讀測試版，尚未開放複製或寫入。');$('labelDate').value=new Date().toISOString().slice(0,10);boot();
