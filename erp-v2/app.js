"use strict";

// === core/api.js ===


const CONFIG={
  API: localStorage.getItem("bw_erp_v2_api") || "https://bookwide-erp-api.pmktools.workers.dev"
};
async function api(path,opt={}){
  const headers={"Content-Type":"application/json",...(opt.headers||{})};
  const token=localStorage.getItem("bw_erp_v2_write_token");
  if(token)headers["X-ERP-Write-Token"]=token;
  const r=await fetch(CONFIG.API+path,{cache:"no-store",...opt,headers});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.ok===false)throw new Error(j.message||j.error||`HTTP ${r.status}`);
  return j;
}
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const money=v=>Number(v||0).toLocaleString("zh-TW",{maximumFractionDigits:2});
const today=()=>new Date().toISOString().slice(0,10);
const clone=v=>JSON.parse(JSON.stringify(v));


// === modules/items.js ===


const itemsModule={
 title:"存貨",
 tree:[["items","商品總覽"],["inventory","庫存總覽"]],
 async render(page,ctx){
   if(page==="inventory"){const j=await api("/api/inventory");ctx.ws.innerHTML=`<div class="card"><h2>庫存總覽</h2><table class="gridTable"><tr><th>SKU</th><th>名稱</th><th>目前庫存</th><th>安全存量</th></tr>${(j.rows||[]).map(x=>`<tr><td>${esc(x.sku)}</td><td>${esc(x.name)}</td><td>${money(x.stock_qty)}</td><td>${money(x.safety_stock)}</td></tr>`).join("")}</table></div>`;return}
   const j=await api("/api/items"),rows=j.rows||[];
   ctx.ws.innerHTML=`<div class="layout2"><aside class="listPanel"><b>Items - 商品總覽</b><input id="iq" class="listSearch" placeholder="SKU / 名稱"><div id="ilist"></div></aside><section><div class="tabs"><button class="active">基本資料</button><button>其他資料</button><button>交易對象</button><button>安全存量</button><button>庫存數量</button><button>附件</button><button>狀態</button></div><div id="itemForm"></div></section></div>`;
   const list=filter=>{const q=(filter||"").toLowerCase();document.querySelector("#ilist").innerHTML=rows.filter(x=>!q||[x.sku,x.name,x.category].some(v=>String(v||"").toLowerCase().includes(q))).map(x=>`<button class="rowBtn" data-sku="${esc(x.sku)}"><b>${esc(x.sku)}</b><span>${esc(x.name)}</span></button>`).join("");document.querySelectorAll("[data-sku]").forEach(b=>b.onclick=()=>show(rows.find(x=>x.sku===b.dataset.sku)))};
   const show=x=>{document.querySelector("#itemForm").innerHTML=`<div class="formGrid"><label>編號 / SKU<input value="${esc(x.sku)}" readonly></label><label class="span2">名稱<input value="${esc(x.name)}" readonly></label><label>狀態<input value="${esc(x.status||"ACTIVE")}" readonly></label><label class="span4">說明<textarea readonly>${esc(x.description||"")}</textarea></label><label>類別<input value="${esc(x.category||"")}" readonly></label><label>品牌<input value="${esc(x.brand||"")}" readonly></label><label>單位<input value="${esc(x.unit||"PCS")}" readonly></label><label>前台牌價<input value="${money(x.price)}" readonly></label><label>來源 SKU<input value="${esc(x.source_sku_id||"")}" readonly></label><label>庫存<input value="${money(x.stock_qty)}" readonly></label></div>`};
   document.querySelector("#iq").oninput=e=>list(e.target.value);list("");if(rows[0])show(rows[0]);
 }
};


// === modules/parties.js ===


