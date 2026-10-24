"use strict";
/**
 * GR Travel Planner — Node/Express web service.
 * Matches the Invoice Desk / GR-Scheduler deployment pattern:
 *   - single web service, listens on process.env.PORT (Railway sets it; 8080 default)
 *   - JSON data persisted on a mounted volume at DATA_DIR (/data in prod)
 *   - token-based login (mirrors GR-Scheduler): POST /auth/login issues a bearer
 *     token; the SPA stores it and sends it as `Authorization: Bearer <token>`.
 *     Credentials come from APP_USERNAME / APP_PASSWORD (single shared login).
 *   - built by Railpack from package.json (no Dockerfile), auto-deploy on push
 */
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const store = require("./lib/store");

const app = express();
const PORT = process.env.PORT || 8080;

const USERNAME = process.env.APP_USERNAME || "admin";
const PASSWORD = process.env.APP_PASSWORD || "changeme";

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

// ---- auth (token-based, like GR-Scheduler) -----------------------------
// In-memory token store: token -> { username, at }. Tokens live for the life of
// the process (a restart/redeploy signs everyone out — same as the Scheduler).
const tokens = new Map();

function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

function auth(req, res, next) {
  const t = bearer(req);
  const s = t && tokens.get(t);
  if (!s) return res.status(401).json({ error: "Not authenticated" });
  req.user = s;
  next();
}

app.post("/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username !== USERNAME || password !== PASSWORD)
    return res.status(401).json({ error: "Invalid username or password" });
  const token = crypto.randomBytes(24).toString("hex");
  tokens.set(token, { username, at: Date.now() });
  res.json({ token, username });
});

app.post("/auth/logout", (req, res) => {
  const t = bearer(req);
  if (t) tokens.delete(t);
  res.json({ ok: true });
});

// Lightweight "who am I" — the SPA calls this on load to validate a stored token.
app.get("/api/me", auth, (req, res) => res.json({ username: req.user.username }));

// ---- health (open) -----------------------------------------------------
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// ---- monthly off-site backup (key-protected export of the data volume — trips
// and attachments). Same module as InvoiceDesk/ExpenseDesk/Pipeline/Scheduler;
// off unless BACKUP_KEY is set. See backup-export.js.
require("./backup-export")(app, store.DATA_DIR, "Travel-Planner");

// ---- open static assets (css/js/vendor) --------------------------------
// These are the app shell only — no trip data. All trip data comes from /api,
// which requires a valid token. The page shells render the login screen first.
app.use("/css", express.static(path.join(__dirname, "public", "css")));
app.use("/js", express.static(path.join(__dirname, "public", "js")));
app.use("/vendor", express.static(path.join(__dirname, "public", "vendor")));

// ---- JSON API (all token-protected) ------------------------------------
app.get("/api/trips", auth, (_req, res) => res.json(store.listTrips()));

app.get("/api/trips/:id", auth, (req, res) => {
  const trip = store.getTrip(req.params.id);
  if (!trip) return res.status(404).json({ error: "not found" });
  res.json(trip);
});

app.post("/api/trips", auth, (req, res) => {
  const trip = req.body;
  if (!trip || !trip.id || !trip.title)
    return res.status(400).json({ error: "id and title are required" });
  if (store.getTrip(trip.id))
    return res.status(409).json({ error: "a trip with that id already exists" });
  res.status(201).json(store.saveTrip(trip));
});

app.put("/api/trips/:id", auth, (req, res) => {
  const trip = req.body;
  if (!trip || !trip.title)
    return res.status(400).json({ error: "title is required" });
  trip.id = req.params.id;
  res.json(store.saveTrip(trip));
});

app.delete("/api/trips/:id", auth, (req, res) => {
  const deleted = store.deleteTrip(req.params.id);
  if (deleted) files.removeTrip(req.params.id);
  res.json({ deleted });
});

// ---- attachments (flights, stays, activities, ideas, stops, legs) — see lib/files.js ----
const files = require("./lib/files")(app, auth, store.DATA_DIR, store);

// ---- app pages (served openly; the SPA gates them with the login screen) --
app.get("/", (_req, res) =>
  res.sendFile(path.join(__dirname, "views", "index.html"))
);
app.get("/trip/:id", (_req, res) =>
  res.sendFile(path.join(__dirname, "views", "trip.html"))
);
app.get("/present", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "present.html"))
);

// ---- boot --------------------------------------------------------------
store.seedIfEmpty();
app.listen(PORT, () => {
  console.log(`🌍 GR Travel Planner listening on :${PORT}`);
  console.log(`   data dir: ${store.DATA_DIR}`);
  console.log(`   auth: token login as "${USERNAME}"`);
});
