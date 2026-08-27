(function(){
  async function inject(url,targetId){
    const box=document.getElementById(targetId);
    if(!box)return;
    try{
      const r=await fetch(url,{cache:'no-store'});
      if(!r.ok)throw new Error('HTTP '+r.status);
      const html=await r.text();
      box.innerHTML=html;

      // Execute scripts from the shared partial after insertion.
      box.querySelectorAll('script').forEach(old=>{
        const s=document.createElement('script');
        for(const a of old.attributes)s.setAttribute(a.name,a.value);
        s.textContent=old.textContent;
        old.replaceWith(s);
      });
    }catch(e){
      console.error('[PMK shared layout]',url,e);
      box.innerHTML='<div style="padding:12px;color:#b91c1c">共用版面載入失敗</div>';
    }
  }

  Promise.all([
    inject('/pmktools-header.html','pmkSharedHeader'),
    inject('/pmktools-footer.html','pmkSharedFooter')
  ]);
})();