const kinds={customer:"客戶",company:"公司",vendor:"廠商",employee:"員工"};
function blank(kind){return {kind,id:"",name:"",abbreviation:"",description:"",responsible_person:"",agent:"",tax_id:"",pricing_type:"直銷",category:"不限",contact:"",phone:"",mobile:"",email:"",fax:"",website:"",address:"",city:"",state:"",zip:"",country:"台灣",payment_terms:"",delivery:"",currency:"TWD",salesperson:"",notes:""}}
const partiesModule={
 title:"系統",
 tree:[["party-customer","客戶總覽"],["party-company","公司總覽"],["party-vendor","廠商總覽"],["party-employee","員工總覽"]],
 async render(page,ctx){
   const kind=page.replace("party-",""),label=kinds[kind]||"人員組織";
   let j=await api("/api/parties?kind="+kind),rows=j.rows||[],current=null;
   ctx.ws.innerHTML=`<div class="toolbar"><button id="pNew">新增</button><button id="pSave">儲存</button><button id="pReload">重新載入</button></div><div class="layout2"><aside class="listPanel"><div class="treeTitle">${label}總覽</div><input id="pq" class="listSearch" placeholder="編號 / 名稱"><div id="plist"></div></aside><section><div class="tabs"><button class="active">基本資料</button><button>通訊資料</button><button>營業資料</button><button>附件</button><button>狀態</button></div><div class="card"><div style="font-size:16px;margin-bottom:8px">人員組織 /Things/Parties/${label}/</div><div id="pform"></div></div></section></div>`;
   const form=x=>{current=clone(x||blank(kind));document.querySelector("#pform").innerHTML=`<div class="formGrid">
    <label>編號*<input id="p_id" value="${esc(current.id)}"></label><label class="span2">名稱*<input id="p_name" value="${esc(current.name)}"></label><label>定價類別<select id="p_pricing"><option>${esc(current.pricing_type||"直銷")}</option><option>直銷</option><option>經銷</option><option>零售</option></select></label>
    <label class="span2">簡稱<input id="p_abbr" value="${esc(current.abbreviation)}"></label><label>統一編號<input id="p_tax" value="${esc(current.tax_id)}"></label><label>類別<input id="p_category" value="${esc(current.category)}"></label>
    <label class="span4">說明<textarea id="p_desc">${esc(current.description)}</textarea></label>
    <label>負責人<input id="p_resp" value="${esc(current.responsible_person)}"></label><label>負責經辦人<input id="p_agent" value="${esc(current.agent)}"></label><label>聯絡人<input id="p_contact" value="${esc(current.contact)}"></label><label>業務員<input id="p_sales" value="${esc(current.salesperson)}"></label>
    <label>電話<input id="p_phone" value="${esc(current.phone)}"></label><label>手機<input id="p_mobile" value="${esc(current.mobile)}"></label><label>E-mail<input id="p_email" value="${esc(current.email)}"></label><label>傳真<input id="p_fax" value="${esc(current.fax)}"></label>
    <label class="span2">地址<input id="p_address" value="${esc(current.address)}"></label><label>城市<input id="p_city" value="${esc(current.city)}"></label><label>郵遞區號<input id="p_zip" value="${esc(current.zip)}"></label>
    <label>付款條件<input id="p_payment" value="${esc(current.payment_terms)}"></label><label>送貨方式<input id="p_delivery" value="${esc(current.delivery)}"></label><label>幣別<input id="p_currency" value="${esc(current.currency||"TWD")}"></label><label>網站<input id="p_website" value="${esc(current.website)}"></label>
    <label class="span4">備註<textarea id="p_notes">${esc(current.notes)}</textarea></label></div>`};
   const read=()=>({...current,id:document.querySelector("#p_id").value.trim().toUpperCase(),name:document.querySelector("#p_name").value.trim(),pricing_type:document.querySelector("#p_pricing").value,abbreviation:document.querySelector("#p_abbr").value,tax_id:document.querySelector("#p_tax").value,category:document.querySelector("#p_category").value,description:document.querySelector("#p_desc").value,responsible_person:document.querySelector("#p_resp").value,agent:document.querySelector("#p_agent").value,contact:document.querySelector("#p_contact").value,salesperson:document.querySelector("#p_sales").value,phone:document.querySelector("#p_phone").value,mobile:document.querySelector("#p_mobile").value,email:document.querySelector("#p_email").value,fax:document.querySelector("#p_fax").value,address:document.querySelector("#p_address").value,city:document.querySelector("#p_city").value,zip:document.querySelector("#p_zip").value,payment_terms:document.querySelector("#p_payment").value,delivery:document.querySelector("#p_delivery").value,currency:document.querySelector("#p_currency").value,website:document.querySelector("#p_website").value,notes:document.querySelector("#p_notes").value});
   const list=q=>{q=(q||"").toLowerCase();document.querySelector("#plist").innerHTML=rows.filter(x=>!q||[x.id,x.name,x.tax_id].some(v=>String(v||"").toLowerCase().includes(q))).map(x=>`<button class="rowBtn" data-id="${esc(x.id)}"><b>${esc(x.id)}</b><span>${esc(x.name)}</span></button>`).join("");document.querySelectorAll("[data-id]").forEach(b=>b.onclick=()=>form(rows.find(x=>x.id===b.dataset.id)))};
   document.querySelector("#pq").oninput=e=>list(e.target.value);document.querySelector("#pNew").onclick=()=>form(blank(kind));document.querySelector("#pReload").onclick=()=>ctx.open(page);
   document.querySelector("#pSave").onclick=async()=>{const x=read();if(!x.id||!x.name)return alert("編號、名稱必填");await api("/api/party-save",{method:"POST",body:JSON.stringify({kind,row:x})});ctx.status(`${label} ${x.id} 已儲存`);ctx.open(page)};
   list("");form(rows[0]||blank(kind));
 }
};


