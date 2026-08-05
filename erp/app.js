'use strict';
const baseProducts=window.RUNEC_PRODUCTS||[], labels=window.RUNEC_LABELS||[];
const saved=JSON.parse(localStorage.getItem('bookwide_erp_products_v03')||'{}');
const products=baseProducts.map(p=>({...p,...(saved[p.id]||{})}));
let current=null, selectedLabel='';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function buildTree(list){
  const groups={}; list.forEach(p=>(groups[p.category]??=[]).push(p));
  $('categoryTree').innerHTML=Object.entries(groups).map(([g,ps])=>`<div class="group"><div class="group-name">📂 ${esc(g)}</div>${ps.map(p=>`<button class="tree-product" data-id="${esc(p.id)}">🔧 ${esc(p.id)}－${esc(p.name)}</button>`).join('')}</div>`).join('');
  document.querySelectorAll('.tree-product').forEach(b=>b.onclick=()=>selectProduct(products.find(p=>p.id===b.dataset.id)));
}
function selectProduct(p){
  if(!p)return; current=p; selectedLabel='';
  document.querySelectorAll('.tree-product').forEach(x=>x.classList.toggle('active',x.dataset.id===p.id));
  $('crumbCategory').textContent=p.category; $('crumbId').textContent=p.id;
  ['id','name','memo','internalMemo','reference','unit','substitute','startDate','endDate','itemClass','status','updatedAt'].forEach(k=>$(k).value=p[k]??'');
  $('stockable').checked=!!p.stockable; $('taxable').checked=!!p.taxable; $('pinned').checked=!!p.pinned;
  $('productPhoto').src=p.photo||'';
  renderRows('partnerRows',p.partners||[],['partner','code','name','memo','level']);
  renderRows('safeRows',p.safeStocks||[],['warehouse','low','high']);
  renderRows('stockRows',p.stocks||[],['warehouse','qty']);
  renderRows('attachmentRows',p.attachments||[],['content','memo']);
  renderLabels(); refreshPreview();
}
function renderRows(id,rows,keys){$(id).innerHTML=rows.length?rows.map(r=>`<tr>${keys.map(k=>`<td>${esc(r[k])}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${keys.length}" class="empty">尚無資料</td></tr>`;}
function normalized(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function matchedLabels(){
  const q=normalized($('labelSearch').value), pid=normalized(current?.id);
  return labels.filter(l=>{const n=normalized(l.name); return (!q||n.includes(q)) && (!q ? (n.includes(pid)||pid.includes(n.slice(0,Math.min(8,n.length)))) : true);});
}
function renderLabels(){
  let list=matchedLabels(); if(!list.length && !$('labelSearch').value) list=labels;
  $('labelCount').textContent=`${list.length} 個模板`;
  $('labelPool').innerHTML=list.length?list.map(l=>`<div class="label-card ${selectedLabel===l.name?'selected':''}"><b>${esc(l.name)}</b><small>${esc(l.category)}</small><div><button data-pick="${esc(l.name)}">套用模板</button> <a href="${encodeURI(l.file)}" download>下載 EZP</a></div></div>`).join(''):'<div class="empty">找不到模板。</div>';
  document.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{selectedLabel=b.dataset.pick; renderLabels(); refreshPreview(); activateTab('preview');});
}
function activateTab(id){document.querySelectorAll('.tab,.panel').forEach(x=>x.classList.remove('active'));document.querySelector(`.tab[data-tab="${id}"]`)?.classList.add('active');$(id).classList.add('active');}
function collectForm(){
  if(!current)return;
  ['name','memo','internalMemo','reference','unit','substitute','startDate','endDate','itemClass','status'].forEach(k=>current[k]=$(k).value);
  current.stockable=$('stockable').checked; current.taxable=$('taxable').checked; current.pinned=$('pinned').checked;
  current.updatedAt=new Date().toISOString().slice(0,10); $('updatedAt').value=current.updatedAt;
}
function saveProduct(){collectForm(); const all=JSON.parse(localStorage.getItem('bookwide_erp_products_v03')||'{}'); all[current.id]={...current}; localStorage.setItem('bookwide_erp_products_v03',JSON.stringify(all)); buildTree(products); selectProduct(current); alert('產品資料已儲存在這台電腦的 BookWide ERP 測試副本。');}
function copyProduct(){
  if(!current)return; const newId=prompt('新產品編號：',current.id+'-COPY'); if(!newId||products.some(p=>p.id===newId))return;
  const p=JSON.parse(JSON.stringify(current)); p.id=newId; p.name=current.name+' 複製'; products.push(p); buildTree(products); selectProduct(p); saveProduct();
}
function search(){const q=$('searchInput').value.trim().toLowerCase();const hits=products.filter(p=>`${p.id} ${p.name} ${p.category}`.toLowerCase().includes(q));buildTree(hits);if(hits[0])selectProduct(hits[0]);}

const CODE39={
'0':'nnnwwnwnn','1':'wnnwnnnnw','2':'nnwwnnnnw','3':'wnwwnnnnn','4':'nnnwwnnnw','5':'wnnwwnnnn','6':'nnwwwnnnn','7':'nnnwnnwnw','8':'wnnwnnwnn','9':'nnwwnnwnn',
'A':'wnnnnwnnw','B':'nnwnnwnnw','C':'wnwnnwnnn','D':'nnnnwwnnw','E':'wnnnwwnnn','F':'nnwnwwnnn','G':'nnnnnwwnw','H':'wnnnnwwnn','I':'nnwnnwwnn','J':'nnnnwwwnn',
'K':'wnnnnnnww','L':'nnwnnnnww','M':'wnwnnnnwn','N':'nnnnwnnww','O':'wnnnwnnwn','P':'nnwnwnnwn','Q':'nnnnnnwww','R':'wnnnnnwwn','S':'nnwnnnwwn','T':'nnnnwnwwn',
'U':'wwnnnnnnw','V':'nwwnnnnnw','W':'wwwnnnnnn','X':'nwnnwnnnw','Y':'wwnnwnnnn','Z':'nwwnwnnnn','-':'nwnnnnwnw','.':'wwnnnnwnn',' ':'nwwnnnwnn','*':'nwnnwnwnn'};
function barcodeHTML(value){
  const text='*'+String(value||'').toUpperCase().replace(/[^0-9A-Z.\- ]/g,'-')+'*'; let bars='';
  for(const ch of text){const p=CODE39[ch]||CODE39['-']; for(let i=0;i<9;i++){const wide=p[i]==='w';bars+=`<i class="${i%2===0?'bar':'gap'} ${wide?'wide':''}"></i>`;} bars+='<i class="gap"></i>';}
  return `<div class="barcode-bars">${bars}</div><div class="barcode-text">${esc(value)}</div>`;
}
function labelMarkup(){
  const no=$('id').value, name=$('name').value, spec=$('labelSpec').value||$('internalMemo').value||$('memo').value;
  const lot=$('batchNo').value||'', qty=$('packQty').value||'', date=$('labelDate').value||'';
  return `<article class="print-label"><div class="label-brand">PMKTOOLS</div><div class="label-no">${esc(no)}</div><div class="label-name">${esc(name)}</div><div class="label-spec">${esc(spec)}</div>${barcodeHTML(no)}<div class="label-meta"><span>LOT ${esc(lot)}</span><span>QTY ${esc(qty)}</span><span>${esc(date)}</span></div><div class="template-name">${esc(selectedLabel||'BookWide 標準模板')}</div></article>`;
}
function refreshPreview(){
  if(!current)return;
  $('labelSpec').value=$('labelSpec').value||current.internalMemo||current.memo||'';
  const size=$('labelSize').value.split('x'); document.documentElement.style.setProperty('--label-w',size[0]+'mm');document.documentElement.style.setProperty('--label-h',size[1]+'mm');
  $('labelPreview').innerHTML=labelMarkup();
  const copies=Math.max(1,Math.min(200,Number($('printQty').value)||1)); $('printSheet').innerHTML=Array.from({length:copies},labelMarkup).join('');
  $('selectedTemplate').textContent=selectedLabel||'BookWide 標準模板';
}
function printLabels(){refreshPreview(); window.print();}

document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>activateTab(t.dataset.tab));
$('searchBtn').onclick=search; $('searchInput').addEventListener('keydown',e=>{if(e.key==='Enter')search();});
$('labelSearch').addEventListener('input',renderLabels);
['batchNo','printQty','packQty','labelDate','labelSpec','labelSize'].forEach(id=>$(id).addEventListener('input',refreshPreview));
$('printBtn').onclick=printLabels; $('saveBtn').onclick=saveProduct; $('reloadBtn').onclick=()=>location.reload(); $('copyBtn').onclick=copyProduct;
$('labelDate').value=new Date().toISOString().slice(0,10);
buildTree(products); selectProduct(products[0]);
