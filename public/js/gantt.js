"use strict";
/* Gantt / timeline view: accommodation as spanning bars, flights and activities
   as markers, across a day-by-day date axis. Clicking a linked bar/marker calls
   opts.onFocusStop(stopId). Complements the agenda calendar. */
window.GRGantt = (function () {
  const DW = 40; // px per day
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  const toUTC = (s) => {
    const p = String(s).split("-").map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2]);
  };
  const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);
  const abbr = (s, n) => {
    s = String(s || "");
    return s.length > (n || 16) ? s.slice(0, (n || 16) - 1) + "…" : s;
  };

  function render(trip, opts) {
    opts = opts || {};
    const el = document.getElementById("gantt");
    const flights = trip.flights || [],
      accom = trip.accommodation || [],
      acts = trip.activities || [];

    const dates = [];
    if (trip.startDate) dates.push(trip.startDate);
    flights.forEach((f) => f.date && dates.push(f.date));
    acts.forEach((a) => a.date && dates.push(a.date));
    accom.forEach((a) => {
      if (a.checkIn) dates.push(a.checkIn);
      if (a.checkOut) dates.push(a.checkOut);
    });
    if (!dates.length) {
      el.innerHTML = '<div class="emptybox">No dates yet. Add flights, accommodation or activities to build the timeline.</div>';
      return;
    }
    dates.sort();
    const startMs = toUTC(dates[0]);
    const endMs = toUTC(dates[dates.length - 1]);
    const totalDays = Math.round((endMs - startMs) / 86400000) + 1;
    const W = totalDays * DW;
    const idx = (d) => Math.round((toUTC(d) - startMs) / 86400000);

    // ---- header ----
    let head = "";
    for (let i = 0; i < totalDays; i++) {
      const dt = new Date(startMs + i * 86400000);
      const opt = { timeZone: "UTC" };
      const dow = dt.toLocaleDateString("en-AU", Object.assign({ weekday: "short" }, opt)).slice(0, 2);
      const dnum = dt.toLocaleDateString("en-AU", Object.assign({ day: "numeric" }, opt));
      const wknd = dt.getUTCDay() === 0 || dt.getUTCDay() === 6;
      const mon = dt.getUTCDate() === 1 || i === 0 ? dt.toLocaleDateString("en-AU", Object.assign({ month: "short" }, opt)) : "";
      head += `<div class="g-daycell ${wknd ? "wknd" : ""}" style="width:${DW}px"><div class="g-mon">${mon}</div><div class="g-dow">${dow}</div><div class="g-dnum">${dnum}</div></div>`;
    }

    const gridBg = `background:repeating-linear-gradient(to right,transparent 0,transparent ${DW - 1}px,#f0e9dd ${DW - 1}px,#f0e9dd ${DW}px)`;
    const rowHtml = (label, bars) =>
      `<div class="g-row"><div class="g-label">${label}</div><div class="g-track" style="width:${W}px;${gridBg}">${bars}</div></div>`;

    let rows = "";

    // stays (one row each)
    accom.forEach((a) => {
      if (!a.checkIn || !a.checkOut) return;
      const left = idx(a.checkIn) * DW;
      const nights = Math.max(1, idx(a.checkOut) - idx(a.checkIn));
      const w = Math.max(DW, (idx(a.checkOut) - idx(a.checkIn)) * DW);
      const click = a.stopId ? "click" : "";
      const bar = `<div class="g-bar stay ${click}" ${a.stopId ? `data-stop="${esc(a.stopId)}"` : ""} style="left:${left}px;width:${w}px" title="${esc(a.name)} · ${esc(a.checkIn)} → ${esc(a.checkOut)}">${esc(abbr(a.name, 22))} <span class="g-n">${nights}n</span></div>`;
      rows += rowHtml("🏨 " + esc(abbr(a.name, 16)), bar);
    });

    // flights (single lane)
    if (flights.length) {
      let bars = "";
      flights.forEach((f) => {
        if (!f.date) return;
        const left = idx(f.date) * DW;
        bars += `<div class="g-pin flight" style="left:${left}px" title="${esc((f.from || "?") + " → " + (f.to || "?") + " · " + f.date + (f.depTime ? " " + f.depTime : ""))}">✈ ${esc(abbr(f.to || f.from, 12))}</div>`;
      });
      rows += rowHtml("✈ Flights", bars);
    }

    // activities (single lane)
    if (acts.length) {
      let bars = "";
      acts.forEach((a) => {
        if (!a.date) return;
        const left = idx(a.date) * DW;
        const click = a.stopId ? "click" : "";
        bars += `<div class="g-pin act ${click}" ${a.stopId ? `data-stop="${esc(a.stopId)}"` : ""} style="left:${left}px" title="${esc((a.title || "") + " · " + a.date + (a.time ? " " + a.time : ""))}">${esc(abbr(a.title, 14))}</div>`;
      });
      rows += rowHtml("🎟 Activities", bars);
    }

    el.innerHTML =
      `<div class="g-scroll">` +
      `<div class="g-headrow"><div class="g-label g-corner">Itinerary</div><div class="g-timehead" style="width:${W}px">${head}</div></div>` +
      `<div class="g-body">${rows}</div>` +
      `</div>`;

    el.querySelectorAll(".g-bar.click[data-stop], .g-pin.click[data-stop]").forEach((node) => {
      const sid = node.getAttribute("data-stop");
      if (sid) node.addEventListener("click", () => opts.onFocusStop && opts.onFocusStop(sid));
    });
  }

  return { render };
})();
