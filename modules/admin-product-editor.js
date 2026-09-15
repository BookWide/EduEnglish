(()=>{
'use strict';
const CORE=()=>window.PMKAdminCore;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let original=null, draft=null;

function ensureUI(){
  if(document.getElementById('pmkProductEditorModule'))return;
  const style=document.createElement('style');
  style.textContent=`
  #pmkProductEditorModule{position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.42);display:none;align-items:flex-start;justify-content:center;padding:28px;overflow:auto}
  #pmkProductEditorModule.open{display:flex}
  .pem-card{width:min(1120px,96vw);background:#fff;border-radius:14px;box-shadow:0 24px 70px #0004;overflow:hidden}
  .pem-head{position:sticky;top:0;z-index:2;background:#0f1e35;color:#fff;padding:14px 18px;display:flex;align-items:center;justify-content:space-between}
  .pem-head h2{margin:0;font-size:20px}.pem-actions{display:flex;gap:8px}
  .pem-btn{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:9px 14px;font-weight:800;cursor:pointer}.pem-save{background:#059669;color:#fff;border-color:#059669}
  .pem-body{padding:18px}.pem-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px}
  .pem-field{display:grid;gap:5px}.pem-field.full{grid-column:1/-1}.pem-field label{font-weight:800;color:#334155}
  .pem-field input,.pem-field select,.pem-field textarea{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:7px;padding:9px;background:#fff}
  .pem-field textarea{min-height:86px;resize:vertical}.pem-section{margin-top:18px;border-top:1px solid #e2e8f0;padding-top:14px}
  .pem-section h3{margin:0 0 10px}.pem-vtable{width:100%;border-collapse:collapse;font-size:13px}.pem-vtable th,.pem-vtable td{border:1px solid #e2e8f0;padding:6px;vertical-align:top}
  .pem-vtable input{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:5px;padding:6px}.pem-status{padding:9px 12px;background:#f8fafc;border-radius:7px;margin-bottom:12px;color:#475569}
  .pem-danger{color:#b91c1c}.pem-muted{color:#64748b;font-size:12px}
  @media(max-width:760px){#pmkProductEditorModule{padding:0}.pem-card{width:100%;min-height:100vh;border-radius:0}.pem-grid{grid-template-columns:1fr}.pem-field.full{grid-column:auto}.pem-vtable{font-size:11px}}
  `;
  document.head.appendChild(style);
  const root=document.createElement('div');root.id='pmkProductEditorModule';
  root.innerHTML=`<div class="pem-card">
    <div class="pem-head"><h2>商品編輯</h2><div class="pem-actions"><button class="pem-btn" data-close>關閉</button><button class="pem-btn pem-save" data-save>更新商品</button></div></div>
    <div class="pem-body"><div class="pem-status" data-status>一般商品編輯模組 V3.1.0</div><div data-form></div></div>
  </div>`;
  document.body.appendChild(root);
  root.querySelector('[data-close]').onclick=close;
  root.querySelector('[data-save]').onclick=save;
  root.addEventListener('click',e=>{if(e.target===root)close()});
}
function val(id){return document.getElementById('pem_'+id)?.value??''}
function num(id){const x=Number(val(id));return Number.isFinite(x)?x:0}
function checked(id){return !!document.getElementById('pem_'+id)?.checked}
function render(){
  ensureUI();
  const p=draft||{};
  const vs=Array.isArray(p.variations)?p.variations:[];
  const form=document.querySelector('#pmkProductEditorModule [data-form]');
  form.innerHTML=`
  <div class="pem-grid">
    ${field('name','商品名稱',p.name,'full')}
    ${field('sku','SKU',p.sku||p.external_id)}
    ${field('external_id','來源 ID',p.external_id)}
    ${field('brand','品牌',p.brand)}
    ${field('category','分類',p.category)}
    ${field('price','價格',p.price,'','number')}
    ${field('sale_price','售價',p.sale_price,'','number')}
    ${field('stock_qty','庫存',p.stock_qty,'','number')}
    ${field('sort_order','排序',p.sort_order,'','number')}
    ${field('image_url','主圖 URL',p.image_url,'full')}
    ${area('description','商品說明',p.description,'full')}
    <div class="pem-field"><label>狀態</label><label><input id="pem_is_active" type="checkbox" ${p.is_active===false?'':'checked'}> 上架</label></div>
    <div class="pem-field"><label>商品類型</label><input id="pem_product_type" value="${esc(p.product_type||'simple')}"></div>
  </div>
  <div class="pem-section">
    <h3>規格 / Variations <span class="pem-muted">${vs.length} 筆；此模組只改共用欄位，不碰型錄 technical_schema。</span></h3>
    ${vs.length?`<div style="overflow:auto"><table class="pem-vtable"><thead><tr><th>#</th><th>規格</th><th>SKU</th><th>價格</th><th>庫存</th><th>上架</th></tr></thead><tbody>
    ${vs.map((v,i)=>`<tr data-vi="${i}"><td>${i+1}</td><td>${esc(Object.values(v.attributes||{}).join(' / ')||v.variation_name||'')}</td>
    <td><input data-v="sku" value="${esc(v.sku||'')}"></td><td><input data-v="price" type="number" value="${esc(v.price??0)}"></td>
    <td><input data-v="stock_qty" type="number" value="${esc(v.stock_qty??0)}"></td><td><input data-v="is_active" type="checkbox" ${v.is_active===false?'':'checked'}></td></tr>`).join('')}
    </tbody></table></div>`:'<div class="pem-muted">此商品沒有 Variation。</div>'}
  </div>`;
}
function field(id,label,value,cls='',type='text'){return `<div class="pem-field ${cls}"><label>${label}</label><input id="pem_${id}" type="${type}" value="${esc(value??'')}"></div>`}
function area(id,label,value,cls=''){return `<div class="pem-field ${cls}"><label>${label}</label><textarea id="pem_${id}">${esc(value??'')}</textarea></div>`}
function collect(){
  const p=structuredClone(original||{});
  p.name=val('name').trim(); p.sku=val('sku').trim(); p.external_id=val('external_id').trim();
  p.brand=val('brand').trim(); p.category=val('category').trim(); p.price=num('price'); p.sale_price=num('sale_price');
  p.stock_qty=num('stock_qty'); p.sort_order=num('sort_order'); p.image_url=val('image_url').trim(); p.description=val('description');
  p.is_active=checked('is_active'); p.product_type=val('product_type').trim()||p.product_type||'simple';
  const rows=[...document.querySelectorAll('#pmkProductEditorModule tr[data-vi]')];
  if(Array.isArray(p.variations))rows.forEach(row=>{
    const i=Number(row.dataset.vi),v=p.variations[i];if(!v)return;
    v.sku=row.querySelector('[data-v="sku"]').value.trim();
    v.price=Math.max(0,Number(row.querySelector('[data-v="price"]').value||0));
    v.stock_qty=Math.max(0,Number(row.querySelector('[data-v="stock_qty"]').value||0));
    v.is_active=row.querySelector('[data-v="is_active"]').checked;
  });
  return p;
}
async function save(){
  const status=document.querySelector('#pmkProductEditorModule [data-status]');
  try{
    const p=collect();
    if(!p.name)throw new Error('商品名稱不能空白');
    status.textContent='寫入 R2 中…';
    const r=await CORE().api.post('/api/pmk-product-save',p);
    original=structuredClone(r.product||p);draft=structuredClone(original);
    status.textContent='✓ 商品已更新；未碰觸未顯示的原始欄位。';
    await CORE().reloadProducts();
    render();
  }catch(e){status.innerHTML='<span class="pem-danger">❌ '+esc(e?.message||e)+'</span>'}
}
function open(product){
  ensureUI();original=structuredClone(product||{});draft=structuredClone(original);render();
  document.getElementById('pmkProductEditorModule').classList.add('open');
  document.body.style.overflow='hidden';
}
function close(){document.getElementById('pmkProductEditorModule')?.classList.remove('open');document.body.style.overflow=''}
function init(){ensureUI()}
CORE().register('product-editor',{version:'3.1.0',init,open,close});
})();