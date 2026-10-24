"use strict";
/**
 * Trip attachments — files stored on the DATA_DIR volume.
 *
 *   <DATA_DIR>/files/<tripId>/<fileId>__<safeName>
 *
 * The trip JSON keeps only the metadata on each item, e.g. a flight:
 *   files: [{ id, name, size, type, addedAt }]
 * Upload first (POST, returns the metadata), then the editor saves the trip with
 * that metadata on the item. All routes sit behind the app's bearer-token auth.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per file

// Allowed types by extension → served Content-Type. Anything else is refused.
const TYPES = {
  pdf: "application/pdf",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", heic: "image/heic", heif: "image/heif",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", csv: "text/csv",
  eml: "message/rfc822", msg: "application/vnd.ms-outlook",
  ics: "text/calendar",
};
// Types a browser can show safely in a tab; everything else is downloaded.
const INLINE = new Set(["pdf", "jpg", "jpeg", "png", "gif", "webp", "txt"]);

const extOf = (name) => (/\.([a-z0-9]+)$/i.exec(name || "") || [])[1]?.toLowerCase() || "";
const safeTrip = (id) => String(id || "").replace(/[^a-z0-9\-_]/gi, "");
const safeFileId = (id) => (/^[a-f0-9]{24}$/.test(String(id)) ? String(id) : "");
function safeName(name) {
  const base = path.basename(String(name || "file")).replace(/[^\w.\- ()]+/g, "_").replace(/\s+/g, " ").trim();
  return (base || "file").slice(0, 120);
}

module.exports = function mountFiles(app, auth, DATA_DIR, store) {
  const ROOT = path.join(DATA_DIR, "files");
  const tripDir = (tripId) => path.join(ROOT, safeTrip(tripId));
  function findFile(tripId, fileId) {
    const dir = tripDir(tripId), fid = safeFileId(fileId);
    if (!fid || !fs.existsSync(dir)) return null;
    const hit = fs.readdirSync(dir).find((f) => f.startsWith(fid + "__"));
    return hit ? { full: path.join(dir, hit), name: hit.slice(fid.length + 2) } : null;
  }

  // Upload one file. Body is the raw file; the name comes in X-File-Name (URI-encoded).
  app.post(
    "/api/trips/:id/files",
    auth,
    require("express").raw({ type: () => true, limit: MAX_BYTES }),
    (req, res) => {
      if (!safeTrip(req.params.id) || !store.getTrip(req.params.id))
        return res.status(404).json({ error: "trip not found" });
      let name;
      try { name = decodeURIComponent(req.get("x-file-name") || ""); } catch (e) { name = ""; }
      name = safeName(name);
      const ext = extOf(name);
      if (!TYPES[ext])
        return res.status(415).json({ error: `“.${ext || "?"}” files aren't allowed. Use PDF, images, Office documents, emails or text.` });
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: "empty file" });
      const id = crypto.randomBytes(12).toString("hex");
      fs.mkdirSync(tripDir(req.params.id), { recursive: true });
      fs.writeFileSync(path.join(tripDir(req.params.id), `${id}__${name}`), buf);
      res.status(201).json({ id, name, size: buf.length, type: TYPES[ext], addedAt: new Date().toISOString() });
    }
  );

  // Download / view one file.
  app.get("/api/trips/:id/files/:fileId", auth, (req, res) => {
    const f = findFile(req.params.id, req.params.fileId);
    if (!f) return res.status(404).json({ error: "file not found" });
    const ext = extOf(f.name);
    res.setHeader("Content-Type", TYPES[ext] || "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Disposition",
      `${INLINE.has(ext) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`
    );
    fs.createReadStream(f.full).pipe(res);
  });

  // Delete one file.
  app.delete("/api/trips/:id/files/:fileId", auth, (req, res) => {
    const f = findFile(req.params.id, req.params.fileId);
    if (f) fs.unlinkSync(f.full);
    res.json({ deleted: !!f });
  });

  // Upload errors (too large etc.) as JSON.
  app.use("/api/trips/:id/files", (err, _req, res, next) => {
    if (err && err.type === "entity.too.large")
      return res.status(413).json({ error: "File is larger than 25 MB." });
    next(err);
  });

  return {
    // Remove every attachment for a trip (used when the trip itself is deleted).
    removeTrip(tripId) {
      const dir = tripDir(tripId);
      if (safeTrip(tripId) && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    },
    INLINE: [...INLINE],
  };
};
