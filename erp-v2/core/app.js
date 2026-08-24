
import {api,CONFIG} from "./api.js";
import {itemsModule} from "../modules/items.js";
import {partiesModule} from "../modules/parties.js";
import {salesModule} from "../modules/sales.js";
import {genericModules,renderGeneric} from "../modules/generic.js";

const modules={
 system:{title:"系統",tree:[["party-company","公司總覽"],["party-customer","客戶總覽"],["party-vendor","廠商總覽"],["party-employee","員工總覽"]]},
 sales:{title:"銷售",tree:salesModule.tree},
 purchase:genericModules.purchase,
 inventory:{title:"存貨",tree:itemsModule.tree},
 ar:genericModules.ar,ap:genericModules.ap,bank:genericModules.bank,finance:genericModules.finance,cost:genericModules.cost,invoice:genericModules.invoice,export:genericModules.export,import:genericModules.import,matters:genericModules.matters
};
const state={module:"system",page:"party-customer",payload:null};
const ws=document.querySelector("#workspace"),tree=document.querySelector("#sideTree"),bread=document.querySelector("#breadcrumb"),statusEl=document.querySelector("#status");
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
(async()=>{try{const h=await api("/health");statusEl.textContent=`Cloud ERP API 已連線｜${h.version||""}`}catch(e){statusEl.textContent="Cloud ERP API 尚未連線："+e.message}render()})();
