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

  // Web links: only http(s) is ever turned into a link. A bare "example.com" gets https://.
  function normUrl(u) {
    u = String(u || "").trim();
    if (!u) return "";
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u) && /^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(u)) u = "https://" + u;
    return u;
  }
  const isWebUrl = (u) => /^https?:\/\/[^\s]+$/i.test(u);
  const urlHost = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; } };
  // Escape text, then make any http(s) links in it clickable.
  function linkify(text) {
    const s = String(text == null ? "" : text);
    const rx = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;
    let out = "", last = 0, m;
    while ((m = rx.exec(s))) {
      out += esc(s.slice(last, m.index)) + `<a href="${esc(m[0])}" target="_blank" rel="noopener noreferrer">${esc(m[0])}</a>`;
      last = m.index + m[0].length;
    }
    return out + esc(s.slice(last));
  }
  const IDEA_STATUS = ["New", "Shortlisted", "Booked / done", "Not doing"];
  const shortDate = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }); };

  // ---- attachments (flights, stays, activities, ideas, route stops + legs) ----
  const ATTACH_KEYS = new Set(["flights", "accommodation", "activities", "ideas", "stops", "legs"]);
  const INLINE_EXT = new Set(["pdf", "jpg", "jpeg", "png", "gif", "webp", "txt"]);
  const ACCEPT = ".pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.eml,.msg,.ics";
  const MAX_MB = 25;
  const extOf = (n) => ((/\.([a-z0-9]+)$/i.exec(n || "") || [])[1] || "").toLowerCase();
  const fileIcon = (n) => {
    const e = extOf(n);
    return e === "pdf" ? "📄" : /^(jpe?g|png|gif|webp|hei[cf])$/.test(e) ? "🖼" : /^(eml|msg)$/.test(e) ? "✉" : "📎";
  };
  const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round((b || 0) / 1024)) + " KB");
  const fileUrl = (tripId, fid) => `/api/trips/${encodeURIComponent(tripId)}/files/${encodeURIComponent(fid)}`;

  // Open (PDF/images/text, in a new tab) or download (Office, email…) an attachment.
  // Fetched with the sign-in token, so links can't be opened by anyone else.
  async function openFile(tripId, f) {
    const inline = INLINE_EXT.has(extOf(f.name));
    const w = inline ? window.open("", "_blank") : null; // open now, before the await, so it isn't popup-blocked
    try {
      const r = await GRAuth.apiFetch(fileUrl(tripId, f.id));
      if (!r.ok) throw new Error(r.status === 404 ? "That file is no longer on the server." : "Could not open the file (" + r.status + ").");
      const url = URL.createObjectURL(await r.blob());
      if (w) {
        w.location.href = url;
      } else {
        const a = document.createElement("a");
        a.href = url; a.download = f.name;
        document.body.appendChild(a); a.click(); a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (e) {
      if (w) w.close();
      alert(e.message);
    }
  }
  function deleteFile(tripId, fid) {
    return GRAuth.apiFetch(fileUrl(tripId, fid), { method: "DELETE" }).catch(() => {});
  }
  async function uploadFile(tripId, file) {
    const r = await GRAuth.apiFetch(`/api/trips/${encodeURIComponent(tripId)}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
      body: file,
    });
    let d = {};
    try { d = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(d.error || "Upload failed (" + r.status + ")");
    return d;
  }

  // Attachments section in the item editor. Uploads happen straight away; the
  // list is only written to the item when the editor is saved. Returns hooks the
  // editor calls on save / cancel / delete so nothing is left orphaned.
  function injectAttachEditor(body, trip, data) {
    const original = (data.files || []).map((f) => Object.assign({}, f));
    let list = original.slice();
    const fresh = new Set(); // uploaded in this editing session
    let busy = 0;

    const wrap = document.createElement("div");
    wrap.className = "att-editor";
    wrap.innerHTML =
      `<label class="att-label">Attachments</label>` +
      `<div class="att-rows"></div>` +
      `<div class="att-drop" tabindex="0">📎 Drop files here or <u>choose files</u>` +
      `<div class="att-hint">Tickets, confirmations, vouchers, screenshots — PDF, images, Office, email · up to ${MAX_MB} MB each</div></div>` +
      `<input type="file" class="att-input" multiple accept="${ACCEPT}" hidden />` +
      `<div class="att-msg"></div>`;
    body.appendChild(wrap);
    const rows = wrap.querySelector(".att-rows");
    const drop = wrap.querySelector(".att-drop");
    const input = wrap.querySelector(".att-input");
    const msg = wrap.querySelector(".att-msg");

    function render() {
      rows.innerHTML = "";
      list.forEach((f) => {
        const row = document.createElement("div");
        row.className = "att-row";
        row.innerHTML =
          `<span class="att-name">${fileIcon(f.name)} <a href="#">${esc(f.name)}</a></span>` +
          `<span class="att-size">${fmtSize(f.size)}</span>` +
          `<button type="button" class="btn ghost sm" title="Remove">✕</button>`;
        row.querySelector("a").addEventListener("click", (e) => { e.preventDefault(); openFile(trip.id, f); });
        row.querySelector("button").addEventListener("click", () => {
          list = list.filter((x) => x.id !== f.id);
          if (fresh.has(f.id)) { fresh.delete(f.id); deleteFile(trip.id, f.id); }
          render();
        });
        rows.appendChild(row);
      });
    }

    async function addFiles(fileList) {
      const files = Array.from(fileList || []);
      for (const file of files) {
        if (file.size > MAX_MB * 1048576) { msg.className = "att-msg err"; msg.textContent = `${file.name} is over ${MAX_MB} MB.`; continue; }
        busy++;
        msg.className = "att-msg"; msg.textContent = `Uploading ${file.name}…`;
        try {
          const meta = await uploadFile(trip.id, file);
          fresh.add(meta.id);
          list.push(meta);
          render();
          msg.textContent = "";
        } catch (e) {
          msg.className = "att-msg err"; msg.textContent = `${file.name}: ${e.message}`;
        } finally {
          busy--;
        }
      }
    }

    drop.addEventListener("click", () => input.click());
    drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    input.addEventListener("change", () => { addFiles(input.files); input.value = ""; });
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
    render();

    return {
      busy: () => busy > 0,
      files: () => list.slice(),
      // saved: delete the originals the user removed
      committed() {
        const keep = new Set(list.map((f) => f.id));
        original.forEach((f) => { if (!keep.has(f.id)) deleteFile(trip.id, f.id); });
      },
      // closed without saving: delete what was uploaded this session
      cancelled() { fresh.forEach((id) => deleteFile(trip.id, id)); },
      // item deleted: delete everything
      removedItem() {
        original.forEach((f) => deleteFile(trip.id, f.id));
        fresh.forEach((id) => deleteFile(trip.id, id));
      },
    };
  }

  function nights(ci, co) {
    if (!ci || !co) return null;
    const d = (new Date(co) - new Date(ci)) / 86400000;
    return isFinite(d) ? Math.round(d) : null;
  }

  const SPECS = {
    flights: {
      icon: "✈",
      singular: "Flight",
      order: ["date","arrDate","airline","flightNo","from","to","depTime","arrTime","cabin","bookingRef","cost","notes"],
      fields: {
        date: { label: "Departure date", type: "date" },
        arrDate: { label: "Arrival date (if different)", type: "date" },
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
      rows: [["date","arrDate"],["airline","flightNo"],["from","to"],["depTime","arrTime"],["cabin","bookingRef"],["cost"],["notes"]],
      card(it, trip) {
        const plus = it.arrDate && it.date && it.arrDate !== it.date ? dayDelta(it.date, it.arrDate) : 0;
        const when = it.date
          ? `${it.date}${it.depTime ? " " + it.depTime : ""}` +
            (it.arrTime || plus ? ` → ${plus ? it.arrDate + " " : ""}${it.arrTime || ""}${plus ? ` (${plus > 0 ? "+" : ""}${plus} day${Math.abs(plus) === 1 ? "" : "s"})` : ""}` : "")
          : "";
        return {
          title: `${esc(it.from || "?")} → ${esc(it.to || "?")}`,
          d: [when, [it.airline, it.flightNo].filter(Boolean).join(" ")].filter(Boolean).join(" · "),
          meta: it.notes,
          tags: [it.cabin, money(it.cost) && "AUD " + money(it.cost), routeChip(it, trip)].filter(Boolean),
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
    ideas: {
      icon: "💡",
      singular: "Idea",
      order: ["title","category","status","url","stopId","notes"],
      fields: {
        title: { label: "Idea", type: "text" },
        category: { label: "Category", type: "select", options: ["Place to visit","Accommodation","Activity","Food & drink","Transport","Tip / info","To book","Other"] },
        status: { label: "Status", type: "select", options: IDEA_STATUS },
        url: { label: "Web link", type: "url" },
        stopId: { label: "Linked stop", type: "stop" },
        notes: { label: "Notes (links in here are clickable too)", type: "textarea" },
      },
      rows: [["title"],["category","status"],["url"],["stopId"],["notes"]],
      card(it) {
        const url = normUrl(it.url);
        return {
          title: esc(it.title || (url ? urlHost(url) : "Idea")),
          d: [it.category, it.addedAt ? "added " + shortDate(it.addedAt) : ""].filter(Boolean).join(" · "),
          meta: it.notes,
          tags: [it.status || "New"],
          link: isWebUrl(url) ? url : "",
          dim: it.status === "Not doing",
        };
      },
    },
    stops: {
      icon: "📍",
      singular: "Stop",
      order: ["name","type","lat","lng","nights","highlights"],
      fields: {
        name: { label: "Place name", type: "text" },
        type: { label: "Type (pin colour)", type: "select", options: ["gateway","safari","beach","city","attraction"] },
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
        const chain = [stopName(trip, it.from) || "?"]
          .concat((it.via || []).map((v) => v.name || "?"))
          .concat([stopName(trip, it.to) || "?"]);
        const nv = (it.via || []).length;
        return {
          title: chain.map(esc).join(" → "),
          d: it.kind === "transfer" ? "Transfer (solid line)" : "Flight (dashed arc)",
          meta: it.label,
          tags: nv ? [`${nv} stopover${nv === 1 ? "" : "s"}`] : [],
        };
      },
    },
  };

  function newId(key, items) {
    let id;
    do id = key.slice(0, 2) + "-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    while (items.some((x) => x && x.id === id));
    return id;
  }

  function stopName(trip, id) {
    const s = (trip.stops || []).find((x) => x.id === id);
    return s ? s.name : "";
  }

  // Where a flight lands on the map (see route.js): on a route leg, as its own
  // arc, or not yet — with the place that couldn't be found.
  function routeChip(f, trip) {
    if (!window.GRRoute) return "";
    const r = f.route;
    if (!Array.isArray(r) || !r.length || !GRRoute.routeIsCurrent(f)) return "🗺 map route pending";
    const miss = r.filter((p) => !GRRoute.has(p));
    if (miss.length) return `⚠ not on map — can't place “${miss[0].name}”`;
    const D = GRRoute.derive(trip);
    const li = D.legOf[f.id];
    if (li != null) {
      const l = (trip.legs || [])[li];
      return `🗺 ${stopName(trip, l.from) || "?"} → ${stopName(trip, l.to) || "?"} leg`;
    }
    return "🗺 own arc (no matching leg)";
  }

  // Display order for lists that read best chronologically. Display only — the saved
  // order is untouched. Undated items go last, in the order they were added.
  const LIST_SORT = {
    // Ideas: still-open ones first (New, Shortlisted), then Booked / done, then Not doing;
    // newest first within each.
    ideas: (a, b) => {
      const r = (x) => { const i = IDEA_STATUS.indexOf(x.status || "New"); return i < 0 ? 0 : i; };
      return r(a) - r(b) || String(b.addedAt || "").localeCompare(String(a.addedAt || ""));
    },
    accommodation: (a, b) => {
      const ka = a.checkIn || a.checkOut || "", kb = b.checkIn || b.checkOut || "";
      if (!ka || !kb) return ka ? -1 : kb ? 1 : 0;
      return ka.localeCompare(kb) || (a.checkOut || "").localeCompare(b.checkOut || "") || String(a.name || "").localeCompare(String(b.name || ""));
    },
  };

  function renderList(key, trip, opts) {
    const spec = SPECS[key];
    const el = document.getElementById(key);
    const stored = trip[key] || [];
    // Older items (e.g. seeded route legs) have no id, so Edit couldn't find them and
    // opened a blank "Add" form instead. Give them one; it's saved with the next change.
    stored.forEach((it) => { if (it && !it.id) it.id = newId(key, stored); });
    const items = LIST_SORT[key] && !opts.reorder ? stored.slice().sort(LIST_SORT[key]) : stored;
    if (!items.length) {
      el.innerHTML = `<div class="emptybox">No ${key} yet. Click “+ Add ${spec.singular.toLowerCase()}” to add one.</div>`;
      return;
    }
    el.innerHTML = "";
    items.forEach((it, idx) => {
      const c = spec.card(it, trip);
      const linked = it.stopId ? stopName(trip, it.stopId) : "";
      const div = document.createElement("div");
      div.className = "item" + (c.dim ? " dim" : "");
      const reorder = opts.reorder
        ? `<button class="btn ghost sm" data-up ${idx === 0 ? "disabled" : ""}>↑</button>` +
          `<button class="btn ghost sm" data-down ${idx === items.length - 1 ? "disabled" : ""}>↓</button>`
        : "";
      div.innerHTML =
        `<div class="ic">${spec.icon}</div>` +
        `<div class="main">` +
        `<div class="t">${c.title}</div>` +
        (c.d ? `<div class="d">${esc(c.d)}</div>` : "") +
        (c.link ? `<div class="d"><a class="weblink" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(urlHost(c.link))}</a></div>` : "") +
        (c.meta ? `<div class="meta">${linkify(c.meta)}</div>` : "") +
        (ATTACH_KEYS.has(key) && (it.files || []).length
          ? `<div class="files">` + it.files.map((f) => `<a href="#" data-file="${esc(f.id)}" title="${esc(fmtSize(f.size))}">${fileIcon(f.name)} ${esc(f.name)}</a>`).join("") + `</div>`
          : "") +
        `<div class="tags">` +
        (c.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join("") +
        (linked ? `<span class="chip linkstop" data-stop="${esc(it.stopId)}">📍 ${esc(linked)}</span>` : "") +
        `</div></div>` +
        `<div class="rowbtns">${reorder}<button class="btn ghost sm" data-edit="${esc(it.id)}">Edit</button></div>`;
      div.querySelector("[data-edit]").addEventListener("click", () => openEditor(key, trip, it.id, opts));
      div.querySelectorAll("[data-file]").forEach((a) =>
        a.addEventListener("click", (e) => {
          e.preventDefault();
          const f = (it.files || []).find((x) => x.id === a.getAttribute("data-file"));
          if (f) openFile(trip.id, f);
        })
      );
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

  // ---- date ripple ("flow-through") shared by all dated collections ----
  // The "anchor" is the item's effective end date: check-out for a stay, the
  // date for a flight or activity. Moving it offers to shift everything after.
  const DATED_ANCHOR = { flights: "date", activities: "date", accommodation: "checkOut" };
  function isoShift(iso, days) {
    if (!iso) return iso;
    const p = iso.split("-").map(Number);
    const ms = Date.UTC(p[0], p[1] - 1, p[2]) + days * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  function dayDelta(a, b) {
    const pa = a.split("-").map(Number),
      pb = b.split("-").map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }
  function allDated(trip) {
    const out = [];
    (trip.flights || []).forEach((x) => out.push({ x, type: "flights" }));
    (trip.accommodation || []).forEach((x) => out.push({ x, type: "accommodation" }));
    (trip.activities || []).forEach((x) => out.push({ x, type: "activities" }));
    return out;
  }
  const anchorOf = (type, x) => (type === "accommodation" ? x.checkOut : x.date);
  function downstreamItems(trip, editedItem, oldEnd) {
    const res = [];
    allDated(trip).forEach((t) => {
      if (t.x === editedItem) return;
      const a = anchorOf(t.type, t.x);
      if (a && a >= oldEnd) res.push(t);
    });
    return res;
  }
  function shiftItem(t, days) {
    if (t.type === "accommodation") {
      if (t.x.checkIn) t.x.checkIn = isoShift(t.x.checkIn, days);
      if (t.x.checkOut) t.x.checkOut = isoShift(t.x.checkOut, days);
    } else if (t.x.date) {
      t.x.date = isoShift(t.x.date, days);
      if (t.x.arrDate) t.x.arrDate = isoShift(t.x.arrDate, days);
    }
  }

  // Shared flow-through prompt: given an item whose anchor moved from oldEnd,
  // offer to shift every item on/after it by the same delta. Used by both the
  // form editor and the Gantt drag-to-reschedule.
  function rippleAfterEdit(trip, key, item, oldEnd) {
    const anchorField = DATED_ANCHOR[key];
    if (!anchorField || !oldEnd) return;
    const newEnd = item[anchorField];
    if (!newEnd || oldEnd === newEnd) return;
    const days = dayDelta(oldEnd, newEnd);
    const affected = downstreamItems(trip, item, oldEnd);
    if (days !== 0 && affected.length &&
      confirm(
        `This moves the schedule by ${days > 0 ? "+" : ""}${days} day${Math.abs(days) === 1 ? "" : "s"}.\n\n` +
        `Shift the ${affected.length} later item${affected.length === 1 ? "" : "s"} (on or after ${oldEnd}) by the same amount so the rest of the trip flows through?\n\n` +
        `OK = shift the rest · Cancel = change just this one.`
      )) {
      affected.forEach((t) => shiftItem(t, days));
    }
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

  // ---- stopover ("via") editor for route legs ---------------------------
  // Geocode a place name to coordinates via OpenStreetMap Nominatim. Runs in
  // the user's browser; low-volume, one call per "Look up" click.
  async function geocodePlace(name) {
    const url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
      encodeURIComponent(name);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const arr = await res.json();
    if (!arr.length) return null;
    const h = arr[0];
    return {
      lat: +Number(h.lat).toFixed(5),
      lng: +Number(h.lon).toFixed(5),
      label: h.display_name,
    };
  }

  function viaRow(v) {
    v = v || {};
    const row = document.createElement("div");
    row.className = "via-row";
    row.innerHTML =
      `<div class="frow" style="align-items:flex-end;gap:8px">` +
      `<div class="field" style="flex:2;margin-bottom:8px"><label>Place</label><input class="v-name" type="text" value="${esc(v.name || "")}" placeholder="e.g. Sydney" /></div>` +
      `<div class="field" style="flex:1;margin-bottom:8px"><label>Lat</label><input class="v-lat" type="number" step="any" value="${v.lat == null ? "" : esc(v.lat)}" /></div>` +
      `<div class="field" style="flex:1;margin-bottom:8px"><label>Lng</label><input class="v-lng" type="number" step="any" value="${v.lng == null ? "" : esc(v.lng)}" /></div>` +
      `<button type="button" class="btn ghost sm v-look" style="margin-bottom:8px">Look up</button>` +
      `<button type="button" class="btn ghost sm v-del" style="margin-bottom:8px" title="Remove stopover">✕</button>` +
      `</div>` +
      `<div class="v-msg" style="font-size:11px;min-height:14px;margin:-4px 0 8px"></div>`;
    const look = row.querySelector(".v-look");
    const msg = row.querySelector(".v-msg");
    row.querySelector(".v-del").addEventListener("click", () => row.remove());
    look.addEventListener("click", async () => {
      const name = row.querySelector(".v-name").value.trim();
      if (!name) {
        msg.style.color = "#c0392b";
        msg.textContent = "Enter a place name first.";
        return;
      }
      const label = look.textContent;
      look.disabled = true;
      look.textContent = "…";
      msg.style.color = "#8a7c6b";
      msg.textContent = "Looking up…";
      try {
        const hit = await geocodePlace(name);
        if (hit) {
          row.querySelector(".v-lat").value = hit.lat;
          row.querySelector(".v-lng").value = hit.lng;
          msg.style.color = "#5a7d4f";
          msg.textContent = "✓ " + hit.label;
        } else {
          msg.style.color = "#c0392b";
          msg.textContent = "No match — enter coordinates manually.";
        }
      } catch (e) {
        msg.style.color = "#c0392b";
        msg.textContent = "Lookup failed — enter coordinates manually.";
      } finally {
        look.disabled = false;
        look.textContent = label;
      }
    });
    return row;
  }

  function injectViaEditor(body, via) {
    const wrap = document.createElement("div");
    wrap.className = "via-editor";
    wrap.style.cssText = "border-top:1px solid var(--line);margin-top:6px;padding-top:12px";
    wrap.innerHTML =
      `<label style="display:block;font-size:12px;font-weight:600;color:#6b5c48;margin-bottom:4px">Stopovers / via (optional)</label>` +
      `<div style="font-size:11.5px;color:#8a7c6b;margin-bottom:10px">Shown as numbered pins between From and To, in order. Type a place and press “Look up” to fill coordinates.</div>` +
      `<div class="via-rows"></div>` +
      `<button type="button" class="btn ghost sm via-add">+ Add stopover</button>`;
    body.appendChild(wrap);
    const rows = wrap.querySelector(".via-rows");
    (via || []).forEach((v) => rows.appendChild(viaRow(v)));
    wrap.querySelector(".via-add").addEventListener("click", () => rows.appendChild(viaRow({})));
  }

  function collectVia(body) {
    const out = [];
    body.querySelectorAll(".via-row").forEach((row) => {
      const name = row.querySelector(".v-name").value.trim();
      const latRaw = row.querySelector(".v-lat").value;
      const lngRaw = row.querySelector(".v-lng").value;
      if (!name && latRaw === "" && lngRaw === "") return; // skip blank row
      const o = { name };
      if (latRaw !== "") o.lat = Number(latRaw);
      if (lngRaw !== "") o.lng = Number(lngRaw);
      out.push(o);
    });
    return out;
  }

  // ---- map route editor for flights ------------------------------------
  // One row per place in From / To (origin, connections, destination), filled
  // automatically from airport codes, trip stops or a place lookup; coordinates
  // can be corrected by hand.
  function routeRow(p, idx, total) {
    const row = document.createElement("div");
    row.className = "rt-row";
    const role = idx === 0 ? "From" : idx === total - 1 ? "To" : "Via";
    const ok = Number.isFinite(p.lat) && Number.isFinite(p.lng);
    row.innerHTML =
      `<div class="frow" style="align-items:flex-end;gap:8px">` +
      `<div class="field" style="flex:2;margin-bottom:6px"><label>${role}</label><input class="r-name" type="text" value="${esc(p.name || "")}" readonly style="background:#f6f2ea" /></div>` +
      `<div class="field" style="flex:1;margin-bottom:6px"><label>Lat</label><input class="r-lat" type="number" step="any" value="${ok ? esc(p.lat) : ""}" /></div>` +
      `<div class="field" style="flex:1;margin-bottom:6px"><label>Lng</label><input class="r-lng" type="number" step="any" value="${ok ? esc(p.lng) : ""}" /></div>` +
      `<button type="button" class="btn ghost sm r-look" style="margin-bottom:6px">Look up</button>` +
      `</div><div class="r-msg" style="font-size:11px;min-height:14px;margin:-2px 0 6px;color:${ok ? "#5a7d4f" : "#c0392b"}">${ok ? (p.code ? "✓ airport " + esc(p.code) : "✓ located") : "Not found — press Look up or enter coordinates"}</div>`;
    const look = row.querySelector(".r-look"), msg = row.querySelector(".r-msg");
    look.addEventListener("click", async () => {
      look.disabled = true; msg.style.color = "#8a7c6b"; msg.textContent = "Looking up…";
      try {
        const hit = await geocodePlace(p.name.replace(/\([^)]*\)/g, "").trim() || p.name);
        if (hit) {
          row.querySelector(".r-lat").value = hit.lat; row.querySelector(".r-lng").value = hit.lng;
          msg.style.color = "#5a7d4f"; msg.textContent = "✓ " + hit.label;
        } else { msg.style.color = "#c0392b"; msg.textContent = "No match — enter coordinates manually."; }
      } catch (e) { msg.style.color = "#c0392b"; msg.textContent = "Lookup failed — enter coordinates manually."; }
      finally { look.disabled = false; }
    });
    return row;
  }
  function injectRouteEditor(body, trip, data) {
    const wrap = document.createElement("div");
    wrap.className = "route-editor";
    wrap.style.cssText = "border-top:1px solid var(--line);margin-top:6px;padding-top:12px";
    wrap.innerHTML =
      `<label style="display:block;font-size:12px;font-weight:600;color:#6b5c48;margin-bottom:4px">Map route</label>` +
      `<div style="font-size:11.5px;color:#8a7c6b;margin-bottom:10px">Filled in from From / To — airport codes in brackets, e.g. “Sydney (SYD)”, are placed exactly. Write a connection as “Nairobi (NBO) → Masai Mara”. The route map follows these points automatically.</div>` +
      `<div class="rt-rows"></div>`;
    body.appendChild(wrap);
    const rows = wrap.querySelector(".rt-rows");
    const show = (route) => { rows.innerHTML = ""; route.forEach((p, i) => rows.appendChild(routeRow(p, i, route.length))); };
    const cur = { from: data.from || "", to: data.to || "" };
    if (window.GRRoute && GRRoute.routeIsCurrent(data)) show(data.route);
    let seq = 0;
    async function rebuild() {
      if (!window.GRRoute) return;
      const f = { from: body.querySelector('[data-f="from"]').value, to: body.querySelector('[data-f="to"]').value };
      const my = ++seq;
      rows.innerHTML = `<div style="font-size:11.5px;color:#8a7c6b">Locating places…</div>`;
      const r = await GRRoute.buildRoute(trip, f, true);
      if (my === seq) show(r);
    }
    if (!(window.GRRoute && GRRoute.routeIsCurrent(data))) rebuild();
    let t = null;
    ["from", "to"].forEach((k) => body.querySelector(`[data-f="${k}"]`).addEventListener("input", () => {
      clearTimeout(t); t = setTimeout(rebuild, 700);
    }));
  }
  function collectRoute(body) {
    const out = [];
    body.querySelectorAll(".rt-row").forEach((row) => {
      const o = { name: row.querySelector(".r-name").value };
      const la = row.querySelector(".r-lat").value, ln = row.querySelector(".r-lng").value;
      if (la !== "" && ln !== "") { o.lat = Number(la); o.lng = Number(ln); }
      const code = /\(([A-Z]{3})\)/.exec(o.name);
      if (code) o.code = code[1];
      out.push(o);
    });
    return out;
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

    // legs get an extra dynamic stopover ("via") editor below the standard fields
    if (key === "legs") injectViaEditor(body, data.via || []);
    if (key === "flights") {
      injectRouteEditor(body, trip, data);
      // arrival-date hint: an arrival time earlier than departure usually means next day
      const hint = document.createElement("div");
      hint.className = "arr-hint";
      hint.style.cssText = "font-size:11.5px;color:#b0703a;margin:-6px 0 10px;min-height:0";
      const ad = body.querySelector('[data-f="arrDate"]');
      ad.closest(".frow").after(hint);
      const check = () => {
        const d = body.querySelector('[data-f="date"]').value, a = ad.value;
        const dt = body.querySelector('[data-f="depTime"]').value, at = body.querySelector('[data-f="arrTime"]').value;
        if (d && a && a < d) hint.textContent = "⚠ Arrival date is before the departure date.";
        else if (d && !a && dt && at && at < dt) hint.textContent = "Arrival time is earlier than departure — if it lands the next day, set the arrival date.";
        else hint.textContent = "";
      };
      ["date", "arrDate", "depTime", "arrTime"].forEach((k) => body.querySelector(`[data-f="${k}"]`).addEventListener("input", check));
      check();
    }

    const att = ATTACH_KEYS.has(key) ? injectAttachEditor(body, trip, data) : null;

    const del = document.getElementById("imDelete");
    del.style.display = existing ? "block" : "none";

    modal.classList.add("open");

    function close() {
      if (att) att.cancelled();
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
      if (att) {
        if (att.busy()) { alert("Please wait — a file is still uploading."); return; }
        vals.files = att.files();
      }
      if (key === "legs") vals.via = collectVia(body);
      if (key === "flights") {
        if (vals.arrDate && vals.date && vals.arrDate < vals.date) {
          alert("The arrival date is before the departure date — please check it.");
          return;
        }
        if (vals.arrDate && vals.arrDate === vals.date) vals.arrDate = "";
        const rt = collectRoute(body);
        if (rt.length) vals.route = rt;
      }
      if (key === "ideas") {
        vals.url = normUrl(vals.url);
        if (vals.url && !isWebUrl(vals.url)) { alert("The web link should start with http:// or https://"); return; }
        if (!String(vals.title || "").trim() && !vals.url && !String(vals.notes || "").trim() && !(vals.files || []).length) { alert("Add the idea, a link, some notes or a file."); return; }
        if (!String(vals.title || "").trim() && !vals.url && (vals.files || []).length) vals.title = vals.files[0].name;
        if (!String(vals.title || "").trim() && vals.url) vals.title = urlHost(vals.url);
        if (!vals.status) vals.status = "New";
        if (!existing) vals.addedAt = new Date().toISOString();
      }
      const anchorField = DATED_ANCHOR[key];
      const oldEnd = existing && anchorField ? existing[anchorField] : null;
      if (existing) {
        Object.assign(existing, vals);
      } else {
        vals.id = key === "stops" ? slugId(vals.name, items) : newId(key, items);
        items.push(vals);
      }
      // ripple: if a dated item's anchor moved, offer to flow the change through
      if (existing && anchorField) rippleAfterEdit(trip, key, existing, oldEnd);
      if (att) att.committed();
      modal.classList.remove("open");
      cleanup();
      opts.onChange(trip);
    }
    function remove() {
      const nf = att ? att.files().length : 0;
      if (nf && !confirm(`Delete this ${spec.singular.toLowerCase()} and its ${nf} attached file${nf === 1 ? "" : "s"}?`)) return;
      if (att) att.removedItem();
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

  return { SPECS, renderList, openEditor, rippleAfterEdit };
})();
