"use strict";
/**
 * GR Travel Planner — Node/Express web service.
 * Matches the Invoice Desk deployment pattern:
 *   - single web service, listens on process.env.PORT (Railway sets it; 8080 default)
 *   - JSON data persisted on a mounted volume at DATA_DIR (/data in prod)
 *   - basic auth via APP_USERNAME / APP_PASSWORD
 *   - built by Railpack from package.json (no Dockerfile), auto-deploy on push
 */
const path = require("path");
const express = require("express");
const store = require("./lib/store");

const app = express();
const PORT = process.env.PORT || 8080;

const USERNAME = process.env.APP_USERNAME || "admin";
const PASSWORD = process.env.APP_PASSWORD || "changeme";
// Optional read-only key: lets you share a client "present" link without the
// admin password (mirrors Invoice Desk's INVOICEDESK_READ_KEY idea).
const READ_KEY = process.env.APP_READ_KEY || "";

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

// ---- auth --------------------------------------------------------------
function parseBasic(header) {
  if (!header || !header.startsWith("Basic ")) return null;
  try {
    const [user, pass] = Buffer.from(header.slice(6), "base64")
      .toString("utf8")
      .split(":");
    return { user, pass };
  } catch {
    return null;
  }
}

function fullAuth(req, res, next) {
  const c = parseBasic(req.get("authorization"));
  if (c && c.user === USERNAME && c.pass === PASSWORD) return next();
  res.set("WWW-Authenticate", 'Basic realm="GR Travel Planner"');
  return res.status(401).send("Authentication required");
}

// GET data is allowed with either the admin password OR a valid read key.
function readAuth(req, res, next) {
  if (READ_KEY) {
    const key = req.query.key || req.get("x-read-key");
    if (key && key === READ_KEY) {
      req.readonly = true;
      return next();
    }
  }
  return fullAuth(req, res, next);
}

// ---- health (open) -----------------------------------------------------
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// ---- open static assets (css/js) + present shell -----------------------
// These contain no data, only the app shell; trip data always comes from /api.
app.use("/css", express.static(path.join(__dirname, "public", "css")));
app.use("/js", express.static(path.join(__dirname, "public", "js")));
app.use("/vendor", express.static(path.join(__dirname, "public", "vendor")));
app.get("/present", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "present.html"))
);

// ---- JSON API ----------------------------------------------------------
app.get("/api/trips", fullAuth, (_req, res) => res.json(store.listTrips()));

app.get("/api/trips/:id", readAuth, (req, res) => {
  const trip = store.getTrip(req.params.id);
  if (!trip) return res.status(404).json({ error: "not found" });
  res.json(trip);
});

app.post("/api/trips", fullAuth, (req, res) => {
  const trip = req.body;
  if (!trip || !trip.id || !trip.title)
    return res.status(400).json({ error: "id and title are required" });
  if (store.getTrip(trip.id))
    return res.status(409).json({ error: "a trip with that id already exists" });
  res.status(201).json(store.saveTrip(trip));
});

app.put("/api/trips/:id", fullAuth, (req, res) => {
  const trip = req.body;
  if (!trip || !trip.title)
    return res.status(400).json({ error: "title is required" });
  trip.id = req.params.id;
  res.json(store.saveTrip(trip));
});

app.delete("/api/trips/:id", fullAuth, (req, res) => {
  res.json({ deleted: store.deleteTrip(req.params.id) });
});

// ---- authed app pages --------------------------------------------------
app.get("/", fullAuth, (_req, res) =>
  res.sendFile(path.join(__dirname, "views", "index.html"))
);
app.get("/trip/:id", fullAuth, (_req, res) =>
  res.sendFile(path.join(__dirname, "views", "trip.html"))
);

// ---- boot --------------------------------------------------------------
store.seedIfEmpty();
app.listen(PORT, () => {
  console.log(`🌍 GR Travel Planner listening on :${PORT}`);
  console.log(`   data dir: ${store.DATA_DIR}`);
  console.log(`   read key: ${READ_KEY ? "enabled" : "disabled"}`);
});
