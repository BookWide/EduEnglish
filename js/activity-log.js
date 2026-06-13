(function () {
  function getGuestId() {
    var id = localStorage.getItem("bw_guest_id");
    if (!id) {
      id = "guest_" + Date.now() + "_" + Math.random().toString(36).slice(2);
      localStorage.setItem("bw_guest_id", id);
    }
    return id;
  }

  function getUserId() {
    try {
      return localStorage.getItem("bw_user_id") || localStorage.getItem("user_id") || null;
    } catch (e) {
      return null;
    }
  }

  window.bwTrack = async function (eventName, detail) {
    try {
      if (!eventName) return;
      detail = detail || {};
      var payload = {
        event_name: eventName,
        page: location.pathname,
        user_id: getUserId(),
        guest_id: getGuestId(),
        detail: detail,
        created_at: new Date().toISOString()
      };

      // 防止同一頁重整狂洗 enter：30 秒內同事件只送一次
      var dedupeKey = "bw_track_" + eventName + "_" + location.pathname;
      var last = Number(sessionStorage.getItem(dedupeKey) || 0);
      if (Date.now() - last < 30000 && /_enter$/.test(eventName)) return;
      sessionStorage.setItem(dedupeKey, String(Date.now()));

      await fetch("/api/activity-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true
      });
    } catch (e) {
      console.warn("BookWide activity log failed", e);
    }
  };
})();
