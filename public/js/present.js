"use strict";
(async function () {
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const key = params.get("key");
  const panel = document.getElementById("panel");

  if (!id) {
    panel.innerHTML = '<div class="msg">No itinerary specified.</div>';
    return;
  }
  let url = "/api/trips/" + encodeURIComponent(id);
  if (key) url += "?key=" + encodeURIComponent(key);

  try {
    const res = await fetch(url);
    if (res.status === 401)
      throw new Error("This itinerary is private. A valid link with a read key is required.");
    if (!res.ok) throw new Error("Itinerary not found.");
    const trip = await res.json();
    GRMap.mount(trip, { mode: "present" });
  } catch (e) {
    panel.innerHTML = `<div class="msg">${e.message}</div>`;
  }
})();
