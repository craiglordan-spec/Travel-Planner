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
| `APP_READ_KEY`  | Optional read-only key for sharing `/present` links  | *(disabled)*   |

On first boot, any itineraries in `./seed` are copied into `DATA_DIR` if not
already present, so a fresh deploy starts with content (the Africa 2027 trip).

## Routes

- `/` — trips list (auth)
- `/trip/:id` — trip route map + editor (auth)
- `/present?id=:id[&key=READ_KEY]` — client-facing present view (open with key)
- `/api/trips`, `/api/trips/:id` — JSON API (GET, POST, PUT, DELETE)
- `/healthz` — health check

## Deploy (Railway)

Push to GitHub `main`; Railway builds with Railpack and auto-deploys. Mount a
volume at the `DATA_DIR` path (e.g. `/data`) so trips persist across deploys,
and set `APP_USERNAME` / `APP_PASSWORD` (and optionally `APP_READ_KEY`).

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
