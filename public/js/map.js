"use strict";
/**
 * Shared map renderer. Given a trip object, builds the itinerary panel and an
 * interactive Leaflet map (satellite / terrain / light, curved flight arcs,
 * transfer lines, approximate park outlines, numbered stops, play-route).
 * Used by both the editor view (trip.js) and the client present view (present.js).
 */
window.GRMap = (function () {
  const COLORS = {
    safari: "#5a7d4f",
    beach: "#7b4b74",
    city: "#c4622d",
    gateway: "#3d7ea6",
    attraction: "#17877d", // activities / attractions
    transit: "#59708a", // stopover / via point on a flight leg
  };
  const colorFor = (t) => COLORS[t] || COLORS.gateway;

  // Build the numbered itinerary sequence by following the legs: each stop,
  // then the via (stopover) points of the leg leaving it, then the next stop.
  // This is the list that gets numbered 1..N and drawn as pins, so a Brisbane →
  // (via) Sydney → Johannesburg leg numbers 1‑2‑3.
  function orderedPoints(trip, legs) {
    const stops = trip.stops || [];
    legs = legs || trip.legs || [];
    const byId = {};
    stops.forEach((s) => (byId[s.id] = s));
    const stopPt = (s) => ({
      kind: "stop", id: s.id, name: s.name, lat: s.lat, lng: s.lng, type: s.type,
      nights: s.nights, highlights: s.highlights, lodge: s.lodge,
    });
    const out = [];
    const seen = new Set();
    let last = null, lastPt = null;
    // Follow the legs in order (From → stopovers → To), so a stop visited twice
    // (e.g. Johannesburg out and back) appears at each visit with the right
    // stopovers after it. Stops not on any leg are listed after, in stop order.
    legs.forEach((l) => {
      const a = byId[l.from], b = byId[l.to];
      if (!a || !b) return;
      let fromPt = lastPt;
      if (last !== a.id) { fromPt = stopPt(a); out.push(fromPt); seen.add(a.id); }
      fromPt.nextLeg = l; // how you travel on from this point (list hint)
      (l.via || []).forEach((v) =>
        out.push({ kind: "via", name: v.name, lat: v.lat, lng: v.lng, type: "transit", legLabel: l.label })
      );
      lastPt = stopPt(b);
      out.push(lastPt); seen.add(b.id);
      last = b.id;
    });
    stops.forEach((s) => { if (!seen.has(s.id)) out.push(stopPt(s)); });
    return out;
  }

  // quadratic-bezier arc between two [lat,lng] points, bowed perpendicular
  function arc(from, to, bend) {
    const pts = [];
    const dlat = to[0] - from[0],
      dlng = to[1] - from[1];
    const mlat = (from[0] + to[0]) / 2,
      mlng = (from[1] + to[1]) / 2;
    const clat = mlat + dlng * bend,
      clng = mlng + -dlat * bend;
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const lat =
        (1 - t) * (1 - t) * from[0] + 2 * (1 - t) * t * clat + t * t * to[0];
      const lng =
        (1 - t) * (1 - t) * from[1] + 2 * (1 - t) * t * clng + t * t * to[1];
      pts.push([lat, lng]);
    }
    return pts;
  }

  function mount(trip, opts) {
    opts = opts || {};
    const panel = document.getElementById("panel");
    const mapEl = document.getElementById("map");
    const byId = {};
    (trip.stops || []).forEach((s) => (byId[s.id] = s));
    // Route legs as drawn: legs with matching flights follow the flights' airports
    // (see route.js); the rest keep their hand-drawn path. Flights that fit no leg
    // come back as `extras` and are drawn as their own arcs.
    const derived = window.GRRoute ? GRRoute.derive(trip) : { legs: trip.legs || [], extras: [] };
    const LEGS = derived.legs;

    // ---- panel header ----
    const header = panel.querySelector("header") || panel;
    header.innerHTML =
      `<h1>${escapeHtml(trip.title || "Untitled trip")}</h1>` +
      (trip.subtitle ? `<div class="sub">${escapeHtml(trip.subtitle)}</div>` : "");

    // ---- map + basemaps ----
    const map = L.map("map", { zoomControl: true, scrollWheelZoom: true }).setView(
      trip.center || [-14, 40],
      trip.zoom || 4
    );

    const light = L.tileLayer(
      // CARTO's main host. The a–d.basemap.cartocdn.com subdomains fail to load in some
      // browsers/networks (the Light background showed as plain grey).
      "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      { attribution: "&copy; OpenStreetMap contributors &copy; CARTO", maxZoom: 19 }
    );
    const imagery = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics", maxZoom: 19 }
    );
    const imgLabels = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, opacity: 0.9 }
    );
    const satellite = L.layerGroup([imagery, imgLabels]);
    const terrain = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
      { attribution: "&copy; Esri — terrain & topographic", maxZoom: 19 }
    );
    // Roads, towns/cities and country borders on one background.
    const streets = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      { attribution: "&copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors", maxZoom: 19 }
    );
    // Overlay for any background: highways, roads, railways and airports (Esri World
    // Transportation). Railways come from this layer rather than OpenRailwayMap, whose
    // terms only cover public, login-free sites.
    const transport = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
      { attribution: "Roads &amp; rail &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors", maxZoom: 19 }
    );
    const bases = {
      "🛰  Satellite (GIS)": satellite,
      "⛰  Terrain": terrain,
      "🛣  Roads & places": streets,
      "🗺  Light": light,
    };
    const overlays = { "🛣  Roads & rail": transport };

    // Remember this viewer's background and overlays (per browser), so a choice survives
    // map rebuilds and page reloads. Falls back to Satellite if storage is unavailable.
    const LAYER_KEY = "gr_tp_layers";
    let pref = {};
    try { pref = JSON.parse(localStorage.getItem(LAYER_KEY) || "{}") || {}; } catch (e) { pref = {}; }
    (bases[pref.base] || satellite).addTo(map);
    (Array.isArray(pref.overlays) ? pref.overlays : []).forEach((n) => overlays[n] && overlays[n].addTo(map));
    const savePref = (patch) => {
      pref = Object.assign({}, pref, patch);
      try { localStorage.setItem(LAYER_KEY, JSON.stringify(pref)); } catch (e) {}
    };
    map.on("baselayerchange", (e) => savePref({ base: e.name }));
    map.on("overlayadd overlayremove", () =>
      savePref({ overlays: Object.keys(overlays).filter((n) => map.hasLayer(overlays[n])) }));
    L.control.layers(bases, overlays, { position: "topright", collapsed: false }).addTo(map);

    // ---- park outlines ----
    const parkStyle = {
      color: "#ffd23f",
      weight: 1.6,
      opacity: 0.95,
      fillColor: "#7bb661",
      fillOpacity: 0.14,
      dashArray: "5 5",
    };
    (trip.parks || []).forEach((p) => {
      L.polygon(p.coords, parkStyle)
        .addTo(map)
        .bindTooltip(p.name, { sticky: true, direction: "top" });
    });

    // ---- legs ----
    function legLabel(pts, text) {
      if (!text) return;
      const mid = pts[Math.floor(pts.length / 2)];
      const icon = L.divIcon({
        className: "leg-label",
        html: `<div class="leg-wrap"><span>${escapeHtml(text)}</span></div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      L.marker(mid, { icon, interactive: false, keyboard: false }).addTo(map);
    }
    const hasCoord = (s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng);
    LEGS.forEach((l) => {
      const a = byId[l.from],
        b = byId[l.to];
      if (!hasCoord(a) || !hasCoord(b)) return;
      // waypoint chain: from → any via points that have coords → to, so the
      // leg is drawn as consecutive segments passing through each stopover.
      const chain = [[a.lat, a.lng]];
      (l.via || []).forEach((v) => {
        if (hasCoord(v)) chain.push([v.lat, v.lng]);
      });
      chain.push([b.lat, b.lng]);
      let full = [];
      for (let i = 0; i < chain.length - 1; i++) {
        const seg = l.kind === "transfer" ? [chain[i], chain[i + 1]] : arc(chain[i], chain[i + 1], 0.16);
        L.polyline(seg, { color: "#fff", weight: l.kind === "transfer" ? 5.5 : 5, opacity: 0.55 }).addTo(map);
        if (l.kind === "transfer") {
          L.polyline(seg, { color: "#6a9a5b", weight: 3, opacity: 0.95 }).addTo(map);
        } else {
          L.polyline(seg, { color: "#e8842f", weight: 2.6, opacity: 0.95, dashArray: "7 7" }).addTo(map);
        }
        full = full.concat(seg);
      }
      legLabel(full, l.label);
    });

    // ---- flights that don't connect two stops: their own lighter arcs ----
    derived.extras.forEach((x) => {
      const f = x.flight;
      let full = [];
      for (let i = 0; i < x.pts.length - 1; i++) {
        const seg = arc([x.pts[i].lat, x.pts[i].lng], [x.pts[i + 1].lat, x.pts[i + 1].lng], 0.16);
        L.polyline(seg, { color: "#fff", weight: 4, opacity: 0.45 }).addTo(map);
        L.polyline(seg, { color: "#b0703a", weight: 2, opacity: 0.85, dashArray: "2 6" }).addTo(map);
        full = full.concat(seg);
      }
      x.pts.forEach((p) =>
        L.circleMarker([p.lat, p.lng], { radius: 4.5, color: "#fff", weight: 1.5, fillColor: "#b0703a", fillOpacity: 1 })
          .addTo(map)
          .bindTooltip(escapeHtml(p.name), { direction: "top" })
      );
      legLabel(full, `${f.from || "?"} → ${f.to || "?"}${x.label ? " · " + x.label : ""}`);
    });

    // numbered itinerary sequence (stops interleaved with stopovers)
    const points = orderedPoints(trip, LEGS);

    // ---- markers (stops + stopovers, one pin per coordinate) ----
    const markers = {};
    points.forEach((p, i) => {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return; // no coords yet
      const key = p.lat + "," + p.lng;
      if (markers[key]) return; // one pin per coordinate
      const c = colorFor(p.type);
      const n = i + 1;
      const icon = L.divIcon({
        className: "",
        html: `<div class="marker-pin${p.kind === "via" ? " transit" : ""}" style="background:${c}"><span>${n}</span></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
        popupAnchor: [0, -28],
      });
      const m = L.marker([p.lat, p.lng], { icon }).addTo(map);
      m.bindPopup(
        `<div class="pop"><h3>${escapeHtml(p.name)}</h3>` +
          (p.kind === "via"
            ? `<div class="pm">Stopover${p.legLabel ? " · " + escapeHtml(p.legLabel) : ""}</div>`
            : (p.nights ? `<div class="pm">${escapeHtml(p.nights)}</div>` : "") +
              (p.highlights ? `<p>${escapeHtml(p.highlights)}</p>` : "") +
              (p.lodge ? `<div class="lodge">🏨 ${escapeHtml(p.lodge)}</div>` : "")) +
          `</div>`
      );
      markers[key] = m;
    });

    // ---- itinerary list ----
    const list = document.getElementById("list");
    list.innerHTML = "";
    points.forEach((p, i) => {
      const el = document.createElement("div");
      el.className = "stop" + (p.kind === "via" ? " via" : "");
      el.dataset.i = i;
      el.innerHTML =
        `<div class="num" style="background:${colorFor(p.type)}">${i + 1}</div>` +
        `<div class="body"><div class="name">${escapeHtml(p.name)}</div>` +
        (p.kind === "via"
          ? `<div class="meta">Stopover${p.legLabel ? " · " + escapeHtml(p.legLabel) : ""}</div>`
          : (p.nights ? `<div class="meta">${escapeHtml(p.nights)}</div>` : "") +
            (p.highlights ? `<div class="hl">${escapeHtml(p.highlights)}</div>` : "") +
            (p.lodge ? `<div class="lodge">🏨 ${escapeHtml(p.lodge)}</div>` : "")) +
        `</div>`;
      el.addEventListener("click", () => focusPoint(i));
      list.appendChild(el);
      // "how you get to the next stop" hint — only when the leg has no via
      // points (with stopovers, the numbered via rows already show the route).
      if (p.kind === "stop") {
        const leg = p.nextLeg;
        if (leg && leg.label && !(leg.via && leg.via.length)) {
          const lm = document.createElement("div");
          lm.className = "leg-mode";
          lm.textContent = leg.label;
          list.appendChild(lm);
        }
      }
    });

    function setActive(i) {
      document
        .querySelectorAll(".stop")
        .forEach((e) => e.classList.toggle("active", +e.dataset.i === i));
      const a = document.querySelector(".stop.active");
      if (a) a.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    // focus by index into the numbered points sequence
    function focusPoint(i) {
      const p = points[i];
      setActive(i);
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
      map.flyTo([p.lat, p.lng], p.type === "gateway" ? 5 : p.type === "attraction" ? 9 : 7, { duration: 1.1 });
      const m = markers[p.lat + "," + p.lng];
      setTimeout(() => m && m.openPopup(), 700);
    }
    // focus by stop id (used by the calendar / gantt / linked-item jumps)
    function focusStop(stopId) {
      const i = points.findIndex((p) => p.kind === "stop" && p.id === stopId);
      if (i >= 0) focusPoint(i);
    }
    function fitAll() {
      const pts = points
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .map((p) => [p.lat, p.lng]);
      const b = L.latLngBounds(pts);
      if (pts.length && b.isValid()) map.flyToBounds(b.pad(0.15), { duration: 1.0 });
      setActive(-1);
      map.closePopup();
    }

    // ---- controls (play / fit) ----
    let playing = false,
      timer = null;
    function play(btn) {
      if (playing) return stopPlay(btn);
      playing = true;
      btn.textContent = "■  Stop";
      let i = 0;
      const step = () => {
        if (!playing || i >= points.length) {
          stopPlay(btn);
          if (i >= points.length) setTimeout(fitAll, 900);
          return;
        }
        focusPoint(i);
        i++;
        timer = setTimeout(step, 2600);
      };
      step();
    }
    function stopPlay(btn) {
      playing = false;
      btn.textContent = "▶  Play route";
      clearTimeout(timer);
    }

    // onclick (not addEventListener) so re-mounting the map doesn't stack handlers
    const playBtn = document.getElementById("play");
    const fitBtn = document.getElementById("fit");
    if (playBtn) playBtn.onclick = () => play(playBtn);
    if (fitBtn) fitBtn.onclick = fitAll;

    fitAll();
    return { map, focusStop, fitAll };
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  return { mount };
})();