// === modules/sales.js ===


const types={quotation:"報價單","sales-order":"銷售訂單",shipment:"出貨單","sales-return":"銷售退回"};
const prefix={quotation:"QT","sales-order":"SO",shipment:"SH","sales-return":"SR"};
const blankLine=(qty=0)=>({sku:"",customer_sku:"",name:"",qty,unit:"PCS",list_price:0,discount_factor:1,unit_price:0,delivery_date:""});
const blankDoc=t=>({id:"",type:t,doc_no:`${prefix[t]}-${today().replaceAll("-","")}-${String(Date.now()).slice(-5)}`,status:"draft",date:today(),valid_until:"",customer_id:"",customer_name:"",customer_po:"",currency:"TWD",exchange_rate:1,tax_rate:5,payment_terms:"",delivery:"",salesperson:"",source_doc_no:"",memo:"",lines:[blankLine(1),blankLine(),blankLine()]});
function factor(v){let n=Number(v);if(!Number.isFinite(n)||n===0)return 1;if(n>1)n=n/100;return Math.max(0,Math.min(1,n))}
const salesModule={
 title:"銷售",
 tree:[["party-customer","客戶總覽"],["quotation","報價單"],["sales-order","銷售訂單"],["shipment","出貨單"],["sales-return","銷售退回"],["price-history","客戶歷史價格"]],
 async render(page,ctx){
   if(page==="party-customer"){return ctx.modules.parties.render("party-customer",ctx)}
   if(page==="price-history"){const j=await api("/api/price-history");ctx.ws.innerHTML=`<div class="card"><h2>客戶歷史價格</h2><table class="gridTable"><tr><th>日期</th><th>客戶</th><th>SKU</th><th>客戶料號</th><th>牌價</th><th>成交/報價</th><th>來源</th></tr>${(j.rows||[]).map(x=>`<tr><td>${esc(x.date)}</td><td>${esc(x.customer_id)} ${esc(x.customer_name)}</td><td>${esc(x.sku)}</td><td>${esc(x.customer_sku)}</td><td>${money(x.list_price)}</td><td>${money(x.unit_price)}</td><td>${esc(x.source_doc_no)}</td></tr>`).join("")}</table></div>`;return}
   const t=page,label=types[t],items=(await api("/api/items")).rows||[],customers=(await api("/api/parties?kind=customer")).rows||[];
   let docs=(await api("/api/documents?type="+t)).rows||[],cur=docs[0]?clone(docs[0]):blankDoc(t);
   ctx.ws.innerHTML=`<div class="toolbar"><button id="dNew">新增</button><button id="dSave">儲存</button><button id="dDraft">暫存</button><button id="dEffective">生效</button><button id="dCopy">複製</button><button id="dDelete">刪除</button><button id="dPrint">列印</button></div><div class="layout2"><aside class="listPanel"><b>${label}總覽</b><input id="dq" class="listSearch" placeholder="搜尋單號 / 客戶"><div id="dlist"></div></aside><section><div class="tabs"><button class="active">內容</button><button>通訊資料</button><button>付款條件</button><button>註解</button><button>附件</button></div><div id="docForm"></div></section></div>`;
   const rowHtml=(l,i)=>`<tr data-line="${i}"><td><input data-k="sku" list="skuList" value="${esc(l.sku)}"></td><td><input data-k="customer_sku" value="${esc(l.customer_sku)}"></td><td><input data-k="name" value="${esc(l.name)}"></td><td><input data-k="qty" type="number" step="0.01" value="${Number(l.qty||0)}"></td><td><input data-k="unit" value="${esc(l.unit||"PCS")}"></td><td class="internalOnly"><input data-k="list_price" type="number" step="0.01" value="${Number(l.list_price||0)}"></td><td class="internalOnly"><input data-k="discount_factor" type="number" step="0.01" value="${Number(l.discount_factor??1)}"></td><td><input data-k="unit_price" type="number" step="0.01" value="${Number(l.unit_price||0)}"></td><td class="money">${money(Number(l.qty||0)*Number(l.unit_price||0))}</td><td><input data-k="delivery_date" type="date" value="${esc(l.delivery_date)}"></td><td class="noPrint"><button data-remove="${i}">✕</button></td></tr>`;
   const show=d=>{cur=clone(d);document.querySelector("#docForm").innerHTML=`<datalist id="skuList">${items.map(x=>`<option value="${esc(x.sku)}">${esc(x.name)}</option>`).join("")}</datalist><datalist id="custList">${customers.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")}</datalist><div class="formGrid">
     <label>客戶*<input id="d_customer_id" list="custList" value="${esc(cur.customer_id)}"></label><label>交易日*<input id="d_date" type="date" value="${esc(cur.date||today())}"></label><label>編號<input id="d_doc_no" value="${esc(cur.doc_no)}"></label><label>狀態<input value="${cur.status==="effective"?"已生效":"草稿"}" readonly></label>
     <label>客戶名稱<input id="d_customer_name" value="${esc(cur.customer_name)}"></label><label>客戶詢價單/PO<input id="d_customer_po" value="${esc(cur.customer_po)}"></label><label>有效日期<input id="d_valid" type="date" value="${esc(cur.valid_until)}"></label><label>幣別<select id="d_currency">${["TWD","USD","CNY","JPY","EUR"].map(x=>`<option ${cur.currency===x?"selected":""}>${x}</option>`).join("")}</select></label>
     <label>匯率<input id="d_rate" type="number" step="0.0001" value="${Number(cur.exchange_rate||1)}"></label><label>稅率 %<input id="d_tax" type="number" step="0.01" value="${Number(cur.tax_rate??5)}"></label><label>付款條件<input id="d_payment" value="${esc(cur.payment_terms)}"></label><label>送貨方式<input id="d_delivery" value="${esc(cur.delivery)}"></label>
     <label>業務員<input id="d_sales" value="${esc(cur.salesperson)}"></label>${t!=="quotation"?`<label>來源單號<input id="d_source" value="${esc(cur.source_doc_no)}"></label>`:""}</div>
     <div class="lineTools"><button id="addLine">＋ 新增明細</button><button id="historyBtn">客戶歷史價格</button>${t==="quotation"?'<button id="toOrder">轉銷售訂單</button>':""}${t==="sales-order"?'<button id="toShip">轉出貨單</button>':""}</div>
     <div class="docLinesWrap"><table class="docLines"><thead><tr><th>商品 / SKU</th><th>客戶料號</th><th>說明</th><th>數量</th><th>單位</th><th class="internalOnly">牌價</th><th class="internalOnly">折扣</th><th>單價</th><th>金額</th><th>交期</th><th class="noPrint"></th></tr></thead><tbody id="lineBody">${(cur.lines||[]).map(rowHtml).join("")}</tbody></table></div>
     <div class="card"><label>備註<textarea id="d_memo" style="width:100%;min-height:80px">${esc(cur.memo)}</textarea></label><div class="totals"><div><span>未稅</span><b id="subtotal">0</b></div><div><span>稅額</span><b id="taxamt">0</b></div><div><span>總計</span><b id="total">0</b></div></div></div>`;
     bind();calc();list();
   };
   const read=()=>{const d=clone(cur),v=id=>document.querySelector("#"+id)?.value||"";Object.assign(d,{customer_id:v("d_customer_id"),customer_name:v("d_customer_name"),date:v("d_date"),doc_no:v("d_doc_no"),customer_po:v("d_customer_po"),valid_until:v("d_valid"),currency:v("d_currency"),exchange_rate:Number(v("d_rate")||1),tax_rate:Number(v("d_tax")||0),payment_terms:v("d_payment"),delivery:v("d_delivery"),salesperson:v("d_sales"),source_doc_no:v("d_source"),memo:v("d_memo")});d.lines=[...document.querySelectorAll("#lineBody tr")].map(tr=>{const o={};tr.querySelectorAll("[data-k]").forEach(x=>o[x.dataset.k]=["qty","list_price","discount_factor","unit_price"].includes(x.dataset.k)?Number(x.value||0):x.value);return o});return d};
   const calc=()=>{let sub=0;document.querySelectorAll("#lineBody tr").forEach(tr=>{const q=Number(tr.querySelector('[data-k="qty"]')?.value||0),p=Number(tr.querySelector('[data-k="unit_price"]')?.value||0),a=q*p;sub+=a;tr.querySelector(".money").textContent=money(a)});const tx=sub*Number(document.querySelector("#d_tax")?.value||0)/100;document.querySelector("#subtotal").textContent=money(sub);document.querySelector("#taxamt").textContent=money(tx);document.querySelector("#total").textContent=money(sub+tx)};
   const bind=()=>{document.querySelector("#d_customer_id").onchange=()=>{const c=customers.find(x=>x.id===document.querySelector("#d_customer_id").value.trim().toUpperCase());if(c){document.querySelector("#d_customer_name").value=c.name||"";document.querySelector("#d_payment").value=c.payment_terms||"";document.querySelector("#d_delivery").value=c.delivery||"";document.querySelector("#d_currency").value=c.currency||"TWD";document.querySelector("#d_sales").value=c.salesperson||""}};
     document.querySelector("#addLine").onclick=()=>{const d=read();d.lines.push(blankLine());show(d)};
     document.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>{const d=read();d.lines.splice(Number(b.dataset.remove),1);show(d)});
     document.querySelectorAll("#lineBody input").forEach(x=>x.oninput=calc);
     document.querySelectorAll('[data-k="sku"]').forEach(inp=>inp.onchange=async()=>{const item=items.find(x=>x.sku===inp.value.trim().toUpperCase());if(!item)return;const tr=inp.closest("tr");tr.querySelector('[data-k="name"]').value=item.name||"";tr.querySelector('[data-k="unit"]').value=item.unit||"PCS";tr.querySelector('[data-k="list_price"]').value=Number(item.price||0);tr.querySelector('[data-k="unit_price"]').value=Number(item.price||0);const cid=document.querySelector("#d_customer_id").value.trim();if(cid){const h=await api(`/api/price-history?customer_id=${encodeURIComponent(cid)}&sku=${encodeURIComponent(item.sku)}`);if(h.rows?.length)tr.querySelector('[data-k="unit_price"]').value=Number(h.rows[0].unit_price||item.price||0)}calc()});
     document.querySelectorAll('[data-k="discount_factor"]').forEach(inp=>inp.onchange=()=>{const tr=inp.closest("tr"),lp=Number(tr.querySelector('[data-k="list_price"]').value||0),f=factor(inp.value);tr.querySelector('[data-k="unit_price"]').value=(lp*f).toFixed(2);calc()});
     document.querySelector("#historyBtn").onclick=async()=>{const cid=document.querySelector("#d_customer_id").value.trim();if(!cid)return alert("請先選客戶");const h=await api("/api/price-history?customer_id="+encodeURIComponent(cid));ctx.modal("客戶歷史價格｜"+cid,`<table class="gridTable"><tr><th>日期</th><th>SKU</th><th>客戶料號</th><th>牌價</th><th>成交/報價</th><th>來源</th></tr>${(h.rows||[]).slice(0,100).map(x=>`<tr><td>${esc(x.date)}</td><td>${esc(x.sku)}</td><td>${esc(x.customer_sku)}</td><td>${money(x.list_price)}</td><td>${money(x.unit_price)}</td><td>${esc(x.source_doc_no)}</td></tr>`).join("")}</table>`)};
     if(document.querySelector("#toOrder"))document.querySelector("#toOrder").onclick=()=>convert("sales-order");
     if(document.querySelector("#toShip"))document.querySelector("#toShip").onclick=()=>convert("shipment");
   };
   const list=()=>{const q=(document.querySelector("#dq")?.value||"").toLowerCase();document.querySelector("#dlist").innerHTML=docs.filter(d=>!q||[d.doc_no,d.customer_id,d.customer_name].some(v=>String(v||"").toLowerCase().includes(q))).map(d=>`<button class="rowBtn ${cur.id===d.id?"active":""}" data-doc="${esc(d.id)}"><b>${esc(d.doc_no)}</b><span>${esc(d.customer_id)} ${esc(d.customer_name)}</span><small>${esc(d.date)}｜${d.status==="effective"?"已生效":"草稿"}</small></button>`).join("");document.querySelectorAll("[data-doc]").forEach(b=>b.onclick=()=>show(docs.find(x=>x.id===b.dataset.doc)))};
   const save=async status=>{const d=read();if(!d.customer_id&&!d.customer_name)return alert("請先選客戶");if(!d.lines.some(x=>x.sku))return alert("至少需要一筆商品 SKU");d.status=status;const j=await api("/api/document-save",{method:"POST",body:JSON.stringify({type:t,doc:d})});cur=j.doc;docs=(await api("/api/documents?type="+t)).rows||[];show(cur);ctx.status(`${cur.doc_no} ${status==="effective"?"已生效":"已儲存"}`)};
   const convert=async target=>{const d=read(),n={...d,id:"",type:target,doc_no:`${prefix[target]}-${today().replaceAll("-","")}-${String(Date.now()).slice(-5)}`,status:"draft",source_doc_no:d.doc_no,date:today()};ctx.open(target,n)};
   document.querySelector("#dq").oninput=list;document.querySelector("#dNew").onclick=()=>show(blankDoc(t));document.querySelector("#dSave").onclick=()=>save("draft");document.querySelector("#dDraft").onclick=()=>save("draft");document.querySelector("#dEffective").onclick=()=>save("effective");document.querySelector("#dCopy").onclick=()=>{const d=read();d.id="";d.doc_no=`${prefix[t]}-${today().replaceAll("-","")}-${String(Date.now()).slice(-5)}`;d.status="draft";show(d)};document.querySelector("#dDelete").onclick=async()=>{if(!cur.id)return;if(confirm("刪除 "+cur.doc_no+"？")){await api("/api/document-delete",{method:"POST",body:JSON.stringify({type:t,id:cur.id})});ctx.open(t)}};document.querySelector("#dPrint").onclick=()=>window.print();
   show(ctx.payload||cur);
 }
};


