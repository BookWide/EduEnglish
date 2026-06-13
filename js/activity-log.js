(function () {
  function getGuestId() {
    let id = localStorage.getItem("bw_guest_id");
    if (!id) {
      id = "guest_" + Date.now() + "_" + Math.random().toString(36).slice(2);
      localStorage.setItem("bw_guest_id", id);
    }
    return id;
  }

  window.bwTrack = async function (eventName, detail = {}) {
    try {
      const payload = {
        event_name: eventName,
        page: location.pathname,
        guest_id: getGuestId(),
        detail: detail
      };

      await fetch("/api/activity-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.warn("activity log failed", e);
    }
  };
})();