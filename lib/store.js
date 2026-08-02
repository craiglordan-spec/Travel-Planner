"use strict";
/**
 * Tiny JSON-file store, persisted to the DATA_DIR volume (matches the
 * Invoice Desk pattern: JSON/CSV files on a mounted /data volume rather
 * than a managed database). Each trip is one file: <DATA_DIR>/trips/<id>.json
 *
 * On first boot, any itineraries shipped in ./seed are copied into the
 * volume if they are not already present, so a fresh deploy has content.
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const TRIPS_DIR = path.join(DATA_DIR, "trips");
const SEED_DIR = path.join(__dirname, "..", "seed");

function ensureDirs() {
  fs.mkdirSync(TRIPS_DIR, { recursive: true });
}

function seedIfEmpty() {
  ensureDirs();
  if (!fs.existsSync(SEED_DIR)) return;
  for (const file of fs.readdirSync(SEED_DIR)) {
    if (!file.endsWith(".json")) continue;
    const dest = path.join(TRIPS_DIR, file);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(path.join(SEED_DIR, file), dest);
      console.log(`🌱 Seeded trip: ${file}`);
    }
  }
}

function tripPath(id) {
  // guard against path traversal — ids are slugs only
  const safe = String(id).replace(/[^a-z0-9\-_]/gi, "");
  return path.join(TRIPS_DIR, `${safe}.json`);
}

function listTrips() {
  ensureDirs();
  return fs
    .readdirSync(TRIPS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const t = JSON.parse(fs.readFileSync(path.join(TRIPS_DIR, f), "utf8"));
        return {
          id: t.id,
          title: t.title,
          subtitle: t.subtitle || "",
          when: t.when || "",
          stops: Array.isArray(t.stops) ? t.stops.length : 0,
          updatedAt: t.updatedAt || null,
        };
      } catch (e) {
        console.error(`Could not read ${f}:`, e.message);
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
}

function getTrip(id) {
  const p = tripPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function saveTrip(trip) {
  ensureDirs();
  if (!trip.id) throw new Error("trip.id is required");
  trip.updatedAt = new Date().toISOString();
  fs.writeFileSync(tripPath(trip.id), JSON.stringify(trip, null, 2));
  return trip;
}

function deleteTrip(id) {
  const p = tripPath(id);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    return true;
  }
  return false;
}

module.exports = {
  DATA_DIR,
  seedIfEmpty,
  listTrips,
  getTrip,
  saveTrip,
  deleteTrip,
};
