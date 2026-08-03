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
    GRGantt.render(trip, opts);
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

  // ---- trip settings + date flow-through ----
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function isoShift(iso, days) {
    if (!iso) return iso;
    const p = iso.split("-").map(Number);
    const ms = Date.UTC(p[0], p[1] - 1, p[2]) + days * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  function isoDelta(a, b) {
    const pa = a.split("-").map(Number),
      pb = b.split("-").map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }
  function countDated() {
    let n = 0;
    (trip.flights || []).forEach((f) => f.date && n++);
    (trip.accommodation || []).forEach((a) => (a.checkIn || a.checkOut) && n++);
    (trip.activities || []).forEach((a) => a.date && n++);
    return n;
  }
  function shiftAllDates(days) {
    (trip.flights || []).forEach((f) => { if (f.date) f.date = isoShift(f.date, days); });
    (trip.accommodation || []).forEach((a) => {
      if (a.checkIn) a.checkIn = isoShift(a.checkIn, days);
      if (a.checkOut) a.checkOut = isoShift(a.checkOut, days);
    });
    (trip.activities || []).forEach((a) => { if (a.date) a.date = isoShift(a.date, days); });
  }

  const sm = document.getElementById("settingsModal");
  document.getElementById("settings").addEventListener("click", () => {
    document.getElementById("st-title").value = trip.title || "";
    document.getElementById("st-subtitle").value = trip.subtitle || "";
    document.getElementById("st-startDate").value = trip.startDate || "";
    document.getElementById("st-when").value = trip.when || "";
    document.getElementById("st-travellers").value = trip.travellers || "";
    document.getElementById("st-budget").value = trip.budget || "";
    const n = countDated();
    document.getElementById("st-note").textContent = n
      ? `Tip: changing the start date will offer to shift all ${n} dated items (flights, stays, activities) by the same number of days, so the whole schedule moves together.`
      : "";
    sm.classList.add("open");
  });
  document.getElementById("stClose").addEventListener("click", () => sm.classList.remove("open"));
  document.getElementById("stSave").addEventListener("click", async () => {
    const newStart = document.getElementById("st-startDate").value || "";
    const oldStart = trip.startDate || "";
    trip.title = document.getElementById("st-title").value.trim() || trip.title;
    trip.subtitle = document.getElementById("st-subtitle").value.trim();
    trip.when = document.getElementById("st-when").value.trim();
    trip.travellers = document.getElementById("st-travellers").value.trim();
    trip.budget = document.getElementById("st-budget").value.trim();

    if (newStart && oldStart && newStart !== oldStart) {
      const d = isoDelta(oldStart, newStart);
      const n = countDated();
      if (n > 0 && d !== 0 &&
        confirm(`Move the start to ${newStart}?\n\nShift all ${n} dated items by ${d > 0 ? "+" : ""}${d} day${Math.abs(d) === 1 ? "" : "s"} so the schedule keeps the same relative days.\n\nOK = shift everything · Cancel = change the start only.`)) {
        shiftAllDates(d);
      }
    }
    trip.startDate = newStart;
    sm.classList.remove("open");
    try {
      await persist();
      const hdr = document.querySelector("#panel header");
      if (hdr)
        hdr.innerHTML =
          `<h1>${escapeHtml(trip.title || "")}</h1>` +
          (trip.subtitle ? `<div class="sub">${escapeHtml(trip.subtitle)}</div>` : "");
      renderAll();
    } catch (e) {
      alert("Could not save: " + e.message);
    }
  });

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
