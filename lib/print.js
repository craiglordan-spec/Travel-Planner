"use strict";
/**
 * Printable trip planner — A4 landscape PDF in the same layout as Craig's
 * "Planner V4" spreadsheet: one block per week (Sun → Sat), each day a column
 * with its trip-day number, date and weekday, and the rows
 *   Travel · Overnight · Hotel · Activities · Notes
 *
 * Built from the trip JSON on the server with PDFKit, so it downloads as a real
 * PDF on desktop and iPhone alike (no browser print dialog needed).
 *   GET /api/trips/:id/print.pdf   (token-protected; mounted in server.js)
 *
 * Notes row: the trip's Daily notes (trip.dayNotes: { id, date, note }).
 *
 * Fonts: Liberation Sans (SIL OFL 1.1, lib/fonts) — Arial-metric, and has the
 * → arrow that the built-in PDF Helvetica lacks.
 */
const path = require("path");
const PDFDocument = require("pdfkit");

const FONT_R = path.join(__dirname, "fonts", "LiberationSans-Regular.ttf");
const FONT_B = path.join(__dirname, "fonts", "LiberationSans-Bold.ttf");

// ---- layout (points; A4 landscape = 841.89 × 595.28) -----------------------
const PAGE = { w: 841.89, h: 595.28 };
const M = { l: 24, r: 24, t: 30, b: 26 };
const LABEL_W = 52;
const COL_W = (PAGE.w - M.l - M.r - LABEL_W) / 7;
const HEAD_H = 13; // week header row (day no., date, weekday)
const FS = 7; // body font size
const LH = 10.2; // body line height
const ROW_PAD = 4; // extra space per row (top + bottom)
const PAD = 3; // cell padding
const BLOCK_GAP = 10;
// Minimum lines per row — keeps the familiar spreadsheet look (two Travel rows,
// two Activities rows, room to write Notes by hand) even on quiet weeks.
const ROWS = [
  { key: "travel", label: "Travel", min: 2 },
  { key: "overnight", label: "Overnight", min: 1 },
  { key: "hotel", label: "Hotel", min: 1, align: "right" },
  { key: "activities", label: "Activities", min: 2 },
  { key: "notes", label: "Notes", min: 4 },
];

const C = {
  ink: "#111111",
  grey: "#6b6b6b",
  faint: "#b5b5b5",
  head: "#d9d9d9",
  headOut: "#efefef",
  outFill: "#f7f7f7",
  rule: "#c8c8c8",
  frame: "#000000",
};

// ---- date helpers (all plain YYYY-MM-DD, no time zones) ---------------------
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const toUTC = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const fromUTC = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (s, n) => fromUTC(toUTC(s) + n * 86400000);
const dayDiff = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
const dow = (s) => new Date(toUTC(s)).getUTCDay(); // 0 = Sunday
const WD = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dmy = (s) => `${+s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}`; // 1/06/26, as the spreadsheet
const longDate = (s) => `${+s.slice(8, 10)} ${MON[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`;

// "Sydney (SYD) → Brisbane" → "Sydney → Brisbane"; keeps the planner readable.
const place = (s) =>
  String(s || "")
    .replace(/\s*\([A-Z0-9]{3,4}\)/g, "")
    .replace(/\s*(->|→)\s*/g, "→")
    .trim();
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

