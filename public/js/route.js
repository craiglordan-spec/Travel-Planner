"use strict";
/**
 * Flight → map route derivation.
 *
 * Each flight carries `route`: the ordered map points of that flight —
 * [origin, …connections, destination], each {name, lat, lng, code?}. It is
 * built from the From / To text: "Johannesburg (JNB)" resolves via the IATA
 * code in brackets (bundled OpenFlights airport table, /vendor/airports.json),
 * a plain name matching a trip stop uses that stop, anything else is looked up
 * with OpenStreetMap Nominatim. "A → B" in a field is read as a connection.
 *
 * derive(trip) then lays the flights onto the route legs: for each leg, in
 * order, it finds the chain of flights that starts near the leg's From stop
 * and ends near its To stop, and returns that leg drawn through the flights'
 * airports with an automatic label. Legs with no matching flights keep their
 * hand-drawn path. Flights that fit no leg are returned as `extras`.
 */
window.GRRoute = (function () {
  const NEAR_KM = 120;   // airport ↔ stop counts as "the same place"
  const FAR_KM = 400;    // a leg may start from an airport this far from its stop (e.g. Mara → Nairobi)
  const SAME_KM = 30;    // consecutive points closer than this are merged
  const MAX_GAP_DAYS = 3; // connections must depart within this many days of the previous arrival

  let AIRPORTS = null, airportsPromise = null;
  function loadAirports() {
    if (AIRPORTS) return Promise.resolve(AIRPORTS);
    if (!airportsPromise)
      airportsPromise = fetch("/vendor/airports.json")
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}))
        .then((d) => (AIRPORTS = d || {}));
    return airportsPromise;
  }

  const has = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
  function km(a, b) {
    const R = 6371, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  // "Nairobi (NBO) → Masai Mara" → ["Nairobi (NBO)", "Masai Mara"]
  const splitPlaces = (s) => String(s || "").split(/\s*(?:→|->|⇒)\s*/).map((x) => x.trim()).filter(Boolean);
  function tokensOf(f) { return splitPlaces(f.from).concat(splitPlaces(f.to)); }
  function iataOf(tok) {
    const m = /\(([A-Z]{3})\)/.exec(tok) || /^([A-Z]{3})$/.exec(tok.trim());
    return m ? m[1] : null;
  }
  const words = (s) => String(s || "").toLowerCase().replace(/\([^)]*\)/g, " ").split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  function stopFor(trip, tok) {
    const tw = words(tok);
    if (!tw.length) return null;
    const stops = (trip.stops || []).filter(has);
    // exact name first, then first significant word in common
    const n = tok.toLowerCase().replace(/\([^)]*\)/g, "").trim();
    return stops.find((s) => s.name.toLowerCase().replace(/\([^)]*\)/g, "").trim() === n) ||
      stops.find((s) => { const sw = words(s.name); return sw.length && tw.some((w) => sw.includes(w)); }) || null;
  }
  async function geocode(name) {
    const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(name);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const arr = await res.json();
    if (!arr.length) return null;
    return { lat: +Number(arr[0].lat).toFixed(5), lng: +Number(arr[0].lon).toFixed(5), label: arr[0].display_name };
  }

  // Resolve one place token. `allowGeocode` = false in the client present view.
  async function resolveToken(trip, tok, allowGeocode) {
    const ap = await loadAirports();
    const code = iataOf(tok);
    if (code && ap[code]) {
      const a = ap[code];
      return { name: tok, lat: a[0], lng: a[1], code, how: "airport", label: a[2] };
    }
    const st = stopFor(trip, tok);
    if (st) return { name: tok, lat: st.lat, lng: st.lng, how: "stop", label: st.name };
    if (allowGeocode) {
      try {
        const g = await geocode(tok.replace(/\([^)]*\)/g, "").trim() || tok);
        if (g) return { name: tok, lat: g.lat, lng: g.lng, how: "lookup", label: g.label };
      } catch (e) {}
    }
    return { name: tok, how: "unresolved" };
  }
  async function buildRoute(trip, flight, allowGeocode) {
    const out = [];
    for (const tok of tokensOf(flight)) {
      out.push(await resolveToken(trip, tok, allowGeocode));
      if (allowGeocode) await new Promise((r) => setTimeout(r, 50));
    }
    return out.map((p) => { const o = { name: p.name }; if (has(p)) { o.lat = p.lat; o.lng = p.lng; } if (p.code) o.code = p.code; return o; });
  }
  // Route is stale when the From/To text no longer matches the stored points.
  function routeIsCurrent(f) {
    const r = f.route;
    if (!Array.isArray(r) || !r.length) return false;
    const toks = tokensOf(f);
    return toks.length === r.length && toks.every((t, i) => t === r[i].name);
  }
  // Fill / refresh `route` on every flight that needs it. Returns the number changed.
  async function ensureRoutes(trip, allowGeocode) {
    let n = 0;
    for (const f of trip.flights || []) {
      if (routeIsCurrent(f) && f.route.every(has)) continue;
      if (routeIsCurrent(f) && !allowGeocode) continue; // keep what we have
      const keep = routeIsCurrent(f) ? f.route : null;
      const fresh = await buildRoute(trip, f, allowGeocode);
      // never throw away coordinates someone typed in by hand
      if (keep) fresh.forEach((p, i) => { if (!has(p) && has(keep[i])) { p.lat = keep[i].lat; p.lng = keep[i].lng; } });
      f.route = fresh;
      n++;
    }
    return n;
  }

  const arrDateOf = (f) => f.arrDate || f.date || "";
  const sortKey = (f) => (f.date || "9999") + " " + (f.depTime || "99:99");
  const dayGap = (a, b) => {
    if (!a || !b) return 0;
    const p = (s) => { const x = s.split("-").map(Number); return Date.UTC(x[0], x[1] - 1, x[2]); };
    return (p(b) - p(a)) / 86400000;
  };
  function shortDate(iso) {
    if (!iso) return "";
    const p = iso.split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2])).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
  }
  function autoLabel(chain) {
    // "Qantas QF63" — one entry per airline, with its known flight numbers (TBC dropped)
    const byAirline = new Map();
    chain.forEach((f) => {
      const air = String(f.airline || "").trim();
      const no = /^(tbc|tba|-)?$/i.test(String(f.flightNo || "").trim()) ? "" : String(f.flightNo).trim();
      if (!air && !no) return;
      const k = air || no;
      if (!byAirline.has(k)) byAirline.set(k, []);
      if (no && air) byAirline.get(k).push(no);
    });
    const carriers = [...byAirline].map(([air, nos]) => [air].concat(nos).join(" "));
    const d1 = chain[0].date, d2 = arrDateOf(chain[chain.length - 1]);
    let dates = shortDate(d1 || d2);
    if (d1 && d2 && d1 !== d2) {
      const [a1, m1] = shortDate(d1).split(" "), [a2, m2] = shortDate(d2).split(" ");
      dates = m1 === m2 ? `${a1}–${a2} ${m2}` : `${shortDate(d1)} – ${shortDate(d2)}`;
    }
    return [carriers.join(" + "), dates].filter(Boolean).join(" · ");
  }

  function derive(trip) {
    const stops = {};
    (trip.stops || []).forEach((s) => (stops[s.id] = s));
    const fl = (trip.flights || [])
      .filter((f) => Array.isArray(f.route) && f.route.length >= 2 && f.route.every(has))
      .slice()
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const used = new Set();
    const legOf = {}; // flight id -> leg index
    let cursor = 0;

    const legs = (trip.legs || []).map((l, li) => {
      const A = stops[l.from], B = stops[l.to];
      if (!has(A) || !has(B)) return l;
      for (let i = cursor; i < fl.length; i++) {
        if (used.has(i)) continue;
        const o = fl[i].route[0];
        if (km(o, A) > FAR_KM) continue;
        // follow connections until we arrive near B
        const idx = [i];
        let ok = false;
        for (;;) {
          const cur = fl[idx[idx.length - 1]];
          const last = cur.route[cur.route.length - 1];
          if (km(last, B) <= NEAR_KM) { ok = true; break; }
          let next = -1;
          for (let j = idx[idx.length - 1] + 1; j < fl.length; j++) {
            if (used.has(j)) continue;
            if (km(fl[j].route[0], last) <= NEAR_KM && dayGap(arrDateOf(cur), fl[j].date) <= MAX_GAP_DAYS) { next = j; break; }
          }
          if (next < 0) break;
          idx.push(next);
        }
        if (!ok) continue;
        idx.forEach((k) => { used.add(k); legOf[fl[k].id] = li; });
        cursor = idx[idx.length - 1] + 1;
        const chain = idx.map((k) => fl[k]);
        // via = every point between A and B, merged where consecutive points coincide
        const pts = [];
        chain.forEach((f) => f.route.forEach((p) => pts.push(p)));
        const via = [];
        let prev = A;
        pts.forEach((p, k) => {
          if (k === pts.length - 1) return; // final arrival ≈ B
          if (km(p, prev) <= (prev === A ? NEAR_KM : SAME_KM)) return;
          if (km(p, B) <= NEAR_KM) return;
          via.push({ name: p.code ? p.name : p.name, lat: p.lat, lng: p.lng });
          prev = p;
        });
        return Object.assign({}, l, { kind: "fly", via, label: autoLabel(chain), auto: true, flightIds: chain.map((f) => f.id) });
      }
      return l;
    });

    const extras = fl
      .filter((f, i) => !used.has(i))
      .map((f) => ({ flight: f, pts: f.route, label: autoLabel([f]) }));
    return { legs, extras, legOf };
  }

  return { loadAirports, ensureRoutes, buildRoute, resolveToken, routeIsCurrent, derive, tokensOf, has, km };
})();
