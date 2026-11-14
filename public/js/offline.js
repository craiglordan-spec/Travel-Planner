"use strict";
/**
 * GROffline — offline viewing support (load first, before auth.js).
 *
 *  - registers the service worker (/sw.js) that keeps the app, trips,
 *    attachments and viewed map tiles on the device
 *  - shows a banner and switches pages to view-only while there's no signal
 *  - sync: after a trip list / trip loads online, quietly fetches every trip and
 *    its attachments so they're all on the phone for later
 *  - saveMap: downloads the map background for a trip's area
 */
window.GROffline = (function () {
  const SYNC_KEY = "gr_tp_lastsync";
  let cachedAt = null; // Date header of the saved copy currently shown, if any

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }

  const isOnline = () => navigator.onLine !== false && !cachedAt;

  // ---- banner + view-only mode ----
  function fmt(d) {
    try {
      return d.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    } catch (e) { return ""; }
  }
  function render() {
    const off = navigator.onLine === false || !!cachedAt;
    document.body && document.body.classList.toggle("is-offline", off);
    let b = document.getElementById("gr-offline");
    if (!off) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement("div");
      b.id = "gr-offline";
      b.className = "gr-offline";
      document.body.prepend(b);
    }
    const when = cachedAt && !isNaN(cachedAt) ? " from " + fmt(cachedAt) : "";
    b.textContent = `📴 Offline · saved copy${when} · view only`;
  }
  function noteResponse(res) {
    if (!res) { cachedAt = cachedAt || new Date(NaN); render(); return; } // no connection at all
    const h = res && res.headers && res.headers.get("X-From-Cache");
    if (h) {
      const d = new Date(h);
      if (!cachedAt || d < cachedAt) cachedAt = d;
    }
    render();
  }
  window.addEventListener("online", () => {
    // back online: reload to swap the saved copy for the live one (unless mid-edit)
    if (cachedAt && !document.querySelector(".modal.open")) location.reload();
    else render();
  });
  window.addEventListener("offline", render);
  document.addEventListener("DOMContentLoaded", render);

  // ---- background sync of trips + attachments ----
  function filesOf(trip) {
    const ids = [];
    Object.keys(trip || {}).forEach((k) => {
      const arr = trip[k];
      if (!Array.isArray(arr)) return;
      arr.forEach((it) => (it && Array.isArray(it.files) ? it.files : []).forEach((f) => f && f.id && ids.push(f.id)));
    });
    return ids;
  }
  async function pool(items, n, fn) {
    let i = 0;
    const run = async () => { while (i < items.length) { const x = items[i++]; try { await fn(x); } catch (e) {} } };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
  }
  async function syncTrip(trip) {
    if (!isOnline() || !trip || !trip.id || !window.GRAuth) return;
    const base = "/api/trips/" + encodeURIComponent(trip.id) + "/files/";
    // the service worker keeps each file it sees (cache-first, so already-saved files cost nothing)
    await pool(filesOf(trip), 3, (fid) => GRAuth.apiFetch(base + encodeURIComponent(fid)).then((r) => r.blob()));
  }
  async function syncAll(tripList) {
    if (!isOnline() || !window.GRAuth) return;
    const last = +localStorage.getItem(SYNC_KEY) || 0;
    if (Date.now() - last < 10 * 60 * 1000) return; // at most every 10 minutes
    localStorage.setItem(SYNC_KEY, String(Date.now()));
    await pool(tripList || [], 2, async (t) => {
      const r = await GRAuth.apiFetch("/api/trips/" + encodeURIComponent(t.id));
      if (r.ok) await syncTrip(await r.json());
    });
  }

  // ---- save map background for a trip's area ----
  function lon2x(lng, z) { return Math.floor(((lng + 180) / 360) * 2 ** z); }
  function lat2y(lat, z) {
    const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
  }
  function rangeTiles(set, z, s, w, n, e) {
    const x0 = lon2x(w, z), x1 = lon2x(e, z), y0 = lat2y(n, z), y1 = lat2y(s, z);
    const max = 2 ** z - 1;
    for (let x = Math.max(0, x0); x <= Math.min(max, x1); x++)
      for (let y = Math.max(0, y0); y <= Math.min(max, y1); y++) set.add(z + "/" + x + "/" + y);
  }
  // Whole-trip overview at low zooms, plus close-up detail around every stop.
  function tilesFor(trip) {
    const pts = (trip.stops || []).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
    (trip.legs || []).forEach((l) => (l.via || []).forEach((v) => Number.isFinite(v.lat) && pts.push(v)));
    if (!pts.length) return [];
    const set = new Set();
    const s = Math.min(...pts.map((p) => p.lat)), n = Math.max(...pts.map((p) => p.lat));
    const w = Math.min(...pts.map((p) => p.lng)), e = Math.max(...pts.map((p) => p.lng));
    // overview: deepest zoom that keeps the whole-area set under ~500 images
    for (let z = 2; z <= 10; z++) {
      const count = (lon2x(e + 1, z) - lon2x(w - 1, z) + 1) * (lat2y(s - 1, z) - lat2y(n + 1, z) + 1);
      if (z > 3 && set.size + count > 500) break;
      rangeTiles(set, z, s - 1, w - 1, n + 1, e + 1);
    }
    pts.forEach((p) => {
      for (let z = 8; z <= 13; z++) {
        const km = z >= 12 ? 4 : 12; // detail: ~8 km box at street zooms, ~24 km around town
        const dLat = km / 111, dLng = km / (111 * Math.cos((p.lat * Math.PI) / 180));
        rangeTiles(set, z, p.lat - dLat, p.lng - dLng, p.lat + dLat, p.lng + dLng);
      }
    });
    return [...set];
  }
  // templates: the map's visible tile layers (Leaflet TileLayer objects)
  async function saveMap(trip, layers, onProgress) {
    const keys = tilesFor(trip);
    const retina = window.L && L.Browser && L.Browser.retina ? "@2x" : "";
    const urls = [];
    layers.forEach((layer) => {
      const tpl = layer._url;
      if (!tpl) return;
      const subs = layer.options.subdomains || "abc";
      keys.forEach((k, i) => {
        const [z, x, y] = k.split("/").map(Number);
        urls.push(L.Util.template(tpl, { z, x, y, r: retina, s: subs[i % subs.length] }));
      });
    });
    let done = 0, failed = 0;
    onProgress && onProgress(0, urls.length, 0);
    await pool(urls, 6, async (u) => {
      try {
        const r = await fetch(u, { mode: "cors", credentials: "omit" });
        if (!r.ok) failed++;
      } catch (e) { failed++; }
      done++;
      if (onProgress && (done % 10 === 0 || done === urls.length)) onProgress(done, urls.length, failed);
    });
    return { total: urls.length, failed };
  }
  // Wire a "Save map offline" button. getTrip/getMapApi return the current trip and map.
  function bindSaveMap(btn, getTrip, getMapApi) {
    if (!btn) return;
    if (!("serviceWorker" in navigator)) { btn.style.display = "none"; return; }
    let busy = false;
    btn.addEventListener("click", async () => {
      if (busy) return;
      if (!isOnline()) { alert("You're offline — connect to Wi-Fi to save the map."); return; }
      const api = getMapApi();
      if (!api || !api.map) return;
      const layers = [];
      api.map.eachLayer((l) => l instanceof L.TileLayer && layers.push(l));
      const n = tilesFor(getTrip()).length * layers.length;
      if (!n) { alert("Add stops with coordinates first."); return; }
      const mb = Math.max(1, Math.round((n * 25) / 1024));
      if (!confirm(`Save the current map background for this trip's area so it shows offline?\n\nAbout ${n} map images (~${mb} MB). Best done on Wi-Fi. Only the background you're viewing now is saved — switch background first if you want a different one.`)) return;
      busy = true;
      const label = btn.textContent;
      const res = await saveMap(getTrip(), layers, (d, t) => (btn.textContent = `Saving map… ${Math.round((d / t) * 100)}%`));
      busy = false;
      btn.textContent = label;
      alert(res.failed ? `Map saved, but ${res.failed} of ${res.total} images couldn't be downloaded (try again on a better connection).` : "Map saved for offline use ✓");
    });
  }

  async function clearData() {
    try {
      if (window.caches) await Promise.all(["gr-data", "gr-tiles"].map((k) => caches.delete(k)));
    } catch (e) {}
    localStorage.removeItem(SYNC_KEY);
  }

  return { noteResponse, isOnline, syncTrip, syncAll, saveMap, bindSaveMap, clearData, tilesFor, render };
})();
