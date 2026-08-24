
export const CONFIG={
  API: localStorage.getItem("bw_erp_v2_api") || "https://bookwide-erp-api.pmktools.workers.dev"
};
export async function api(path,opt={}){
  const headers={"Content-Type":"application/json",...(opt.headers||{})};
  const token=localStorage.getItem("bw_erp_v2_write_token");
  if(token)headers["X-ERP-Write-Token"]=token;
  const r=await fetch(CONFIG.API+path,{cache:"no-store",...opt,headers});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.ok===false)throw new Error(j.message||j.error||`HTTP ${r.status}`);
  return j;
}
export const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
export const money=v=>Number(v||0).toLocaleString("zh-TW",{maximumFractionDigits:2});
export const today=()=>new Date().toISOString().slice(0,10);
export const clone=v=>JSON.parse(JSON.stringify(v));
