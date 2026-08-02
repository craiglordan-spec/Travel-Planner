"use strict";
/* Day-by-day agenda built from the trip's dated items. Clicking an event that
   is linked to a stop calls opts.onFocusStop(stopId). */
window.GRCalendar = (function () {
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
  const fmt = (day, opts) =>
    new Date(toUTC(day)).toLocaleDateString("en-AU", Object.assign({ timeZone: "UTC" }, opts));

  function render(trip, opts) {
    opts = opts || {};
    const el = document.getElementById("calendar");
    const flights = trip.flights || [];
    const accom = trip.accommodation || [];
    const acts = trip.activities || [];

    const dates = [];
    if (trip.startDate) dates.push(trip.startDate);
    flights.forEach((f) => f.date && dates.push(f.date));
    acts.forEach((a) => a.date && dates.push(a.date));
    accom.forEach((a) => {
      if (a.checkIn) dates.push(a.checkIn);
      if (a.checkOut) dates.push(a.checkOut);
    });
    if (!dates.length) {
      el.innerHTML =
        '<div class="emptybox">No dates yet. Set a start date and add flights, accommodation or activities to build the calendar.</div>';
      return;
    }
    dates.sort();
    const start = dates[0];
    const end = dates[dates.length - 1];
    const startMs = toUTC(start);

    el.innerHTML = "";
    for (let ms = startMs; ms <= toUTC(end); ms += 86400000) {
      const day = fromUTC(ms);
      const dayIdx = Math.round((ms - startMs) / 86400000) + 1;
      const events = [];

      flights
        .filter((f) => f.date === day)
        .sort((a, b) => (a.depTime || "").localeCompare(b.depTime || ""))
        .forEach((f) =>
          events.push({
            cls: "flight",
            badge: f.depTime || "Flight",
            main: `${esc(f.from || "?")} → ${esc(f.to || "?")}`,
            sub: [f.airline, f.flightNo, f.arrTime ? "arr " + f.arrTime : ""].filter(Boolean).join(" · "),
            stopId: null,
          })
        );

      accom.forEach((a) => {
        if (!a.checkIn || !a.checkOut) return;
        if (day < a.checkIn || day > a.checkOut) return;
        let label = "Staying";
        if (day === a.checkIn) label = "Check-in";
        else if (day === a.checkOut) label = "Check-out";
        events.push({
          cls: "stay",
          badge: label,
          main: esc(a.name || "Stay"),
          sub: a.roomType ? esc(a.roomType) : "",
          stopId: a.stopId || null,
        });
      });

      acts
        .filter((a) => a.date === day)
        .sort((a, b) => (a.time || "").localeCompare(b.time || ""))
        .forEach((a) =>
          events.push({
            cls: "act",
            badge: a.time || "Activity",
            main: esc(a.title || "Activity"),
            sub: a.location ? esc(a.location) : "",
            stopId: a.stopId || null,
          })
        );

      const card = document.createElement("div");
      card.className = "calday";
      const body = events.length
        ? events
            .map(
              (e) =>
                `<div class="ev ${e.stopId ? "click" : ""}">` +
                `<span class="badge ${e.cls}">${esc(e.badge)}</span>` +
                `<span class="txt">${e.main}${e.sub ? `<span class="sub"> — ${e.sub}</span>` : ""}</span>` +
                `</div>`
            )
            .join("")
        : '<div class="none">— open day —</div>';
      card.innerHTML =
        `<div class="dh"><span class="dow">${fmt(day, { weekday: "long" })}</span>` +
        `<span class="dt">${fmt(day, { day: "numeric", month: "long", year: "numeric" })}</span>` +
        `<span class="idx">Day ${dayIdx}</span></div>` +
        `<div class="body">${body}</div>`;

      // wire clicks
      const evEls = card.querySelectorAll(".ev.click");
      let ci = 0;
      const clickable = events.filter((e) => e.stopId);
      evEls.forEach((evEl, k) => {
        const stopId = clickable[k] && clickable[k].stopId;
        if (stopId) evEl.addEventListener("click", () => opts.onFocusStop && opts.onFocusStop(stopId));
      });
      el.appendChild(card);
    }
  }

  return { render };
})();