// === modules/generic.js ===


const genericModules={
 purchase:{title:"採購",tree:[["purchase-order","採購單"],["purchase-receipt","進貨單"],["purchase-return","採購退回"]]},
 ar:{title:"應收",tree:[["ar-ledger","應收帳款"],["ar-receipt","收款單"]]},
 ap:{title:"應付",tree:[["ap-ledger","應付帳款"],["ap-payment","付款單"]]},
 bank:{title:"銀行",tree:[["bank-account","銀行帳戶"],["bank-trans","銀行交易"]]},
 finance:{title:"財務",tree:[["journal","傳票"],["gl","總帳"]]},
 cost:{title:"成本",tree:[["cost-summary","成本總覽"],["cost-adjust","成本調整"]]},
 invoice:{title:"發票",tree:[["invoice-list","發票總覽"],["invoice-create","開立發票"]]},
 export:{title:"出口",tree:[["export-docs","出口文件"]]},
 import:{title:"進口",tree:[["import-docs","進口文件"]]},
 matters:{title:"事項",tree:[["tasks","事項總覽"]]}
};
async function renderGeneric(module,page,ctx){
  ctx.ws.innerHTML=`<div class="card"><h2>${esc(module.title)} / ${esc(module.tree.find(x=>x[0]===page)?.[1]||page)}</h2><p>此模組已納入 V2.0 RunEC 結構，使用獨立模組檔；資料表單不再塞進單一 app.js。</p><p class="muted">銷售、商品、人員組織為本次完整 Cloud Core；其他 RunEC 模組已建立獨立入口，後續擴充不會再改壞核心。</p></div>`;
}


