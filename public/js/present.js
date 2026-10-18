"use strict";
GRAuth.ready(async function () {
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const panel = document.getElementById("panel");

  if (!id) {
    panel.innerHTML = '<div class="msg">No itinerary specified.</div>';
    return;
  }

  try {
    const res = await GRAuth.apiFetch("/api/trips/" + encodeURIComponent(id));
    if (!res.ok) throw new Error("Itinerary not found.");
    const trip = await res.json();
    try { await GRRoute.ensureRoutes(trip, false); } catch (e) {} // in-memory only
    GRMap.mount(trip, { mode: "present" });
  } catch (e) {
    panel.innerHTML = `<div class="msg">${e.message}</div>`;
  }
});
