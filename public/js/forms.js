"use strict";
/* Generic CRUD forms + list rendering for flights / accommodation / activities.
   Uses the shared #itemModal. Calls opts.onChange(trip) to persist. */
window.GRForms = (function () {
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  const money = (v) =>
    v == null || v === "" ? "" : "$" + Number(v).toLocaleString();

  function nights(ci, co) {
    if (!ci || !co) return null;
    const d = (new Date(co) - new Date(ci)) / 86400000;
    return isFinite(d) ? Math.round(d) : null;
  }

  const SPECS = {
    flights: {
      icon: "✈",
      singular: "Flight",
      order: ["date","airline","flightNo","from","to","depTime","arrTime","cabin","bookingRef","cost","notes"],
      fields: {
        date: { label: "Date", type: "date" },
        airline: { label: "Airline", type: "text" },
        flightNo: { label: "Flight no.", type: "text" },
        from: { label: "From", type: "text" },
        to: { label: "To", type: "text" },
        depTime: { label: "Departs", type: "time" },
        arrTime: { label: "Arrives", type: "time" },
        cabin: { label: "Cabin", type: "select", options: ["Economy","Premium Economy","Business","First"] },
        bookingRef: { label: "Booking ref", type: "text" },
        cost: { label: "Cost (AUD)", type: "number" },
        notes: { label: "Notes", type: "textarea" },
      },
      rows: [["date"],["airline","flightNo"],["from","to"],["depTime","arrTime"],["cabin","bookingRef"],["cost"],["notes"]],
      card(it) {
        return {
          title: `${esc(it.from || "?")} → ${esc(it.to || "?")}`,
          d: [it.date, it.depTime && it.arrTime ? it.depTime + "–" + it.arrTime : "", [it.airline, it.flightNo].filter(Boolean).join(" ")].filter(Boolean).join(" · "),
          meta: it.notes,
          tags: [it.cabin, money(it.cost) && "AUD " + money(it.cost)].filter(Boolean),
        };
      },
    },
    accommodation: {
      icon: "🏨",
      singular: "Stay",
      order: ["name","stopId","checkIn","checkOut","roomType","bookingRef","cost","notes"],
      fields: {
        name: { label: "Property name", type: "text" },
        stopId: { label: "Linked stop", type: "stop" },
        checkIn: { label: "Check-in", type: "date" },
        checkOut: { label: "Check-out", type: "date" },
        roomType: { label: "Room / board", type: "text" },
        bookingRef: { label: "Booking ref", type: "text" },
        cost: { label: "Cost (AUD)", type: "number" },
        notes: { label: "Notes", type: "textarea" },
      },
      rows: [["name"],["stopId"],["checkIn","checkOut"],["roomType"],["bookingRef","cost"],["notes"]],
      card(it) {
        const n = nights(it.checkIn, it.checkOut);
        return {
          title: esc(it.name || "Stay"),
          d: [it.checkIn && it.checkOut ? it.checkIn + " → " + it.checkOut : "", n != null ? n + " night" + (n === 1 ? "" : "s") : ""].filter(Boolean).join(" · "),
          meta: it.notes,
          tags: [it.roomType, money(it.cost) && "AUD " + money(it.cost)].filter(Boolean),
        };
      },
    },
    activities: {
      icon: "🎟",
      singular: "Activity",
      order: ["title","date","time","location","stopId","cost","notes"],
      fields: {
        title: { label: "Activity", type: "text" },
        date: { label: "Date", type: "date" },
        time: { label: "Time", type: "time" },
        location: { label: "Location", type: "text" },
        stopId: { label: "Linked stop", type: "stop" },
        cost: { label: "Cost (AUD)", type: "number" },
        notes: { label: "Notes", type: "textarea" },
      },
      rows: [["title"],["date","time"],["location"],["stopId"],["cost"],["notes"]],
      card(it) {
        return {
          title: esc(it.title || "Activity"),
          d: [it.date, it.time, it.location].filter(Boolean).join(" · "),
          meta: it.notes,
          tags: [money(it.cost) && "AUD " + money(it.cost)].filter(Boolean),
        };
      },
    },
    stops: {
      icon: "📍",
      singular: "Stop",
      order: ["name","type","lat","lng","nights","highlights"],
      fields: {
        name: { label: "Place name", type: "text" },
        type: { label: "Type (pin colour)", type: "select", options: ["gateway","safari","beach","city"] },
        lat: { label: "Latitude", type: "number" },
        lng: { label: "Longitude", type: "number" },
        nights: { label: "Nights / label", type: "text" },
        highlights: { label: "Highlights", type: "textarea" },
      },
      rows: [["name"],["type"],["lat","lng"],["nights"],["highlights"]],
      card(it) {
        return {
          title: esc(it.name || "Stop"),
          d: [it.type, it.nights].filter(Boolean).join(" · "),
          meta: it.highlights,
          tags: [Number.isFinite(it.lat) && Number.isFinite(it.lng) ? `${it.lat}, ${it.lng}` : "⚠ no coordinates"].filter(Boolean),
        };
      },
    },
    legs: {
      icon: "↝",
      singular: "Leg",
      order: ["from","to","kind","label"],
      fields: {
        from: { label: "From (stop)", type: "stop" },
        to: { label: "To (stop)", type: "stop" },
        kind: { label: "Type", type: "select", options: ["fly","transfer"] },
        label: { label: "Label (e.g. 'Qantas · ~18h')", type: "text" },
      },
      rows: [["from","to"],["kind"],["label"]],
      card(it, trip) {
        return {
          title: `${esc(stopName(trip, it.from) || "?")} → ${esc(stopName(trip, it.to) || "?")}`,
          d: it.kind === "transfer" ? "Transfer (solid line)" : "Flight (dashed arc)",
          meta: it.label,
          tags: [],
        };
      },
    },
  };

  function stopName(trip, id) {
    const s = (trip.stops || []).find((x) => x.id === id);
    return s ? s.name : "";
  }

  function renderList(key, trip, opts) {
    const spec = SPECS[key];
    const el = document.getElementById(key);
    const items = trip[key] || [];
    if (!items.length) {
      el.innerHTML = `<div class="emptybox">No ${key} yet. Click “+ Add ${spec.singular.toLowerCase()}” to add one.</div>`;
      return;
    }
    el.innerHTML = "";
    items.forEach((it, idx) => {
      const c = spec.card(it, trip);
      const linked = it.stopId ? stopName(trip, it.stopId) : "";
      const div = document.createElement("div");
      div.className = "item";
      const reorder = opts.reorder
        ? `<button class="btn ghost sm" data-up ${idx === 0 ? "disabled" : ""}>↑</button>` +
          `<button class="btn ghost sm" data-down ${idx === items.length - 1 ? "disabled" : ""}>↓</button>`
        : "";
      div.innerHTML =
        `<div class="ic">${spec.icon}</div>` +
        `<div class="main">` +
        `<div class="t">${c.title}</div>` +
        (c.d ? `<div class="d">${esc(c.d)}</div>` : "") +
        (c.meta ? `<div class="meta">${esc(c.meta)}</div>` : "") +
        `<div class="tags">` +
        (c.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join("") +
        (linked ? `<span class="chip linkstop" data-stop="${esc(it.stopId)}">📍 ${esc(linked)}</span>` : "") +
        `</div></div>` +
        `<div class="rowbtns">${reorder}<button class="btn ghost sm" data-edit="${esc(it.id)}">Edit</button></div>`;
      div.querySelector("[data-edit]").addEventListener("click", () => openEditor(key, trip, it.id, opts));
      const ls = div.querySelector(".linkstop");
      if (ls) ls.addEventListener("click", () => opts.onFocusStop && opts.onFocusStop(it.stopId));
      if (opts.reorder) {
        const up = div.querySelector("[data-up]");
        const down = div.querySelector("[data-down]");
        if (up) up.addEventListener("click", () => { if (idx > 0) { swap(items, idx, idx - 1); opts.onChange(trip); } });
        if (down) down.addEventListener("click", () => { if (idx < items.length - 1) { swap(items, idx, idx + 1); opts.onChange(trip); } });
      }
      el.appendChild(div);
    });
  }

  function swap(arr, i, j) {
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }

  function slugId(name, items) {
    let base = String(name || "stop").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "stop";
    let id = base, n = 2;
    const taken = new Set((items || []).map((x) => x.id));
    while (taken.has(id)) id = base + "-" + n++;
    return id;
  }

  function fieldHtml(trip, key, name, val) {
    const f = SPECS[key].fields[name];
    const v = val == null ? "" : val;
    let input;
    if (f.type === "textarea") {
      input = `<textarea data-f="${name}">${esc(v)}</textarea>`;
    } else if (f.type === "select") {
      input =
        `<select data-f="${name}"><option value="">—</option>` +
        f.options.map((o) => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("") +
        `</select>`;
    } else if (f.type === "stop") {
      input =
        `<select data-f="${name}"><option value="">— none —</option>` +
        (trip.stops || [])
          .map((s) => `<option value="${esc(s.id)}" ${s.id === v ? "selected" : ""}>${esc(s.name)}</option>`)
          .join("") +
        `</select>`;
    } else {
      const extra = f.type === "number" ? ' step="any"' : "";
      input = `<input data-f="${name}" type="${f.type}" value="${esc(v)}"${extra} />`;
    }
    return `<div class="field"><label>${esc(f.label)}</label>${input}</div>`;
  }

  function openEditor(key, trip, itemId, opts) {
    const spec = SPECS[key];
    const modal = document.getElementById("itemModal");
    const body = document.getElementById("imBody");
    const items = trip[key] || (trip[key] = []);
    const existing = itemId ? items.find((x) => x.id === itemId) : null;
    const data = existing || {};

    document.getElementById("imTitle").textContent =
      (existing ? "Edit " : "Add ") + spec.singular.toLowerCase();
    body.innerHTML = spec.rows
      .map((row) =>
        row.length > 1
          ? `<div class="frow">${row.map((n) => fieldHtml(trip, key, n, data[n])).join("")}</div>`
          : fieldHtml(trip, key, row[0], data[row[0]])
      )
      .join("");

    const del = document.getElementById("imDelete");
    del.style.display = existing ? "block" : "none";

    modal.classList.add("open");

    function close() {
      modal.classList.remove("open");
      cleanup();
    }
    function save() {
      const vals = {};
      body.querySelectorAll("[data-f]").forEach((el) => {
        let v = el.value;
        if (el.type === "number") v = v === "" ? null : Number(v);
        vals[el.getAttribute("data-f")] = v;
      });
      if (existing) {
        Object.assign(existing, vals);
      } else {
        vals.id =
          key === "stops"
            ? slugId(vals.name, items)
            : key.slice(0, 2) + "-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
        items.push(vals);
      }
      modal.classList.remove("open");
      cleanup();
      opts.onChange(trip);
    }
    function remove() {
      const i = items.findIndex((x) => x.id === itemId);
      if (i >= 0) items.splice(i, 1);
      modal.classList.remove("open");
      cleanup();
      opts.onChange(trip);
    }
    const saveBtn = document.getElementById("imSave");
    const closeBtn = document.getElementById("imClose");
    saveBtn.addEventListener("click", save);
    closeBtn.addEventListener("click", close);
    del.addEventListener("click", remove);
    function cleanup() {
      saveBtn.removeEventListener("click", save);
      closeBtn.removeEventListener("click", close);
      del.removeEventListener("click", remove);
    }
  }

  return { SPECS, renderList, openEditor };
})();
