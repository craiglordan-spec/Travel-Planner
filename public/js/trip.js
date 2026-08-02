"use strict";
(async function () {
  const id = decodeURIComponent(location.pathname.split("/").pop());
  let trip = null;
  let mapApi = null;
  let mapDirty = false; // route changed while map tab hidden → rebuild on next view

  try {
    const res = await fetch("/api/trips/" + id);
    if (!res.ok) throw new Error("Trip not found");
    trip = await res.json();
  } catch (e) {
    document.getElementById("panel").innerHTML =
      `<div class="msg">${e.message}. <a href="/">Back to trips</a></div>`;
    return;
  }

  // ensure collections exist
  trip.flights = trip.flights || [];
  trip.accommodation = trip.accommodation || [];
  trip.activities = trip.activities || [];

  mapApi = GRMap.mount(trip, { mode: "edit" });

  const opts = { onChange: saveTrip, onFocusStop: focusStop };
  const stopsOpts = { onChange: saveAndRemount, onFocusStop: focusStop, reorder: true };
  const legsOpts = { onChange: saveAndRemount, onFocusStop: focusStop };

  function renderAll() {
    GRCalendar.render(trip, opts);
    GRForms.renderList("flights", trip, opts);
    GRForms.renderList("accommodation", trip, opts);
    GRForms.renderList("activities", trip, opts);
    GRForms.renderList("stops", trip, stopsOpts);
    GRForms.renderList("legs", trip, legsOpts);
  }
  renderAll();

  async function persist() {
    const res = await fetch("/api/trips/" + id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(trip),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Save failed");
  }

  async function saveTrip(updated) {
    trip = updated;
    try {
      await persist();
      renderAll();
    } catch (e) {
      alert("Could not save: " + e.message);
    }
  }

  // used after stop/leg changes: mark the map for rebuild when its tab is shown
  // (rebuilding while the map container is hidden gives Leaflet a zero-size
  // container and throws "Invalid LatLng" errors)
  async function saveAndRemount(updated) {
    trip = updated;
    try {
      await persist();
      mapDirty = true;
      const mapVisible = document.getElementById("tab-map").classList.contains("active");
      if (mapVisible) {
        remountMap();
        mapDirty = false;
      }
      renderAll();
    } catch (e) {
      alert("Could not save: " + e.message);
    }
  }

  function remountMap() {
    try {
      if (mapApi && mapApi.map) mapApi.map.remove();
    } catch (e) {}
    mapApi = GRMap.mount(trip, { mode: "edit" });
  }

  function focusStop(stopId) {
    const idx = (trip.stops || []).findIndex((s) => s.id === stopId);
    if (idx < 0) return;
    showTab("map");
    setTimeout(() => mapApi && mapApi.focusStop(idx), 120);
  }

  // ---- tabs ----
  function showTab(name) {
    document
      .querySelectorAll(".subnav button")
      .forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tabview").forEach((v) => v.classList.remove("active"));
    document.getElementById("tab-" + name).classList.add("active");
    if (name === "map") {
      if (mapDirty) {
        remountMap();
        mapDirty = false;
      } else if (mapApi) {
        setTimeout(() => mapApi.map.invalidateSize(), 60);
      }
    }
  }
  document
    .querySelectorAll(".subnav button")
    .forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

  // ---- add buttons ----
  document.querySelectorAll("[data-add]").forEach((b) =>
    b.addEventListener("click", () => {
      const k = b.getAttribute("data-add");
      const o = k === "stops" ? stopsOpts : k === "legs" ? legsOpts : opts;
      GRForms.openEditor(k, trip, null, o);
    })
  );

  // ---- present link ----
  document.getElementById("present").addEventListener("click", () => {
    const url = location.origin + "/present?id=" + encodeURIComponent(id);
    const msg =
      url +
      "\n\n(If a read key is set on the server, append &key=YOUR_READ_KEY to share without the password.)";
    if (navigator.clipboard)
      navigator.clipboard.writeText(url).then(
        () => alert("Present link copied:\n" + msg),
        () => prompt("Present link:", url)
      );
    else prompt("Present link:", url);
  });

  // ---- raw JSON editor (stops/legs/meta) ----
  const jm = document.getElementById("jsonModal");
  const jmText = document.getElementById("jmText");
  const jmErr = document.getElementById("jmErr");
  document.getElementById("editJson").addEventListener("click", () => {
    jmText.value = JSON.stringify(trip, null, 2);
    jmErr.textContent = "";
    jm.classList.add("open");
  });
  document.getElementById("jmClose").addEventListener("click", () => jm.classList.remove("open"));
  document.getElementById("jmSave").addEventListener("click", async () => {
    let parsed;
    try {
      parsed = JSON.parse(jmText.value);
    } catch (e) {
      jmErr.textContent = "Invalid JSON: " + e.message;
      return;
    }
    await saveTrip(parsed);
    location.reload(); // stops/legs may have changed → re-mount the map
  });
})();
