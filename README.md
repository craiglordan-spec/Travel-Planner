# GR Travel Planner

Gravel Road's map-driven travel **planning & presentation** tool. Multi-trip
itineraries rendered on an interactive map (satellite / terrain / light), with
curved flight legs, approximate park outlines, a play-route animation, and a
clean client-facing **present mode**.

Built to match the Invoice Desk deployment pattern: a single **Node/Express**
web service, built by **Railpack** (no Dockerfile), deployed from GitHub with
auto-deploy on push, storing data as **JSON files on a mounted volume**.

## Run locally

```bash
npm install
npm start
# open http://localhost:8080  (default login: admin / changeme)
```

## Configuration (environment variables)

| Variable        | Purpose                                              | Default        |
|-----------------|------------------------------------------------------|----------------|
| `PORT`          | Port to listen on (Railway sets this)                | `8080`         |
| `DATA_DIR`      | Directory for persisted trip JSON (mount a volume)   | `./data`       |
| `APP_USERNAME`  | Basic-auth username for the planner                  | `admin`        |
| `APP_PASSWORD`  | Basic-auth password                                  | `changeme`     |
| `BACKUP_KEY`    | Shared GR backup key — enables `/backup-export/*` for the monthly backup (same value as the other GR apps) | *(off)* |

On first boot, any itineraries in `./seed` are copied into `DATA_DIR` if not
already present, so a fresh deploy starts with content (the Africa 2027 trip).

## Routes

- `/` — trips list (auth)
- `/trip/:id` — trip route map + editor (auth)
- `/present?id=:id` — client-facing present view (requires the planner sign-in)
- `/api/trips`, `/api/trips/:id` — JSON API (GET, POST, PUT, DELETE)
- `/api/trips/:id/files` — attachments (POST raw file with `X-File-Name`; `GET`/`DELETE` `/api/trips/:id/files/:fileId`), token-protected

## Attachments

Flights, stays, activities and ideas can carry files (tickets, confirmations,
vouchers, screenshots). Files live on the volume at
`<DATA_DIR>/files/<tripId>/<fileId>__<name>`; the trip JSON keeps only
`files: [{ id, name, size, type, addedAt }]` on each item. Allowed: PDF, images,
Office documents, email (.eml/.msg), text/CSV, .ics — up to 25 MB each.
Removing a file, deleting an item or deleting a trip removes the stored files;
uploads abandoned in the editor (closed without saving) are removed too.
- `/healthz` — health check

## Deploy (Railway)

Push to GitHub `main`; Railway builds with Railpack and auto-deploys. Mount a
volume at the `DATA_DIR` path (e.g. `/data`) so trips persist across deploys,
and set `APP_USERNAME` / `APP_PASSWORD`.

## Data model (a trip)

```jsonc
{
  "id": "africa-2027",
  "title": "…", "subtitle": "…", "when": "August 2027",
  "center": [-14, 40], "zoom": 4,
  "stops": [{ "id","name","type","lat","lng","nights","highlights","lodge" }],
  "legs":  [{ "from","to","kind": "fly|transfer","label" }],
  "parks": [{ "name","coords": [[lat,lng], …] }]
}
```

`type` is one of `safari`, `beach`, `city`, `gateway` (controls pin colour).

## Flights drive the route map

Each flight has a departure date and an optional **arrival date** (`arrDate`) for
overnight / date-line flights. Its From / To text is turned into map points
(`route`): airport codes in brackets — "Sydney (SYD)" — are placed from the
bundled airport table (`public/vendor/airports.json`, airport data from
[OpenFlights](https://openflights.org/data.html), ODbL); names matching a trip
stop use that stop; anything else is looked up with OpenStreetMap Nominatim.
"Nairobi (NBO) → Masai Mara" is read as a connection. Coordinates can be
corrected in the flight editor's *Map route* section.

`public/js/route.js` lays the flights onto the route legs in order: a leg whose
From/To stops match a chain of flights is drawn through those airports with an
automatic label ("Qantas QF63 · 1–2 Aug"); legs without flights keep their
hand-drawn path; flights that match no leg are drawn as their own lighter arcs.
