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
  };
  const colorFor = (t) => COLORS[t] || COLORS.gateway;

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
      "https://{s}.basemap.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      { attribution: "&copy; OpenStreetMap &copy; CARTO", subdomains: "abcd", maxZoom: 19 }
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
    satellite.addTo(map);
    L.control
      .layers(
        { "🛰  Satellite (GIS)": satellite, "⛰  Terrain": terrain, "🗺  Light": light },
        null,
        { position: "topright", collapsed: false }
      )
      .addTo(map);

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
    (trip.legs || []).forEach((l) => {
      const a = byId[l.from],
        b = byId[l.to];
      if (!a || !b) return;
      const A = [a.lat, a.lng],
        B = [b.lat, b.lng];
      const pts = l.kind === "transfer" ? [A, B] : arc(A, B, 0.16);
      L.polyline(pts, { color: "#fff", weight: l.kind === "transfer" ? 5.5 : 5, opacity: 0.55 }).addTo(map);
      if (l.kind === "transfer") {
        L.polyline(pts, { color: "#6a9a5b", weight: 3, opacity: 0.95 }).addTo(map);
      } else {
        L.polyline(pts, { color: "#e8842f", weight: 2.6, opacity: 0.95, dashArray: "7 7" }).addTo(map);
      }
      legLabel(pts, l.label);
    });

    // ---- markers ----
    const markers = {};
    (trip.stops || []).forEach((s, i) => {
      const key = s.lat + "," + s.lng;
      if (markers[key]) return; // one pin per coordinate
      const c = colorFor(s.type);
      const n = i + 1;
      const icon = L.divIcon({
        className: "",
        html: `<div class="marker-pin" style="background:${c}"><span>${n}</span></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
        popupAnchor: [0, -28],
      });
      const m = L.marker([s.lat, s.lng], { icon }).addTo(map);
      m.bindPopup(
        `<div class="pop"><h3>${escapeHtml(s.name)}</h3>` +
          (s.nights ? `<div class="pm">${escapeHtml(s.nights)}</div>` : "") +
          (s.highlights ? `<p>${escapeHtml(s.highlights)}</p>` : "") +
          (s.lodge ? `<div class="lodge">🏨 ${escapeHtml(s.lodge)}</div>` : "") +
          `</div>`
      );
      markers[key] = m;
    });

    // ---- itinerary list ----
    const list = document.getElementById("list");
    list.innerHTML = "";
    (trip.stops || []).forEach((s, i) => {
      const el = document.createElement("div");
      el.className = "stop";
      el.dataset.i = i;
      el.innerHTML =
        `<div class="num" style="background:${colorFor(s.type)}">${i + 1}</div>` +
        `<div class="body"><div class="name">${escapeHtml(s.name)}</div>` +
        (s.nights ? `<div class="meta">${escapeHtml(s.nights)}</div>` : "") +
        (s.highlights ? `<div class="hl">${escapeHtml(s.highlights)}</div>` : "") +
        (s.lodge ? `<div class="lodge">🏨 ${escapeHtml(s.lodge)}</div>` : "") +
        `</div>`;
      el.addEventListener("click", () => focusStop(i));
      list.appendChild(el);
      const leg = (trip.legs || []).find((l) => l.from === s.id);
      if (leg && leg.label) {
        const lm = document.createElement("div");
        lm.className = "leg-mode";
        lm.textContent = leg.label;
        list.appendChild(lm);
      }
    });

    function setActive(i) {
      document
        .querySelectorAll(".stop")
        .forEach((e) => e.classList.toggle("active", +e.dataset.i === i));
      const a = document.querySelector(".stop.active");
      if (a) a.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    function focusStop(i) {
      const s = trip.stops[i];
      setActive(i);
      map.flyTo([s.lat, s.lng], s.type === "gateway" ? 5 : 7, { duration: 1.1 });
      const m = markers[s.lat + "," + s.lng];
      setTimeout(() => m && m.openPopup(), 700);
    }
    function fitAll() {
      const b = L.latLngBounds((trip.stops || []).map((s) => [s.lat, s.lng]));
      if (b.isValid()) map.flyToBounds(b.pad(0.15), { duration: 1.0 });
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
        if (!playing || i >= trip.stops.length) {
          stopPlay(btn);
          if (i >= trip.stops.length) setTimeout(fitAll, 900);
          return;
        }
        focusStop(i);
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

    const playBtn = document.getElementById("play");
    const fitBtn = document.getElementById("fit");
    if (playBtn) playBtn.addEventListener("click", () => play(playBtn));
    if (fitBtn) fitBtn.addEventListener("click", fitAll);

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
