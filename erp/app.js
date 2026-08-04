'use strict';
let products=[];let current=null;let selectedLabel='';
const $=id=>document.getElementById(id);
async function load(){
  try{const r=await fetch('data/products.json',{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);products=await r.json();renderList(products);selectProduct(products[0]);}
  catch(e){$('productList').innerHTML='<p>無法載入 products.json。請使用 GitHub Pages 或本機 HTTP Server 開啟。</p>';console.error(e);}
}
function renderList(list){$('resultCount').textContent=`共 ${list.length} 筆`;$('productList').innerHTML=list.map(p=>`<div class="product-item" data-id="${esc(p.id)}"><b>${esc(p.id)}</b><span>${esc(p.name)}</span></div>`).join('');document.querySelectorAll('.product-item').forEach(el=>el.onclick=()=>selectProduct(products.find(p=>p.id===el.dataset.id)));}
function selectProduct(p){if(!p)return;current=p;document.querySelectorAll('.product-item').forEach(x=>x.classList.toggle('active',x.dataset.id===p.id));['id','name','memo','internalMemo','partner','unit','safeStock','stockQty','status','attachment'].forEach(k=>$(k).value=p[k]??'');$('productPhoto').src=p.photo;$('photoTitle').textContent=`${p.id}｜${p.name}`;renderLabelPool(p.labels||[]);refreshPreview();}
function renderLabelPool(labels){$('labelPool').innerHTML=labels.map((x,i)=>`<div class="label-card ${x===selectedLabel?'selected':''}"><b>${esc(x)}</b><div class="muted">來源：既有標籤池</div><button data-label="${esc(x)}">選用</button></div>`).join('')||'<p class="muted">此商品尚未綁定模板。</p>';document.querySelectorAll('[data-label]').forEach(b=>b.onclick=()=>{selectedLabel=b.dataset.label;renderLabelPool(labels);});}
function refreshPreview(){if(!current)return;$('pProductNo').textContent=current.id;$('pName').textContent=current.name;$('pMemo').textContent=current.memo;$('pBatch').textContent=`批號：${$('batchNo').value||'-'}　數量：${$('printQty').value||1}`;}
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
$('searchInput').addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();renderList(products.filter(p=>[p.id,p.name,p.memo].join(' ').toLowerCase().includes(q)));});
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{document.querySelectorAll('.tab,.panel').forEach(x=>x.classList.remove('active'));t.classList.add('active');$(t.dataset.tab).classList.add('active');});
$('batchNo').addEventListener('input',refreshPreview);$('printQty').addEventListener('input',refreshPreview);$('printBtn').onclick=()=>window.print();$('labelSearch').addEventListener('input',e=>{if(!current)return;const q=e.target.value.toLowerCase();renderLabelPool((current.labels||[]).filter(x=>x.toLowerCase().includes(q)));});$('addPoolBtn').onclick=()=>alert('V0.1 先保留入口；下一階段匯入 PMKTOOLS商品標籤2025。');
load();