// === core/app.js ===






const modules={
 system:{title:"系統",tree:[["party-company","公司總覽"],["party-customer","客戶總覽"],["party-vendor","廠商總覽"],["party-employee","員工總覽"]]},
 sales:{title:"銷售",tree:salesModule.tree},
 purchase:genericModules.purchase,
 inventory:{title:"存貨",tree:itemsModule.tree},
 ar:genericModules.ar,ap:genericModules.ap,bank:genericModules.bank,finance:genericModules.finance,cost:genericModules.cost,invoice:genericModules.invoice,export:genericModules.export,import:genericModules.import,matters:genericModules.matters
};
const state={module:"system",page:"party-customer",payload:null};
const ws=document.querySelector("#workspace"),tree=document.querySelector("#sideTree"),bread=document.querySelector("#breadcrumb"),statusEl=document.querySelector("#status");
statusEl.textContent="V2.1 前端已啟動，正在檢查 Cloud ERP API…";
const ctx={ws,modules:{parties:partiesModule,items:itemsModule,sales:salesModule},status:t=>statusEl.textContent=t,modal:(title,html)=>{document.querySelector("#modalTitle").textContent=title;document.querySelector("#modalBody").innerHTML=html;document.querySelector("#modal").classList.remove("hidden")},open:(page,payload=null)=>open(page,payload)};
document.querySelector("#modalClose").onclick=()=>document.querySelector("#modal").classList.add("hidden");

