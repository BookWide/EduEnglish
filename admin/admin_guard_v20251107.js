// admin_guard_v20251107.js
(function(){
  function log(){ /* console.debug('[admin-guard]', ...arguments); */ }
  function findAdminNode() {
    // Prefer element with id="itm-admin"
    var byId = document.getElementById("itm-admin");
    if (byId) return byId;

    // Otherwise, look for a menu item containing "Admin 主控台" (or "Admin")
    var anchors = Array.from(document.querySelectorAll("a"));
    for (var a of anchors) {
      var txt = (a.textContent || "").trim();
      if (txt.includes("Admin 主控台") || (/^Admin$/i).test(txt) || txt.includes("Admin")) {
        // return the <li> if exists, otherwise the <a>
        return a.closest("li") || a;
      }
    }
    return null;
  }

  function hide(node){
    if (!node) return;
    // remember previous style to allow restore
    if (!node.__admin_guard_prev) node.__admin_guard_prev = node.style.display || "";
    node.style.display = "none";
  }
  function show(node){
    if (!node) return;
    node.style.display = node.__admin_guard_prev || "";
  }

  async function check(){
    try{
      var node = findAdminNode();
      if (!node) return; // nothing to manage

      // Hide by default
      hide(node);

      // Get supabase client (support either global supa or supabase)
      var client = (window.supa || window.supabase || null);
      if (!client || !client.auth || !client.from) {
        log('no supabase client -> keep hidden');
        return;
      }

      // get current user
      var auth = client.auth;
      var userRes = await auth.getUser();
      var user = (userRes && (userRes.user || userRes.data && userRes.data.user)) ? (userRes.user || userRes.data.user) : null;
      if (!user) {
        log('no user -> keep hidden');
        return;
      }

      // query profiles.is_admin
      var q = client.from("profiles").select("is_admin").eq("id", user.id);
      // try maybeSingle/single compatibility
      var rowRes;
      if (typeof q.maybeSingle === "function") {
        rowRes = await q.maybeSingle();
      } else if (typeof q.single === "function") {
        rowRes = await q.single();
      } else {
        // fallback: take first
        var tmp = await q.limit(1);
        rowRes = { data: (tmp && tmp.data && tmp.data[0]) || null, error: tmp && tmp.error };
      }

      var row = (rowRes && (rowRes.data || rowRes.user)) ? rowRes.data : null;
      if (row && (row.is_admin === true || row.is_admin === 'true' || row.is_admin === 1)) {
        show(node);
      } else {
        hide(node);
      }
    } catch(e){
      // keep hidden on any error
      // console.warn('[admin-guard] error', e);
    }
  }

  // run after DOM ready
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', check);
  } else {
    check();
  }
})();