// ---- what goes in each day -------------------------------------------------
function buildDays(trip) {
  const flights = (trip.flights || []).filter((f) => isDate(f.date));
  const stays = (trip.accommodation || []).filter((a) => isDate(a.checkIn) || isDate(a.checkOut));
  const trans = (trip.transport || []).filter((t) => isDate(t.pickupDate) || isDate(t.dropoffDate));
  const acts = (trip.activities || []).filter((a) => isDate(a.date));
  const notes = (trip.dayNotes || []).filter((n) => isDate(n.date) && String(n.note || "").trim());
  const stopName = (id) => ((trip.stops || []).find((s) => s.id === id) || {}).name || "";

  // Trip span: trip start date (if set) through the last dated thing.
  const dates = [];
  if (isDate(trip.startDate)) dates.push(trip.startDate);
  flights.forEach((f) => { dates.push(f.date); if (isDate(f.arrDate)) dates.push(f.arrDate); });
  stays.forEach((a) => { if (isDate(a.checkIn)) dates.push(a.checkIn); if (isDate(a.checkOut)) dates.push(a.checkOut); });
  trans.forEach((t) => { if (isDate(t.pickupDate)) dates.push(t.pickupDate); if (isDate(t.dropoffDate)) dates.push(t.dropoffDate); });
  acts.forEach((a) => dates.push(a.date));
  notes.forEach((n) => dates.push(n.date));
  if (!dates.length) return null;
  dates.sort();
  const first = isDate(trip.startDate) ? trip.startDate : dates[0];
  const start = dates[0] < first ? dates[0] : first;
  const end = dates[dates.length - 1];

  const days = {};
  const day = (d) => (days[d] = days[d] || { travel: [], overnight: [], hotel: [], activities: [], notes: [] });

  // Travel lines carry a sort key (time) so a day reads in order.
  const travel = (d, time, text) => day(d).travel.push({ k: time || "99:99", text });

  flights.forEach((f) => {
    const route = `${place(f.from) || "?"}→${place(f.to) || "?"}`;
    const next = isDate(f.arrDate) && f.arrDate !== f.date ? dayDiff(f.date, f.arrDate) : 0;
    const no = f.flightNo && !/^tbc$/i.test(f.flightNo) ? ` (${clean(f.flightNo)})` : "";
    travel(f.date, f.depTime, clean(`${f.depTime || ""} ${route} ${f.arrTime || ""}${next ? ` +${next}` : ""}${no}`));
    if (next > 0) {
      travel(f.arrDate, f.arrTime, clean(`Arr ${f.arrTime || ""} ${place(f.to).split("→").pop()}`));
      // Nights spent in the air.
      for (let i = 0; i < next; i++) day(addDays(f.date, i)).overnight.push({ text: "Flight", weak: true });
    }
  });

  trans.forEach((t) => {
    const kind = t.kind || "Transport";
    const who = t.provider ? ` (${clean(t.provider)})` : "";
    const from = place(t.pickupLocation), to = place(t.dropoffLocation);
    const pick = isDate(t.pickupDate) ? t.pickupDate : t.dropoffDate;
    const drop = isDate(t.dropoffDate) ? t.dropoffDate : pick;
    if (kind === "Car hire") {
      travel(pick, t.pickupTime, clean(`${t.pickupTime || ""} Car pick-up ${from}${who}`));
      if (drop !== pick || t.dropoffTime || to)
        travel(drop, t.dropoffTime, clean(`${t.dropoffTime || ""} Car return ${to || from}`));
      return;
    }
    const route = from || to ? `${from || "?"}→${to || "?"}` : "";
    const next = dayDiff(pick, drop);
    travel(pick, t.pickupTime, clean(`${t.pickupTime || ""} ${kind} ${route} ${next ? "" : t.dropoffTime || ""}${who}`));
    if (next > 0) {
      travel(drop, t.dropoffTime, clean(`Arr ${t.dropoffTime || ""} ${to}`));
      for (let i = 0; i < next; i++) day(addDays(pick, i)).overnight.push({ text: kind, weak: true });
    }
  });

  // A stay covers the nights check-in … day before check-out.
  stays.forEach((a) => {
    const ci = isDate(a.checkIn) ? a.checkIn : a.checkOut;
    const co = isDate(a.checkOut) ? a.checkOut : addDays(ci, 1);
    const n = Math.max(1, dayDiff(ci, co));
    const where = stopName(a.stopId);
    for (let i = 0; i < n; i++) {
      const d = day(addDays(ci, i));
      if (where) d.overnight.push({ text: where });
      d.hotel.push({ text: clean(a.name) || "Stay" });
    }
  });

  // Daily notes keep their line breaks (blank lines dropped).
  notes.forEach((n) =>
    day(n.date).notes.push({ text: String(n.note).replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean).join("\n") })
  );

  acts.forEach((a) => day(a.date).activities.push({ k: a.time || "99:99", text: clean(`${a.time || ""} ${a.title || "Activity"}`) }));

  // Finalise: sort by time, drop duplicate overnight places, and prefer a real
  // place over "Flight" when a stay also covers that night.
  Object.values(days).forEach((d) => {
    d.travel.sort((a, b) => a.k.localeCompare(b.k));
    d.activities.sort((a, b) => a.k.localeCompare(b.k));
    if (d.notes.length > 1) d.notes.forEach((n) => (n.text = "• " + n.text.replace(/\n/g, "\n   ")));
    const strong = d.overnight.filter((o) => !o.weak);
    const seen = new Set();
    d.overnight = (strong.length ? strong : d.overnight).filter((o) => !seen.has(o.text) && seen.add(o.text));
  });

  return { start, first, end, days };
}