function top(){
  document.querySelector("#topModules").innerHTML=Object.entries(modules).map(([k,m])=>`<button data-module="${k}" class="${state.module===k?"active":""}">${m.title}</button>`).join("");
  document.querySelectorAll("[data-module]").forEach(b=>b.onclick=()=>{state.module=b.dataset.module;state.page=modules[state.module].tree[0][0];state.payload=null;render()});
}
function side(){
  const m=modules[state.module];tree.innerHTML=`<div class="treeTitle">🔧 ${m.title}管理</div><div class="treeGroup">${m.tree.map(([p,n])=>`<button class="treeItem ${state.page===p?"active":""}" data-page="${p}">✦ ${n}</button>`).join("")}</div>`;
  document.querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>open(b.dataset.page));
}
async function open(page,payload=null){state.page=page;state.payload=payload;await render()}
async function render(){
  top();side();const m=modules[state.module],name=m.tree.find(x=>x[0]===state.page)?.[1]||state.page;bread.textContent=`${m.title} / ${name}`;ws.innerHTML='<div class="card">讀取中…</div>';
  try{
    if(state.page.startsWith("party-"))await partiesModule.render(state.page,ctx);
    else if(["items","inventory"].includes(state.page))await itemsModule.render(state.page,ctx);
    else if(["quotation","sales-order","shipment","sales-return","price-history"].includes(state.page))await salesModule.render(state.page,ctx);
    else await renderGeneric(m,state.page,ctx);
  }catch(e){ws.innerHTML=`<div class="card danger"><b>讀取失敗：</b>${e.message}<br><small>API：${CONFIG.API}</small></div>`;statusEl.textContent="錯誤："+e.message}
  state.payload=null;
}
document.querySelector("#refreshBtn").onclick=render;
document.querySelector("#homeBtn").onclick=()=>{state.module="system";state.page="party-customer";render()};
document.querySelector("#backBtn").onclick=()=>history.back();
render();
(async()=>{try{const h=await api("/health");statusEl.textContent=`Cloud ERP API 已連線｜${h.version||""}`}catch(e){statusEl.textContent="Cloud ERP API 尚未連線："+e.message}})();
