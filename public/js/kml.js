"use strict";
/**
 * KML / KMZ import (e.g. a Google My Maps export).
 *
 *   GRKml.readFile(file) → { points, areas, lines, name }
 *     points: [{ name, desc, lat, lng, layer }]   ← Placemark <Point>
 *     areas:  [{ name, coords: [[lat,lng],…] }]   ← Placemark <Polygon> (outer ring)
 *     lines:  number of <LineString> placemarks (not imported — directions/paths)
 *
 *   GRKml.openImport(trip, onSave) shows the import dialog: pick which pins become
 *   route stops (with a pin type), optionally bring shapes in as map outlines and
 *   join the new stops with transfer legs, then onSave(updatedTrip).
 *
 * KMZ is a zip with the KML inside; it's unpacked in the browser with
 * DecompressionStream, so no extra library is needed.
 */
window.GRKml = (function () {
  const TYPES = ["gateway", "safari", "beach", "city", "attraction"];
  const DUP_KM = 0.5; // a pin this close to an existing stop (or same name) is treated as already in the trip

  // ---------- reading ----------
  async function readFile(file) {
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    const isZip = u8[0] === 0x50 && u8[1] === 0x4b; // "PK"
    const text = isZip ? await kmlFromKmz(u8) : new TextDecoder().decode(u8);
    return parse(text);
  }

  // Minimal zip reader: find the first .kml entry (doc.kml in a My Maps KMZ) via the central directory.
  async function kmlFromKmz(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("This KMZ file looks damaged (no zip directory).");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = [];
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
      entries.push({ name, method, csize, local });
      p += 46 + nlen + xlen + clen;
    }
    const e = entries.find((x) => /(^|\/)doc\.kml$/i.test(x.name)) || entries.find((x) => /\.kml$/i.test(x.name));
    if (!e) throw new Error("No KML file found inside this KMZ.");
    const lh = e.local;
    const start = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
    const data = u8.subarray(start, start + e.csize);
    if (e.method === 0) return new TextDecoder().decode(data);
    if (e.method !== 8) throw new Error("Unsupported KMZ compression.");
    if (typeof DecompressionStream === "undefined")
      throw new Error("This browser can't open KMZ files — export as .KML instead (tick “Export to a .KML file”).");
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return await new Response(stream).text();
  }

  // children by local name (ignores the kml: namespace prefix)
  const kids = (el, name) => Array.from(el.children || []).filter((c) => c.localName === name);
  const kid = (el, name) => kids(el, name)[0] || null;
  const txt = (el) => (el && el.textContent ? el.textContent.trim() : "");
  const all = (el, name) => Array.from(el.getElementsByTagNameNS("*", name));

  function plainText(html) {
    if (!html) return "";
    const s = String(html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li)>/gi, "\n")
      .replace(/<img[^>]*>/gi, "");
    const d = new DOMParser().parseFromString("<body>" + s + "</body>", "text/html");
    return (d.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  }
  // "lng,lat[,alt] lng,lat …" → [[lat,lng],…]
  function coordList(s) {
    return String(s || "")
      .trim()
      .split(/\s+/)
      .map((t) => t.split(",").map(Number))
      .filter((a) => a.length >= 2 && Number.isFinite(a[0]) && Number.isFinite(a[1]))
      .map((a) => [+a[1].toFixed(6), +a[0].toFixed(6)]);
  }
  function layerOf(pm) {
    for (let p = pm.parentElement; p; p = p.parentElement) {
      if (p.localName === "Folder") return txt(kid(p, "name"));
    }
    return "";
  }

  function parse(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("That file isn't valid KML.");
    const points = [], areas = [];
    let lines = 0;
    all(doc, "Placemark").forEach((pm) => {
      const name = txt(kid(pm, "name")) || "Unnamed place";
      const desc = plainText(txt(kid(pm, "description")));
      const layer = layerOf(pm);
      all(pm, "Point").forEach((pt) => {
        const c = coordList(txt(all(pt, "coordinates")[0]))[0];
        if (c) points.push({ name, desc, lat: c[0], lng: c[1], layer });
      });
      all(pm, "Polygon").forEach((pg) => {
        const ring = all(pg, "outerBoundaryIs")[0] || pg;
        const coords = coordList(txt(all(ring, "coordinates")[0]));
        if (coords.length >= 3) areas.push({ name, coords });
      });
      lines += all(pm, "LineString").length;
    });
    const docEl = all(doc, "Document")[0];
    return { points, areas, lines, name: docEl ? txt(kid(docEl, "name")) : "" };
  }

  // ---------- import dialog ----------
  function km(a, b) {
    const R = 6371, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function slugId(name, taken) {
    const base = String(name || "stop").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "stop";
    let id = base, n = 2;
    while (taken.has(id)) id = base + "-" + n++;
    taken.add(id);
    return id;
  }
  // a sensible starting pin colour from the place/layer name
  function guessType(p) {
    const s = (p.name + " " + p.layer).toLowerCase();
    if (/\([A-Z]{3}\)/.test(p.name) || /airport|gateway/.test(s)) return "gateway";
    if (/beach|island|bay|coast|plage|plazh/.test(s)) return "beach";
    if (/safari|national park|reserve|game|conservancy/.test(s)) return "safari";
    if (/museum|castle|church|temple|monument|ruins|view|lookout|tour|restaurant|bar|cafe|market|winery|hike|trail/.test(s)) return "attraction";
    return "city";
  }

  let modal = null;
  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "kmlModal";
    modal.innerHTML =
      `<div class="box" style="width:min(680px,100%)">` +
      `<div class="hd"><span>Import from KML / KMZ</span><button class="btn ghost sm" data-k="close">Close</button></div>` +
      `<div class="bd" data-k="body"></div>` +
      `<div class="ft"><span class="kml-err" data-k="err"></span><button class="btn" data-k="save" disabled>Import</button></div>` +
      `</div>`;
    document.body.appendChild(modal);
    modal.querySelector('[data-k="close"]').addEventListener("click", () => modal.classList.remove("open"));
    return modal;
  }

  function openImport(trip, onSave) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz";
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      let data;
      try {
        data = await readFile(file);
      } catch (e) {
        alert("Could not read " + file.name + ":\n" + e.message);
        return;
      }
      if (!data.points.length && !data.areas.length) {
        alert(`No pins or shapes found in ${file.name}.` + (data.lines ? `\n(It has ${data.lines} line/route${data.lines === 1 ? "" : "s"}, which aren't imported.)` : ""));
        return;
      }
      showDialog(trip, data, file.name, onSave);
    });
    input.click();
  }

  function showDialog(trip, data, fileName, onSave) {
    const m = ensureModal();
    const body = m.querySelector('[data-k="body"]');
    const err = m.querySelector('[data-k="err"]');
    const stops = (trip.stops || []).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
    const dupOf = (p) => stops.find((s) => s.name.trim().toLowerCase() === p.name.trim().toLowerCase() || km(s, p) <= DUP_KM);
    const rows = data.points.map((p, i) => ({ p, i, dup: dupOf(p), type: guessType(p) }));
    const existingParks = new Set((trip.parks || []).map((x) => String(x.name || "").toLowerCase()));
    // shapes already on the map (same name) are left out, so re-importing an updated map is safe
    const areas = data.areas.filter((a) => !existingParks.has(a.name.toLowerCase()));
    const skippedAreas = data.areas.length - areas.length;
    const typeSel = (val, attr) =>
      `<select ${attr}>` + TYPES.map((t) => `<option${t === val ? " selected" : ""}>${t}</option>`).join("") + `</select>`;

    const layers = [...new Set(rows.map((r) => r.p.layer).filter(Boolean))];
    body.innerHTML =
      `<div class="kml-sum">From <b>${esc(fileName)}</b>${data.name ? ` (“${esc(data.name)}”)` : ""}: ` +
      `${data.points.length} pin${data.points.length === 1 ? "" : "s"}` +
      (data.areas.length ? `, ${data.areas.length} shape${data.areas.length === 1 ? "" : "s"}` : "") +
      (data.lines ? `, ${data.lines} line${data.lines === 1 ? "" : "s"} (lines aren't imported)` : "") +
      `.</div>` +
      (rows.length
        ? `<div class="kml-bar"><label><input type="checkbox" data-k="all"${rows.some((r) => !r.dup) ? " checked" : ""} /> Select all</label>` +
          `<span>Set all to <select data-k="bulk"><option value="">—</option>${TYPES.map((t) => `<option>${t}</option>`).join("")}</select></span></div>` +
          `<div class="kml-list">` +
          rows
            .map(
              (r) =>
                `<label class="kml-row${r.dup ? " dup" : ""}">` +
                `<input type="checkbox" data-i="${r.i}"${r.dup ? "" : " checked"} />` +
                `<span class="kml-main"><span class="kml-name">${esc(r.p.name)}</span>` +
                `<span class="kml-meta">${[r.p.layer, r.p.lat.toFixed(4) + ", " + r.p.lng.toFixed(4)].filter(Boolean).map(esc).join(" · ")}` +
                (r.dup ? ` · <b>already in trip as “${esc(r.dup.name)}”</b>` : "") +
                `</span></span>` +
                typeSel(r.type, `data-t="${r.i}"`) +
                `</label>`
            )
            .join("") +
          `</div>` +
          `<label class="kml-opt"><input type="checkbox" data-k="legs" /> Join the new stops in order with transfer legs (solid lines)</label>`
        : "") +
      (areas.length
        ? `<label class="kml-opt"><input type="checkbox" data-k="areas" checked /> Add ${areas.length} shape${areas.length === 1 ? "" : "s"} as map outlines (${areas.map((a) => esc(a.name)).join(", ")})</label>`
        : "") +
      (skippedAreas ? `<div class="kml-note">${skippedAreas} shape${skippedAreas === 1 ? " is" : "s are"} already on the map and will be skipped.</div>` : "") +
      `<div class="kml-note">New stops are added after your existing ones; reorder them in the Route tab. Descriptions from the map go into each stop's Highlights.` +
      (layers.length > 1 ? ` Layers found: ${layers.map(esc).join(", ")}.` : "") +
      `</div>`;

    const save = m.querySelector('[data-k="save"]');
    const picked = () => rows.filter((r) => body.querySelector(`[data-i="${r.i}"]`).checked);
    const areasBox = () => body.querySelector('[data-k="areas"]');
    function refresh() {
      const n = picked().length;
      const a = areasBox() && areasBox().checked ? areas.length : 0;
      save.disabled = !n && !a;
      save.textContent = "Import" + (n ? ` ${n} stop${n === 1 ? "" : "s"}` : "") + (a ? `${n ? " +" : ""} ${a} outline${a === 1 ? "" : "s"}` : "");
    }
    body.addEventListener("change", (e) => {
      const k = e.target.getAttribute("data-k");
      if (k === "all") rows.forEach((r) => (body.querySelector(`[data-i="${r.i}"]`).checked = e.target.checked));
      if (k === "bulk" && e.target.value) body.querySelectorAll("[data-t]").forEach((s) => (s.value = e.target.value));
      refresh();
    });
    err.textContent = "";
    refresh();

    save.onclick = async () => {
      const updated = Object.assign({}, trip);
      updated.stops = (trip.stops || []).slice();
      updated.legs = (trip.legs || []).slice();
      updated.parks = (trip.parks || []).slice();
      const taken = new Set(updated.stops.map((s) => s.id));
      const added = picked().map((r) => {
        const s = {
          id: slugId(r.p.name, taken),
          name: r.p.name,
          type: body.querySelector(`[data-t="${r.i}"]`).value,
          lat: r.p.lat,
          lng: r.p.lng,
        };
        if (r.p.desc) s.highlights = r.p.desc;
        return s;
      });
      updated.stops.push(...added);
      if (added.length && body.querySelector('[data-k="legs"]') && body.querySelector('[data-k="legs"]').checked) {
        // start from the trip's previous last stop, if there was one
        const chain = (trip.stops || []).length ? [trip.stops[trip.stops.length - 1]].concat(added) : added;
        for (let i = 1; i < chain.length; i++) updated.legs.push({ from: chain[i - 1].id, to: chain[i].id, kind: "transfer", label: "" });
      }
      if (areasBox() && areasBox().checked) {
        areas.forEach((a) => updated.parks.push({ name: a.name, coords: a.coords }));
      }
      save.disabled = true;
      try {
        await onSave(updated);
        m.classList.remove("open");
      } catch (e) {
        err.textContent = e.message;
        save.disabled = false;
      }
    };
    m.classList.add("open");
  }

  return { readFile, parse, openImport };
})();
