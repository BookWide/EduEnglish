'use strict';
const ERP_API='https://bookwide-hiking-api.pmktools.workers.dev';
const modules=window.BOOKWIDE_MODULES||[];
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>\'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
let activeModule='system', activePage='home', products=[], currentProduct=null, originalProductId='', isNewProduct=false, pendingPhotoBase64='', productNavMode='tree';
let customers=[], currentCustomer=null, originalCustomerId='', customerNavMode='tree', customerTab='basic';
let currentLang=localStorage.getItem('bookwide.erp.lang')||'zh-TW';
const dictionaries=window.BOOKWIDE_I18N||{'zh-TW':{}};
function t(text){const key=String(text??'');return dictionaries[currentLang]?.[key]??dictionaries['zh-TW']?.[key]??key}
function applyStaticTranslations(){document.documentElement.lang=currentLang==='zh-TW'?'zh-Hant':currentLang==='zh-CN'?'zh-Hans':currentLang;document.querySelectorAll('[data-i18n]').forEach(el=>{el.textContent=t(el.dataset.i18n)});const sel=$('languageSelect');if(sel)sel.value=currentLang;}
const pages={home:{title:'功能導引'},people:{title:'人員組織總覽'},permissions:{title:'權限管理文件'},documents:{title:'瀏覽所有文件'},move:{title:'移動文件'},items:{title:'商品總覽'},warehouses:{title:'倉庫總覽'},stock:{title:'庫存查詢'},bom:{title:'BOM 表總覽'},customers:{title:'客戶總覽'},suppliers:{title:'廠商總覽'},companies:{title:'公司總覽'},employees:{title:'員工總覽'}};
function moduleById(id){return modules.find(m=>m.id===id)||modules[0]}
function renderModuleBar(){$('moduleBar').innerHTML=modules.map(m=>`<button data-module="${m.id}" class="${m.id===activeModule?'active':''}">${t(m.name)}</button>`).join('');document.querySelectorAll('[data-module]').forEach(b=>b.onclick=()=>openModule(b.dataset.module));}
function openModule(id){activeModule=id;renderModuleBar();renderTree(moduleById(id).tree);showHome(id);}
function renderTree(nodes){$('tree').innerHTML=nodes.map(n=>nodeHTML(n)).join('');bindTree();}
function nodeHTML(n){const has=n.children?.length;return `<div class="tree-node"><div class="tree-row" data-page="${n.page||''}" data-name="${esc(n.name)}"><span class="toggle">${has?'▾':'✦'}</span><span class="node-label">${has?'📁 ':''}${esc(t(n.name))}</span></div>${has?`<div class="children">${n.children.map(nodeHTML).join('')}</div>`:''}</div>`}
function bindTree(){document.querySelectorAll('.tree-row').forEach(r=>r.onclick=e=>{e.stopPropagation();document.querySelectorAll('.tree-row').forEach(x=>x.classList.remove('selected'));r.classList.add('selected');const c=r.nextElementSibling;if(c?.classList.contains('children')){c.classList.toggle('closed');r.querySelector('.toggle').textContent=c.classList.contains('closed')?'▸':'▾'}else if(r.dataset.page)openPage(r.dataset.page,r.dataset.name);});}
function showHome(){activePage='home';$('modulePage').classList.add('hidden');$('desktop').classList.remove('hidden');$('breadcrumb').textContent=`${t('首頁')} / ${t('功能導引')}`;const cards=[['sales','🧾','銷售管理'],['inventory','📦','存貨管理'],['purchase','🏷️','採購管理'],['ar','💵','應收管理'],['cost','🪙','成本管理'],['ap','📗','應付管理'],['invoice','🧮','發票管理'],['finance','💰','財務管理'],['bank','🏦','銀行管理']];$('desktop').innerHTML=`<div class="guide-grid">${cards.map((c,i)=>`<div class="guide-card" data-guide="${c[0]}"><div class="guide-icon">${c[1]}</div><div class="guide-name">${t(c[2])}</div>${i<6?'<div class="guide-arrow">↓</div>':''}</div>`).join('')}</div><div class="quick-links"><button data-page="items">${t('商品總覽')}</button><button data-page="warehouses">${t('倉庫總覽')}</button><button data-page="schedule">${t('計畫總覽')}</button><button data-page="people">${t('人員組織總覽')}</button><button data-page="general-ledger">${t('科目總覽')}</button></div>`;document.querySelectorAll('[data-guide]').forEach(x=>x.onclick=()=>openModule(x.dataset.guide));document.querySelectorAll('.quick-links [data-page]').forEach(x=>x.onclick=()=>openPage(x.dataset.page,x.textContent));}
function openPage(page,name){
  activePage=page;
  if(page==='home'){showHome();return}
  if(page==='logout'){showDialog(t('簽出'),t('自有權限系統'));return}
  $('desktop').classList.add('hidden');$('modulePage').classList.remove('hidden');
  const rawTitle=pages[page]?.title||name||page;const title=t(rawTitle);
  $('pageTitle').textContent=title;$('breadcrumb').textContent=`${t(moduleById(activeModule).name)} / ${title}`;
  document.querySelector('.page-head')?.classList.remove('customer-head-hidden');
  if(page==='items'){
    $('pageActions').innerHTML=['儲存','重新載入','新增','複製','移動','刪除','權限'].map(x=>`<button data-action="${x}">${t(x)}</button>`).join('');
    $('tabs').innerHTML=['基本資料','其他資料','交易對象','安全存量','庫存數量','附件','狀態'].map((x,i)=>`<button class="${i?'':'active'}">${t(x)}</button>`).join('');
    renderProductPage();setupProductSidebar();
  }else if(['customers','suppliers','companies','employees'].includes(page)){
    document.querySelector('.page-head')?.classList.add('customer-head-hidden');
    openClonePartyPage(page);
    return;
  }else{
    $('pageActions').innerHTML=['儲存','重新載入','新增','複製','移動','刪除','權限'].map(x=>`<button data-action="${x}">${t(x)}</button>`).join('');
    $('tabs').innerHTML=['基本資料','其他資料','交易對象','安全存量','庫存數量','附件','狀態'].map((x,i)=>`<button class="${i?'':'active'}">${t(x)}</button>`).join('');
    renderTree(moduleById(activeModule).tree);$('pageBody').innerHTML=genericPage(title);
  }
  $('statusText').textContent=`${t('已開啟：')}${title}`;
  document.querySelectorAll('#pageActions button').forEach(b=>b.onclick=()=>handlePageAction(page,b.dataset.action,title));

  if(page!=='items') document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('#tabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');});
}
function genericPage(title){return `<div class="placeholder"><section class="list-panel"><h3>${esc(title)}</h3><div class="fake-list"><button>${t('總覽')}</button><button>${t('待處理')}</button><button>${t('已完成')}</button></div></section><section class="form-panel"><h3>${t('資料維護')}</h3><div class="form-grid"><label>${t('編號')}</label><input><label>${t('名稱')}</label><input><label>${t('說明')}</label><textarea></textarea><label>${t('資料來源')}</label><input value="${t('待接 PostgreSQL 8.0 / we')}" readonly></div></section></div>`;}
function renderProductPage(){
  $('pageBody').innerHTML=`<section class="runec-product-form"><h3 id="productPath">${t('商品')} /Things/Items/Items/</h3><div class="runec-fields"><label class="code-label">${t('編號')}</label><input id="pId" class="code-input"><label class="name-label">${t('名稱')}</label><input id="pName" class="name-input"><label class="memo-label">${t('說明')}</label><textarea id="pMemo" class="memo-input"></textarea><label class="internal-label">${t('說明（僅供內部參考）')}</label><textarea id="pInternal" class="internal-input"></textarea><label class="photo-label">${t('照片')}</label><div class="photo-editor"><div class="photo-canvas"><img id="pPhoto" alt="${t('商品照片')}"></div><div class="photo-controls"><input id="pPhotoFile" type="file" accept="image/*"><button id="pPhotoClear" type="button">${t('清除預覽')}</button></div></div><label class="unit-label">${t('基本單位')}</label><input id="pUnit" class="unit-input"><label class="ref-label">${t('參考')}</label><input id="pReference" class="ref-input"><label class="barcode-label">${t('條碼')}</label><input id="pBarcode" class="barcode-input"><label class="status-label">${t('狀態')}</label><input id="pStatus" class="status-input" value="CLOUD SKU REGISTRY" readonly><label class="tables-label">${t('來源資料表')}</label><input id="pTables" class="tables-input" readonly></div><div class="runec-bottom-actions"><div class="runec-bottom-row"><button id="runecBackBtn" type="button">✓ ${t('返回')}</button><button id="runecVoidBtn" type="button">✓ ${t('作廢')}</button><button id="runecReloadBtn" type="button">↕ ${t('重新載入')}</button><button id="runecDeleteBtn" type="button">✕ ${t('刪除')}</button></div><div class="runec-bottom-row"><button id="runecPrintBtn" type="button">▣ ${t('列印')}</button><button id="runecPrevBtn" type="button">◀ ${t('上一張')}</button><button id="runecEditBtn" type="button">▧ ${t('單據編輯')}</button><button id="runecNextBtn" type="button">▷ ${t('下一張')}</button><button id="runecHistoryBtn" type="button">▧ ${t('單據歷史')}</button></div></div></section>`;
  $('pPhotoFile').onchange=readPhotoFile;
  $('pPhotoClear').onclick=()=>{pendingPhotoBase64='';$('pPhoto').removeAttribute('src')};
  bindRunecBottomActions();
}
function setupProductSidebar(){
  productNavMode='tree';
  $('tree').innerHTML=`<div class="product-nav"><div class="product-nav-title">🔧 Items - ${t('商品總覽')}</div><div class="product-nav-switch"><button id="productTreeMode" class="active">📁 ${t('樹狀')}</button><button id="productSearchMode">🔎 ${t('搜尋')}</button></div><div id="productTreePane"><div id="productList" class="sidebar-product-list"><div class="loading">${t('正在讀取 BookWide Cloud SKU 主檔…')}</div></div></div><div id="productSearchPane" class="hidden"><div class="sidebar-search"><input id="productSearch" placeholder="${t('品號／名稱')}"><button id="productSearchBtn">${t('搜尋')}</button></div><div id="productSearchResults" class="sidebar-product-list"></div></div></div>`;
  $('productTreeMode').onclick=()=>setProductNavMode('tree');
  $('productSearchMode').onclick=()=>setProductNavMode('search');
  $('productSearchBtn').onclick=()=>loadProducts($('productSearch').value.trim(),true);
  $('productSearch').onkeydown=e=>{if(e.key==='Enter')loadProducts(e.target.value.trim(),true)};
  loadProducts('',false);
}
function setProductNavMode(mode){
  productNavMode=mode;
  $('productTreePane')?.classList.toggle('hidden',mode!=='tree');
  $('productSearchPane')?.classList.toggle('hidden',mode!=='search');
  $('productTreeMode')?.classList.toggle('active',mode==='tree');
  $('productSearchMode')?.classList.toggle('active',mode==='search');
}
async function api(path,options={}){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),60000);
  try{
    let target=path;
    if(path.startsWith('/api/products')){const q=path.includes('?')?path.slice(path.indexOf('?')):'';target=ERP_API+'/api/bw-erp-items'+q}
    else if(path.startsWith('/api/product?id=')){target=ERP_API+'/api/bw-erp-item?id='+encodeURIComponent(new URL('https://x'+path).searchParams.get('id')||'')}
    const opts={cache:'no-store',signal:controller.signal,headers:{'Accept':'application/json',...(options.headers||{})},...options};
    const r=await fetch(target,opts);let j;try{j=await r.json()}catch{throw new Error(`HTTP ${r.status}：回傳不是 JSON`)}
    if(!r.ok||!j.ok)throw new Error(j.message||j.error||`HTTP ${r.status}`);return j;
  }catch(e){if(e.name==='AbortError')throw new Error('雲端 ERP 作業超過 60 秒');throw e}finally{clearTimeout(timer)}
}
async function loadProducts(q='',isSearch=false){
  const box=isSearch?$('productSearchResults'):$('productList'); if(!box)return; box.innerHTML=`<div class="loading">${t('正在讀取 BookWide Cloud SKU 主檔…')}</div>`;
  try{
    const params=new URLSearchParams(); if(q)params.set('search',q); const data=await api('/api/products'+(params.toString()?`?${params}`:''));
    const rows=data.products||[];
    if(!isSearch)products=rows;
    renderProductTree(rows,box,isSearch);
    $('statusText').textContent=`${t('Cloud SKU 已讀取')} ${rows.length} ${t('筆商品')}${q?'（'+t('搜尋')+'）':''}`;
    if(isSearch)setProductNavMode('search');
  }catch(e){box.innerHTML=`<div class="db-error">${t('商品讀取失敗')}：${esc(e.message)}</div>`;$('statusText').textContent=t('商品 API 失敗')}
}
function renderProductTree(items,box,isSearch=false){
  if(!items.length){box.innerHTML=`<div class="loading">${t('找不到商品。')}</div>`;return}
  if(isSearch){
    box.innerHTML=items.map((p,i)=>`<button class="real-product search-result" data-i="${i}">🔧 <b>${esc(p.id)}</b><span>${esc(p.name)}</span></button>`).join('');
  }else{
    const groups={}; items.forEach((p,i)=>(groups[p.category||t('未分類')]??=[]).push([p,i]));
    box.innerHTML=Object.entries(groups).map(([cat,rows])=>`<div class="product-group"><button class="product-folder">▾ 📁 ${esc(cat)}（${rows.length}）</button><div class="product-children">${rows.map(([p,i])=>`<button class="real-product" data-i="${i}">🔧 <b>${esc(p.id)}</b><span>${esc(p.name)}</span></button>`).join('')}</div></div>`).join('');
    box.querySelectorAll('.product-folder').forEach(b=>b.onclick=()=>{const c=b.nextElementSibling;c.classList.toggle('closed');b.textContent=(c.classList.contains('closed')?'▸':'▾')+b.textContent.slice(1)});
  }
  box.querySelectorAll('.real-product').forEach(b=>b.onclick=()=>selectProduct(items[Number(b.dataset.i)],b));
}
async function selectProduct(summary,button){
  try{
    const data=await api('/api/product?id='+encodeURIComponent(summary.id)); const p=data.product; currentProduct=p; originalProductId=p.id; isNewProduct=false; pendingPhotoBase64='';
    document.querySelectorAll('.real-product').forEach(x=>x.classList.remove('selected'));button?.classList.add('selected'); fillProductForm(p);
  }catch(e){showDialog(t('商品讀取失敗'),e.message)}
}
function fillProductForm(p){
  $('pId').value=p.id||'';$('pName').value=p.name||'';$('pMemo').value=p.memo||p.description||'';$('pInternal').value=p.internalMemo||'';$('pUnit').value=p.unit||'';$('pReference').value=p.reference||'';$('pBarcode').value=p.barcode||'';$('pStatus').value=p.status||'CLOUD SKU REGISTRY';$('pTables').value=(p._tables||[]).join(', ');$('productPath').textContent=`${t('商品')} /Things/Items/Items/${p.category||''}/${p.id||''}`;
  const img=$('pPhoto');
  img.onerror=()=>{img.removeAttribute('src');img.alt=t('商品照片讀取失敗')+'：'+(p.id||'')};
  img.onload=()=>{img.alt=t('商品照片')};
  if(p.photo_url){img.src=p.photo_url}else img.removeAttribute('src');
}
function bindRunecBottomActions(){
  $('runecBackBtn').onclick=()=>showHome();
  $('runecVoidBtn').onclick=()=>showDialog(t('作廢'),t('商品資料不做作廢處理。'));
  $('runecReloadBtn').onclick=()=>handlePageAction('items','重新載入',t('商品總覽'));
  $('runecDeleteBtn').onclick=()=>handlePageAction('items','刪除',t('商品總覽'));
  $('runecPrintBtn').onclick=openLabelDialog;
  $('runecPrevBtn').onclick=()=>moveCurrentProduct(-1);
  $('runecNextBtn').onclick=()=>moveCurrentProduct(1);
  $('runecEditBtn').onclick=()=>showDialog(t('單據編輯'),t('保留 RunEC 原位置，功能後續接入。'));
  $('runecHistoryBtn').onclick=()=>showDialog(t('單據歷史'),t('保留 RunEC 原位置，功能後續接入。'));
}
async function moveCurrentProduct(step){
  if(!products.length){showDialog(t('商品總覽'),t('目前沒有商品資料'));return}
  let index=products.findIndex(p=>p.id===originalProductId);
  if(index<0)index=step>0?-1:0;
  index=(index+step+products.length)%products.length;
  const target=products[index];
  const button=[...document.querySelectorAll('#productList .real-product')].find(b=>products[Number(b.dataset.i)]?.id===target.id);
  await selectProduct(target,button||null);
}
function formProduct(){return {id:$('pId').value.trim(),name:$('pName').value.trim(),memo:$('pMemo').value,description:$('pMemo').value,internalMemo:$('pInternal').value,reference:$('pReference').value,unit:$('pUnit').value,barcode:$('pBarcode').value,photoBase64:pendingPhotoBase64}}
function readPhotoFile(e){const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{pendingPhotoBase64=String(r.result);$('pPhoto').src=pendingPhotoBase64};r.readAsDataURL(f)}
async function handlePageAction(page,action,title){  if(page==='items'&&['儲存','新增','複製','刪除'].includes(action)){showDialog('Cloud SKU Registry','V0.7 商品主檔由 LINE Product 後台管理。\nERP 此頁負責 SKU 查詢與主檔檢視，避免雙邊維護造成重複。');return}

  if(page!=='items'){showDialog(action,`${title} 的「${action}」尚未接上。`);return}
  try{
    if(action==='重新載入'){await loadProducts('',false);return}
    if(action==='新增'){isNewProduct=true;originalProductId='';currentProduct=null;pendingPhotoBase64='';fillProductForm({status:'NEW',_tables:['Entity','Thing','Item']});$('pId').focus();return}
    if(action==='儲存'){
      const body=formProduct(); if(!body.id)throw new Error(t('商品編號不可空白'));
      const result=isNewProduct?await api('/api/products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,templateId:originalProductId||products[0]?.id||''})}):await api('/api/product?id='+encodeURIComponent(originalProductId),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      isNewProduct=false;originalProductId=result.product.id;currentProduct=result.product;pendingPhotoBase64='';await loadProducts('',false);await selectProduct(result.product,null);showDialog(t('儲存成功'),`商品 ${result.product.id} 已寫入 PostgreSQL。`);return
    }
    if(action==='複製'){
      if(!currentProduct)throw new Error(t('請先選商品'));const newId=prompt(t('新商品編號：'),currentProduct.id+'-COPY');if(!newId)return;
      const body={...formProduct(),id:newId,name:(currentProduct.name||'')+' 複製',sourceId:originalProductId};await api('/api/products/copy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});await loadProducts('',false);await selectProduct({id:newId},null);showDialog(t('複製成功'),`已建立 ${newId}`);return
    }
    if(action==='刪除'){
      if(!currentProduct)throw new Error(t('請先選商品'));if(!confirm(`確定刪除商品 ${originalProductId}？\n若有 BOM／交易引用，PostgreSQL 會拒絕刪除。`))return;
      await api('/api/product?id='+encodeURIComponent(originalProductId),{method:'DELETE'});currentProduct=null;originalProductId='';await loadProducts('',false);showDialog(t('刪除成功'),'商品已從 PostgreSQL 刪除。');return
    }
    showDialog(action,`${action} 尚未接上。`)
  }catch(e){showDialog(action+'失敗',e.message)}
}
function openLabelDialog(){
  const productId=($('pId')?.value||currentProduct?.id||'').trim();
  if(!productId){showDialog(t('列印標籤'),t('請先選商品'));return}
  $('dialogTitle').textContent=t('列印標籤');
  $('dialogBody').innerHTML=`<div class="label-dialog-grid"><div>${t('產品品號')}</div><div class="label-product">${esc(productId)}</div><div>${t('標籤格式')}</div><div class="label-options"><label><input type="radio" name="labelKind" value="golabel30" checked> GoLabel／QLabel 30 mm</label><label><input type="radio" name="labelKind" value="brother12"> Brother P-touch 12 mm</label><label><input type="radio" name="labelKind" value="brother24"> Brother P-touch 24 mm</label></div></div><div class="label-note">按「開啟原廠軟體」後，ERP 會把目前品號複製到 Windows 剪貼簿，並開啟對應的 .ezp／.lbx 範本。</div><div class="label-launch-actions"><button id="labelCancelBtn" type="button">${t('取消')}</button><button id="labelOpenBtn" type="button">${t('開啟原廠軟體')}</button></div>`;
  $('dialogClose').classList.add('hidden');
  $('dialog').classList.remove('hidden');
  $('labelCancelBtn').onclick=closeLabelDialog;
  $('labelOpenBtn').onclick=()=>launchLabel(productId);
}
function closeLabelDialog(){
  $('dialog').classList.add('hidden');
  $('dialogClose').classList.remove('hidden');
}
async function launchLabel(productId){
  const kind=document.querySelector('input[name="labelKind"]:checked')?.value||'golabel30';
  const btn=$('labelOpenBtn');btn.disabled=true;btn.textContent=t('開啟中…');
  try{
    const result=await api('/api/label/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId,kind})});
    closeLabelDialog();
    $('statusText').textContent=`${productId} 已複製，已開啟 ${result.labelName||kind}`;
    showDialog(t('標籤已開啟'),`${productId}
已複製到剪貼簿，請在原廠標籤軟體貼入品號後列印。`);
  }catch(e){btn.disabled=false;btn.textContent=t('開啟原廠軟體');showDialog(t('開啟標籤失敗'),e.message)}
}


/* ===== V2.6 RunEC customer clone. Product module above is intentionally untouched. ===== */
function renderCustomerPage(){
  $('pageBody').innerHTML=`<section class="runec-customer-form">
    <div class="party-kind-bar"><button class="active">🏢 公司</button><button>👤 個人</button><button>🧑‍💼 員工</button></div>
    <h3 id="customerPath">人員組織 /Things/Parties/Parties/P_Customer/</h3>
    <div id="customerTabBody" class="customer-tab-body"></div>
    <div class="customer-user-title standalone">用戶帳號</div>
    <div class="customer-pay-strip"><span>客戶付款條件 <a id="customerPayLink" href="#">[未指定]</a></span><span>廠商付款條件 [未指定]</span></div>
    <div class="customer-lower-actions">
      <div><button data-ca="儲存">✓ 儲存</button><span>|</span><button data-ca="重新載入">↕ 重新載入</button><span>|</span><button data-ca="新增人員組織">▧ 新增人員組織</button><button data-ca="複製">▧ 複製</button></div>
      <div><button data-ca="移動">↗ 移動</button><button data-ca="刪除">✂ 刪除</button><span>|</span><button data-ca="權限">🔒 權限</button></div>
    </div>
    <div class="customer-master-list-wrap">
      <table class="customer-master-list"><thead><tr><th>編號</th><th>名稱</th><th>編號</th><th>名稱</th></tr></thead><tbody id="customerMasterBody"><tr><td colspan="4">正在讀取 P_Customer…</td></tr></tbody></table>
      <div id="customerPager" class="customer-pager"></div>
    </div>
  </section>`;
  document.querySelectorAll('[data-ca]').forEach(b=>b.onclick=()=>handleCustomerAction(b.dataset.ca));
  showCustomerTab('basic');
}
function setupCustomerSidebar(){
  customerNavMode='tree';
  $('tree').innerHTML=`<div class="product-nav customer-nav runec-party-sidebar">
    <div id="partyTree" class="sidebar-product-list customer-tree-list"><div class="loading">正在讀取 RunEC 人員組織…</div></div>
    <div class="runec-party-links"><a href="#">新增員工組織</a><a href="#">新增客戶</a><a href="#">新增廠商</a><a href="#">輸出</a></div>
    <div class="sidebar-search customer-search-line"><input id="customerSearch" placeholder=""><button id="customerSearchBtn">搜尋</button><a class="advanced-link" href="#">進階</a></div>
    <div class="runec-party-footer-links"><a href="#">公司組織</a><a href="#">公司規範</a><a href="#">層級總覽</a><a href="#">新增公司</a></div>
  </div>`;
  $('customerSearchBtn').onclick=()=>loadCustomers($('customerSearch').value.trim(),true);
  $('customerSearch').onkeydown=e=>{if(e.key==='Enter')loadCustomers(e.target.value.trim(),true)};
  loadPartyTree();
}
function setCustomerNavMode(mode){ customerNavMode=mode; }
async function loadPartyTree(){
  const box=$('partyTree');if(!box)return;
  try{
    const data=await api('/api/party-tree');
    const nodes=data.nodes||[];customers=data.customers||[];
    box.innerHTML=`<div class="party-tree-root">▾ 📂 <b>Parties - 人員組織總覽</b></div>`+nodes.map((n,i)=>{
      const isCustomer=n.id==='P_Customer';
      return `<div class="party-tree-node"><button class="party-folder ${isCustomer?'selected':''}" data-party-index="${i}">${isCustomer?'▾':'⊞'} 🏢 <b>${esc(n.id)}</b>${n.name?` - ${esc(n.name)}`:''}</button>${isCustomer?`<div class="party-customer-children">${customers.slice(0,80).map((c,j)=>`<button class="customer-row" data-ci="${j}">└ 🏢 <b>${esc(c.id)}</b>${c.name?` - ${esc(c.name)}`:''}</button>`).join('')}</div>`:''}</div>`;
    }).join('');
    box.querySelectorAll('.customer-row').forEach(b=>b.onclick=()=>selectCustomer(customers[Number(b.dataset.ci)],b));
    renderCustomerMasterList(customers);
    $('statusText').textContent=`Cloud SKU 已讀取 ${customers.length} 筆 P_Customer 客戶`;
  }catch(e){box.innerHTML=`<div class="error">客戶讀取失敗：${esc(e.message)}</div>`;$('statusText').textContent='客戶 API 失敗：'+e.message;}
}
function renderCustomerMasterList(rows){
  const body=$('customerMasterBody');if(!body)return;
  if(!rows||!rows.length){body.innerHTML='<tr><td colspan="4">找不到客戶資料</td></tr>';return}
  let html='';
  for(let i=0;i<rows.length;i+=2){const a=rows[i]||{},b=rows[i+1]||{};html+=`<tr><td><a href="#" data-mid="${esc(a.id||'')}">${esc(a.id||'')}</a></td><td>${esc(a.name||'')}</td><td><a href="#" data-mid="${esc(b.id||'')}">${esc(b.id||'')}</a></td><td>${esc(b.name||'')}</td></tr>`}
  body.innerHTML=html;
  body.querySelectorAll('a[data-mid]').forEach(a=>a.onclick=async e=>{e.preventDefault();const id=a.dataset.mid;if(id)await selectCustomer({id});});
}
async function loadCustomers(q='',isSearch=true){
  const box=$('partyTree');if(!box)return;
  $('statusText').textContent='正在搜尋 RunEC P_Customer…';
  try{
    const params=new URLSearchParams();if(q)params.set('search',q);
    const data=await api('/api/customers'+(params.toString()?`?${params}`:''));
    const rows=data.customers||[];customers=rows;
    if(!rows.length){box.innerHTML='<div class="loading">找不到客戶。</div>';return}
    box.innerHTML=`<div class="party-tree-root">▾ 📂 <b>Parties - 人員組織總覽</b></div><div class="party-tree-node"><button class="party-folder selected">▾ 🏢 <b>P_Customer</b></button><div class="party-customer-children">${rows.map((c,i)=>`<button class="customer-row" data-ci="${i}">└ 🏢 <b>${esc(c.id)}</b>${c.name?` - ${esc(c.name)}`:''}</button>`).join('')}</div></div>`;
    box.querySelectorAll('.customer-row').forEach(b=>b.onclick=()=>selectCustomer(rows[Number(b.dataset.ci)],b));
    renderCustomerMasterList(rows);
    $('statusText').textContent=`Cloud SKU 已讀取 ${rows.length} 筆客戶${q?`（搜尋：${q}）`:''}`;
    if(rows.length===1)await selectCustomer(rows[0],box.querySelector('.customer-row'));
  }catch(e){box.innerHTML=`<div class="db-error">客戶資料讀取失敗<br>${esc(e.message)}</div>`;$('statusText').textContent='客戶 API 失敗：'+e.message}
}
async function selectCustomer(summary,button=null){
  try{
    const data=await api('/api/customer?id='+encodeURIComponent(summary.id));
    currentCustomer=data.customer;originalCustomerId=currentCustomer.id;
    document.querySelectorAll('.customer-row').forEach(x=>x.classList.remove('selected'));button?.classList.add('selected');
    $('customerPath').textContent=`人員組織 /Things/Parties/Parties/P_Customer/${currentCustomer.id}`;
    $('customerPayLink').textContent=`${currentCustomer.id} ${currentCustomer.name}`;
    showCustomerTab(customerTab);
    $('statusText').textContent=`客戶 ${currentCustomer.id} ${currentCustomer.name}｜${(currentCustomer._tables||[]).join(' / ')}`;
  }catch(e){showDialog('客戶讀取失敗',e.message)}
}
function cval(v){return esc(v??'')}
function customerBasicHTML(c={}){return `<div class="customer-basic-grid">
  <label>編號*</label><input id="cId" value="${cval(c.id)}"><label class="c-right-label">說明*</label><textarea id="cDescription" class="customer-description">${cval(c.description)}</textarea>
  <label>名稱*</label><input id="cName" value="${cval(c.name)}"><span></span><span></span>
  <label>簡稱*</label><input id="cAbbr" value="${cval(c.abbreviation)}"><span></span><span></span>
  <label>負責人*</label><input id="cChairman" value="${cval(c.chairman)}"><span></span><span></span>
  <label>負責經辦人</label><input id="cDirectAgent" value="${cval(c.directAgent)}"><span></span><span></span>
  <label>統一編號</label><input id="cOfficialId" value="${cval(c.officialId)}"><label class="c-right-label c-price-label">定價類別</label><select id="cPricingType"><option>${cval(c.pricingType||'直銷')}</option><option>直銷</option><option>經銷</option></select>
  <label>人員組織歸類</label><div class="customer-category-line"><select id="cCategories"><option>${cval(c.categories||'不限')}</option><option>不限</option></select><input value="" readonly></div><span></span><span></span>
  <label class="customer-photo-label">照片</label><div class="customer-photo"><div class="customer-photo-placeholder">Image<br>Unavailable<br>未定義</div><button type="button">▧ 上傳照片</button></div><span></span><span></span>
</div>`}
function listField(title,items=[]){const vals=(Array.isArray(items)&&items.length)?items:[''];return `<div class="contact-box"><div class="contact-head">${title}<span>⊞⊟</span></div>${vals.map(v=>`<div class="contact-line"><input value="${cval(v)}"><span>⊞⊟</span></div>`).join('')}</div>`}
function customerContactHTML(c={}){return `<div class="customer-contact-wrap">
  <div class="contact-top"><label>主管*</label><input value="${cval(c.manager)}"><label>Web 網址</label><input value="${cval(c.website)}"></div><hr>
  <div class="contact-two">${listField('聯絡人',c.contactPersons)}${listField('電子郵件',c.emails)}</div><hr>
  <div class="contact-two">${listField('手機',c.mobiles)}${listField('電話',c.phones)}</div>
  <div class="contact-two">${listField('傳真',c.faxes)}${listField('呼叫器',c.pagers)}</div><hr>
  <div class="address-note">*第一個地址為【帳單地址】，第二個地址為【送貨地址】</div>
  <div class="address-box"><div class="contact-head">地址<span>⊞⊟</span></div><div class="address-grid"><label>街道號碼*</label><textarea>${cval(c.street)}</textarea><label>縣／市／區*</label><input value="${cval(c.city)}"><label>省／市*</label><input value="${cval(c.state)}"><label>郵遞區號</label><input value="${cval(c.zip)}"><label>國家／地區</label><select><option>${cval(c.country||'台灣')}</option></select></div></div>
</div>`}
function customerBusinessHTML(c={}){return `<div class="customer-business-grid">
  <label>成立日期</label><input value="${cval(c.birthday)}"><label>所營事業*</label><textarea>${cval(c.bizRealm)}</textarea>
  <label>資本額</label><div><input value="${cval(c.capital||0)}"><select><option>${cval(c.capitalCurrency||'新台幣')}</option></select></div>
  <label>實收資本額</label><input value="${cval(c.issuedCapital||0)}"><label>成員人數</label><input value="${cval(c.estMemberCount||0)}">
  <label>年營業額</label><div><input value="${cval(c.estIncome||0)}"><select><option>${cval(c.estIncomeCurrency||'新台幣')}</option></select></div>
  <label>稅籍編號</label><input value="${cval(c.officialTaxId)}"><label>啟用日</label><input value="${cval(c.fromDate)}"><label>停用日</label><input value="${cval(c.thruDate)}">
  <label></label><label class="pin-line"><input type="checkbox" ${c.virtualRoot?'checked':''}> 置頂（顯示在最上層）</label>
</div>`}
function customerAttachmentHTML(){return `<div class="customer-attachment"><div class="attach-head"><span>內容</span><span>說明*</span></div><div>* 未指定 *</div><button>▧ 上傳附件</button></div>`}
function customerStatusHTML(c={}){return `<div class="customer-status"><div>更改日期 ${cval(c.lastModified)}</div><div>更改者 <a href="#">${cval(c.modifiedBy||'RAYMOND')}</a></div><div>建立日期 ${cval(c.created)}</div><div>建立者 <a href="#">${cval(c.createdBy||'RAYMOND')}</a></div><div>版本 ${cval(c.version)}</div></div>`}
function showCustomerTab(tab){
  customerTab=tab;
  document.querySelectorAll('#tabs [data-customer-tab]').forEach(b=>b.classList.toggle('active',b.dataset.customerTab===tab));
  const body=$('customerTabBody');if(!body)return;const c=currentCustomer||{};
  body.innerHTML=tab==='basic'?customerBasicHTML(c):tab==='contact'?customerContactHTML(c):tab==='business'?customerBusinessHTML(c):tab==='attachment'?customerAttachmentHTML():customerStatusHTML(c);
}
async function handleCustomerAction(action){
  if(action==='重新載入'){if(originalCustomerId)await selectCustomer({id:originalCustomerId});else await loadPartyTree();return}
  if(action==='儲存'){showDialog('儲存','V2.6 先完成 RunEC 客戶真實讀取與克隆畫面；寫入會在欄位確認後開放。');return}
  showDialog(action,`保留 RunEC 原位置：「${action}」。`);
}



// ===== V2.7 RunEC Clone Engine: one renderer for Customer/Vendor/Company/Employee =====
const CLONE_PAGE_KIND={customers:'customer',suppliers:'vendor',companies:'company',employees:'employee'};
let cloneKind='customer', cloneRows=[], cloneCurrent=null, cloneTab='basic';
const CLONE_LABEL={customer:'客戶',vendor:'廠商',company:'公司',employee:'員工'};
function cloneTabs(kind){return kind==='employee'?[['basic','基本資料'],['contact','通訊資料'],['attachment','附件'],['status','狀態']]:[['basic','基本資料'],['contact','通訊資料'],['business','營業資料'],['attachment','附件'],['status','狀態']]}
function openClonePartyPage(page){
  cloneKind=CLONE_PAGE_KIND[page]||'customer'; cloneCurrent=null; cloneTab='basic';
  const label=CLONE_LABEL[cloneKind];
  $('pageTitle').textContent=label+'總覽'; $('breadcrumb').textContent=`${t(moduleById(activeModule).name)} / ${label}總覽`;
  $('tabs').innerHTML=cloneTabs(cloneKind).map(([id,x],i)=>`<button data-clone-tab="${id}" class="${i?'':'active'}">${x}</button>`).join('');
  $('pageActions').innerHTML=['儲存','重新載入','新增','複製','移動','刪除','權限'].map(a=>`<button data-clone-action="${a}">${a}</button>`).join('');
  $('pageBody').innerHTML=`<section class="runec-customer-form"><div class="party-kind-bar"><button class="active">🏢 公司</button><button>👤 個人</button><button>🧑‍💼 員工</button></div><h3 id="clonePath">人員組織 /Things/Parties/Parties/</h3><div id="cloneTabBody" class="customer-tab-body"></div><div class="customer-user-title standalone">用戶帳號</div><div class="customer-pay-strip"><span>${label}付款條件 <a id="clonePayLink" href="#">[未指定]</a></span><span>交易付款條件 [未指定]</span></div><div class="customer-lower-actions"><div><button>✓ 儲存</button><span>|</span><button>↕ 重新載入</button><span>|</span><button>▧ 新增人員組織</button><button>▧ 複製</button></div><div><button>↗ 移動</button><button>✂ 刪除</button><span>|</span><button>♟ 權限</button></div></div><div class="customer-master-list-wrap"><table class="customer-master-list"><thead><tr><th>編號</th><th>名稱</th><th>編號</th><th>名稱</th></tr></thead><tbody id="cloneMasterBody"><tr><td colspan="4">正在讀取 ${label}…</td></tr></tbody></table></div></section>`;
  renderCloneSidebar(); showCloneTab('basic'); loadCloneTree();
  document.querySelectorAll('[data-clone-tab]').forEach(b=>b.onclick=()=>showCloneTab(b.dataset.cloneTab));
  document.querySelectorAll('[data-clone-action]').forEach(b=>b.onclick=()=>{if(b.dataset.cloneAction==='重新載入')loadCloneTree();else showDialog(b.dataset.cloneAction,'V2.7 Clone Engine 保留 RunEC 原操作位置；寫入逐類型驗證後開放。')});
}
function renderCloneSidebar(){
 const label=CLONE_LABEL[cloneKind];
 $('tree').innerHTML=`<div class="product-nav customer-nav runec-party-sidebar"><div id="cloneTree" class="sidebar-product-list customer-tree-list"><div class="loading">正在讀取 RunEC ${label}…</div></div><div class="runec-party-links"><a href="#">新增員工組織</a><a href="#">新增客戶</a><a href="#">新增廠商</a><a href="#">輸出</a></div><div class="sidebar-search customer-search-line"><input id="cloneSearch" placeholder=""><button id="cloneSearchBtn">搜尋</button><a class="advanced-link" href="#">進階</a></div><div class="runec-party-footer-links"><a href="#">公司組織</a><a href="#">公司規範</a><a href="#">層級總覽</a><a href="#">新增公司</a></div></div>`;
 $('cloneSearchBtn').onclick=()=>loadCloneRows($('cloneSearch').value.trim()); $('cloneSearch').onkeydown=e=>{if(e.key==='Enter')loadCloneRows(e.target.value.trim())};
}
async function loadCloneTree(){
 const box=$('cloneTree'); if(!box)return; const label=CLONE_LABEL[cloneKind];
 try{const data=await api('/api/clone/tree?kind='+encodeURIComponent(cloneKind)); cloneRows=data.rows||[]; const roots=data.roots||[];
 box.innerHTML=`<div class="party-tree-root">▾ 📂 <b>Parties - 人員組織總覽</b></div>`+roots.map(r=>`<div class="party-tree-node"><button class="party-folder selected">▾ 🏢 <b>${esc(r.id)}</b>${r.name?` - ${esc(r.name)}`:''}</button></div>`).join('')+`<div class="party-customer-children">${cloneRows.slice(0,120).map((c,i)=>`<button class="customer-row" data-cli="${i}">└ 🏢 <b>${esc(c.id)}</b>${c.name?` - ${esc(c.name)}`:''}</button>`).join('')}</div>`;
 box.querySelectorAll('[data-cli]').forEach(b=>b.onclick=()=>selectCloneRow(cloneRows[Number(b.dataset.cli)],b)); renderCloneMaster(); $('statusText').textContent=`Cloud SKU 已讀取 ${cloneRows.length} 筆${label}`;
 }catch(e){box.innerHTML=`<div class="db-error">${label}讀取失敗：${esc(e.message)}</div>`;$('statusText').textContent=e.message}
}
async function loadCloneRows(q=''){
 const data=await api('/api/clone/list?kind='+encodeURIComponent(cloneKind)+'&search='+encodeURIComponent(q)); cloneRows=data.rows||[]; const box=$('cloneTree');
 box.innerHTML=`<div class="party-tree-root">▾ 📂 <b>Parties - 人員組織總覽</b></div><div class="party-customer-children">${cloneRows.map((c,i)=>`<button class="customer-row" data-cli="${i}">└ 🏢 <b>${esc(c.id)}</b>${c.name?` - ${esc(c.name)}`:''}</button>`).join('')}</div>`;box.querySelectorAll('[data-cli]').forEach(b=>b.onclick=()=>selectCloneRow(cloneRows[Number(b.dataset.cli)],b));renderCloneMaster();
}
function renderCloneMaster(){const body=$('cloneMasterBody');if(!body)return;let h='';for(let i=0;i<cloneRows.length;i+=2){let a=cloneRows[i]||{},b=cloneRows[i+1]||{};h+=`<tr><td><a href="#" data-cmid="${esc(a.id||'')}">${esc(a.id||'')}</a></td><td>${esc(a.name||'')}</td><td><a href="#" data-cmid="${esc(b.id||'')}">${esc(b.id||'')}</a></td><td>${esc(b.name||'')}</td></tr>`}body.innerHTML=h||'<tr><td colspan="4">無資料</td></tr>';body.querySelectorAll('[data-cmid]').forEach(a=>a.onclick=e=>{e.preventDefault();selectCloneRow({id:a.dataset.cmid})})}
async function selectCloneRow(summary,button=null){try{const data=await api('/api/clone/get?kind='+encodeURIComponent(cloneKind)+'&id='+encodeURIComponent(summary.id));cloneCurrent=data.row;document.querySelectorAll('.customer-row').forEach(x=>x.classList.remove('selected'));button?.classList.add('selected');$('clonePath').textContent=`人員組織 /Things/Parties/Parties/${cloneKind}/${cloneCurrent.id}`;$('clonePayLink').textContent=`${cloneCurrent.id} ${cloneCurrent.name}`;showCloneTab(cloneTab);$('statusText').textContent=`${CLONE_LABEL[cloneKind]} ${cloneCurrent.id} ${cloneCurrent.name}｜${(cloneCurrent._tables||[]).join(' / ')}`;}catch(e){showDialog(CLONE_LABEL[cloneKind]+'讀取失敗',e.message)}}
function showCloneTab(tab){cloneTab=tab;document.querySelectorAll('[data-clone-tab]').forEach(b=>b.classList.toggle('active',b.dataset.cloneTab===tab));const body=$('cloneTabBody');if(!body)return;const c=cloneCurrent||{};body.innerHTML=tab==='basic'?customerBasicHTML(c):tab==='contact'?customerContactHTML(c):tab==='business'?customerBusinessHTML(c):tab==='attachment'?customerAttachmentHTML():customerStatusHTML(c)}

function showDialog(title,body){$('dialogTitle').textContent=title;$('dialogBody').textContent=body;$('dialog').classList.remove('hidden')}
async function health(){try{const j=await api('/api/health');$('statusText').textContent=`PostgreSQL ${j.host}:${j.port}/${j.database} 已連線（可讀寫）`;}catch(e){$('statusText').textContent=t('PostgreSQL 尚未連線：')+e.message;}}

function initSidebarResizer(){
  const grip=$('sidebarResizer'),shell=document.querySelector('.shell'); if(!grip||!shell)return;
  let startX=0,startW=0;
  grip.addEventListener('mousedown',e=>{startX=e.clientX;startW=document.querySelector('.sidebar').getBoundingClientRect().width;document.body.classList.add('resizing');const move=ev=>{const w=Math.max(190,Math.min(430,startW+ev.clientX-startX));shell.style.gridTemplateColumns=`${w}px 6px minmax(0,1fr)`;localStorage.setItem('bookwide.erp.sidebarWidth',String(w))};const up=()=>{window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up);document.body.classList.remove('resizing')};window.addEventListener('mousemove',move);window.addEventListener('mouseup',up)});
  const saved=Number(localStorage.getItem('bookwide.erp.sidebarWidth'));if(saved>=190&&saved<=430)shell.style.gridTemplateColumns=`${saved}px 6px minmax(0,1fr)`;
}
function boot(){
  applyStaticTranslations();
  const langSel=$('languageSelect');if(langSel)langSel.onchange=()=>{currentLang=langSel.value;localStorage.setItem('bookwide.erp.lang',currentLang);applyStaticTranslations();renderModuleBar();renderTree(moduleById(activeModule).tree);if(activePage==='home')showHome();else openPage(activePage,pages[activePage]?.title||activePage);};
  $('dialogClose').onclick=()=>$('dialog').classList.add('hidden');
  $('collapseBtn').onclick=()=>document.querySelectorAll('.children').forEach(x=>x.classList.add('closed'));
  $('refreshBtn').onclick=()=>openModule(activeModule);
  $('signOutBtn').onclick=()=>showDialog(t('簽出'),t('自有權限系統'));
  initSidebarResizer();renderModuleBar();renderTree(moduleById(activeModule).tree);showHome();health();
}
window.addEventListener('error',e=>{console.error(e.error||e.message);const st=$('statusText');if(st)st.textContent='前端錯誤：'+e.message;});
window.addEventListener('unhandledrejection',e=>{console.error(e.reason);const st=$('statusText');if(st)st.textContent='程式錯誤：'+(e.reason?.message||e.reason);});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