// ---- PDF -------------------------------------------------------------------
function render(trip, out) {
  const plan = buildDays(trip);
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 0,
    bufferPages: true,
    info: { Title: `${trip.title || "Trip"} — planner`, Author: "GR Travel Planner" },
  });
  doc.registerFont("R", FONT_R);
  doc.registerFont("B", FONT_B);
  doc.pipe(out);

  const title = trip.title || "Trip";
  const header = () => {
    doc.font("B").fontSize(12).fillColor(C.ink).text(title, M.l, M.t - 20, { lineBreak: false });
    const tw = doc.widthOfString(title);
    const sub = plan
      ? [`${longDate(plan.first)} – ${longDate(plan.end)}`, `${dayDiff(plan.first, plan.end) + 1} days`, trip.travellers].filter(Boolean).join("  ·  ")
      : "";
    doc.font("R").fontSize(8).fillColor(C.grey).text(sub, M.l + tw + 12, M.t - 17, { lineBreak: false });
  };

  if (!plan) {
    header();
    doc.font("R").fontSize(10).fillColor(C.ink)
      .text("Nothing dated yet — add flights, stays, transport or activities with dates (or set the trip start date) to print the planner.", M.l, M.t + 20);
    doc.end();
    return;
  }

  // Weeks run Sunday → Saturday, like the spreadsheet.
  const gridStart = addDays(plan.start, -dow(plan.start));
  const gridEnd = addDays(plan.end, 6 - dow(plan.end));
  const weeks = [];
  for (let w = gridStart; w <= gridEnd; w = addDays(w, 7)) weeks.push(w);

  const innerW = COL_W - PAD * 2;
  const wrap = (text, font) => {
    // Lines this text needs in a day column (PDFKit's own wrapping measure).
    doc.font(font).fontSize(FS);
    return Math.max(1, Math.ceil(doc.heightOfString(text, { width: innerW, lineGap: LH - FS * 1.15 }) / LH - 0.01));
  };

  // Height of each row for one week = most lines any day needs (≥ the minimum).
  const measure = (w) => {
    const lines = {};
    ROWS.forEach((r) => {
      let max = r.min;
      for (let i = 0; i < 7; i++) {
        const d = plan.days[addDays(w, i)];
        if (!d) continue;
        const n = d[r.key].reduce((s, it) => s + wrap(it.text, r.key === "overnight" || r.key === "hotel" ? "B" : "R"), 0);
        max = Math.max(max, n);
      }
      lines[r.key] = max;
    });
    return { lines, h: HEAD_H + ROWS.reduce((s, r) => s + lines[r.key] * LH + ROW_PAD, 0) };
  };

  const drawWeek = (w, y, m) => {
    const x0 = M.l, x1 = PAGE.w - M.r;
    // header band
    for (let i = -1; i < 7; i++) {
      const cx = i < 0 ? x0 : x0 + LABEL_W + i * COL_W;
      const cw = i < 0 ? LABEL_W : COL_W;
      const d = i < 0 ? null : addDays(w, i);
      const inTrip = d && d >= plan.start && d <= plan.end;
      doc.rect(cx, y, cw, HEAD_H).fill(d && !inTrip ? C.headOut : C.head);
      if (d && !inTrip) doc.rect(cx, y + HEAD_H, cw, m.h - HEAD_H).fill(C.outFill);
      if (!d) continue;
      const tday = dayDiff(plan.first, d) + 1;
      const col = inTrip ? C.ink : C.faint;
      if (inTrip) doc.font("R").fontSize(6.5).fillColor(C.grey).text(String(tday), cx + PAD, y + 3.4, { lineBreak: false });
      doc.font("B").fontSize(7.5).fillColor(col).text(dmy(d), cx + 18, y + 3, { width: cw - 46, align: "right", lineBreak: false });
      doc.font("B").fontSize(8).fillColor(col).text(WD[dow(d)], cx + cw - 26, y + 2.6, { width: 23, align: "right", lineBreak: false });
    }

    // row labels + faint separators
    let ry = y + HEAD_H;
    ROWS.forEach((r, ri) => {
      const rh = m.lines[r.key] * LH + ROW_PAD;
      doc.font("B").fontSize(7).fillColor(C.ink).text(r.label, x0 + PAD, ry + 2.5, { lineBreak: false });
      if (ri) doc.moveTo(x0, ry).lineTo(x1, ry).lineWidth(0.3).strokeColor(C.rule).stroke();
      // cell contents
      for (let i = 0; i < 7; i++) {
        const d = plan.days[addDays(w, i)];
        if (!d || !d[r.key].length) continue;
        let ty = ry + 2.5;
        const cx = x0 + LABEL_W + i * COL_W + PAD;
        d[r.key].forEach((it) => {
          const bold = r.key === "overnight" || r.key === "hotel";
          doc.font(bold ? "B" : "R").fontSize(FS).fillColor(it.weak ? C.grey : r.key === "travel" ? "#3a3a3a" : C.ink)
            .text(it.text, cx, ty, { width: innerW, align: r.align || "left", lineGap: LH - FS * 1.15 });
          ty += wrap(it.text, bold ? "B" : "R") * LH;
        });
      }
      ry += rh;
    });

    // frame + column lines
    doc.lineWidth(0.9).strokeColor(C.frame);
    doc.rect(x0, y, x1 - x0, m.h).stroke();
    for (let i = 0; i <= 6; i++) {
      const cx = x0 + LABEL_W + i * COL_W;
      doc.moveTo(cx, y).lineTo(cx, y + m.h).stroke();
    }
  };

  header();
  let y = M.t;
  weeks.forEach((w) => {
    const m = measure(w);
    if (y + m.h > PAGE.h - M.b && y > M.t) {
      doc.addPage();
      header();
      y = M.t;
    }
    drawWeek(w, y, m);
    y += m.h + BLOCK_GAP;
  });

  // footer: printed date + page x of y
  const printed = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Brisbane" });
  const range = doc.bufferedPageRange();
  for (let p = 0; p < range.count; p++) {
    doc.switchToPage(p);
    doc.font("R").fontSize(6.5).fillColor(C.grey);
    doc.text(`Printed ${printed}`, M.l, PAGE.h - M.b + 8, { lineBreak: false });
    doc.text(`Page ${p + 1} of ${range.count}`, PAGE.w - M.r - 80, PAGE.h - M.b + 8, { width: 80, align: "right", lineBreak: false });
  }
  doc.end();
}

module.exports = function mountPrint(app, auth, store) {
  app.get("/api/trips/:id/print.pdf", auth, (req, res) => {
    const trip = store.getTrip(req.params.id);
    if (!trip) return res.status(404).json({ error: "not found" });
    const name = String(trip.title || trip.id).replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "trip";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${name}-planner.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    try {
      render(trip, res);
    } catch (e) {
      console.error("print failed:", e);
      if (!res.headersSent) res.status(500).json({ error: "could not build the PDF" });
      else res.end();
    }
  });
};
module.exports.render = render;
module.exports.buildDays = buildDays;
