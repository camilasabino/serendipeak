# Developer reference

Working reference for the repository: environment variables, backend commands and API behavior, the editorial Studio, photograph handling, catalog snapshots and the web app's scripts. For a product overview start with the [README](../../README.md); the production runbook is [docs/deployment.md](../deployment.md).

## Contracts and compatibility

The public API keeps the response shapes of the project's original (v1) implementation. Its contract fixtures are vendored in `contracts/v1/` byte for byte and protected by `contracts/v1.lock.json`; see [Frozen contracts](#frozen-contracts). Where SerendiPeak deliberately differs (owned photograph URLs, `continent`, `countries` and `region`), [Mountain endpoint](#mountain-endpoint) lists every difference.

## Environment

```sh
cp .env.example .env
```

| Variable                                                                        | Purpose                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`            | Local database container. Port `5434` avoids clashing with another PostgreSQL instance on the default alternative port `5433`.                                                                                                                                                                                      |
| `DATABASE_URL`                                                                  | Django database connection (`postgres://user:password@host:port/name`).                                                                                                                                                                                          |
| `APP_ENV`                                                                       | `development` enables `DEBUG`. Any other value, or none, is production.                                                                                                                                                                                          |
| `DJANGO_SECRET_KEY`                                                             | Django secret key. Required.                                                                                                                                                                                                                                     |
| `ALLOWED_HOSTS` | Comma separated host names. In production each must be a bare host name: no `*`, scheme, port, path or leading dot. Include the platform health-check host (`healthcheck.railway.app` on Railway) or the probe is rejected. |
| `GDAL_LIBRARY_PATH`, `GEOS_LIBRARY_PATH`                                        | Optional overrides for the GDAL and GEOS shared library paths. Set them only when Django cannot find the libraries, for example `/opt/homebrew/lib/libgdal.dylib` and `/opt/homebrew/lib/libgeos_c.dylib` on macOS with Homebrew. Leave unset on Linux.          |
| `CORS_ALLOWED_ORIGIN`                                                           | Exactly one frontend origin allowed by CORS. Wildcards and lists are rejected at startup.                                                                                                                                                                        |
| `WEB_ORIGIN`                                                                    | Origin of the web app, where the Studio sends editors for the visual camera editor. Required; independent of `CORS_ALLOWED_ORIGIN`. One bare origin (scheme, host, optional port: no path, credentials or trailing slash), `https` outside `APP_ENV=development`. |
| `PREVIEW_SIGNING_KEY` | Signs draft-preview tokens. Required; at least 32 characters and different from `DJANGO_SECRET_KEY`. Changing it ends every outstanding preview and nothing else. |
| `TRUSTED_PROXY_HOPS` | Optional, default `0`. How many reverse proxies in front of the service append to `X-Forwarded-For`; a non-negative integer. At `0` the header is ignored and the connection address is used for sign-in throttling. Behind a proxy that appends the client address, set the number of such proxies, or every visitor shares the proxy's address. A value above `0` is also what makes the service trust `X-Forwarded-Proto` and so recognise HTTPS; at `0` the header is ignored, because callers that reach the service without passing the edge could forge it. Never set it higher than the proxies that really exist: the header is client-controlled left of the trusted entries. |
| `CSRF_TRUSTED_ORIGINS` | Optional. Comma separated `https` origins (scheme and host, optional port; no wildcard, path or credentials) allowed to submit Studio forms. Needed only when `TRUSTED_PROXY_HOPS` is `0` behind a TLS-terminating proxy; `http` origins are accepted in development only. |
| `SECURE_SSL_REDIRECT` | Optional, `0` or `1`. Redirects plain HTTP to HTTPS, except `/healthz`. Defaults to `1` in production when `TRUSTED_PROXY_HOPS` is above `0`. Requesting it without a trusted proxy fails at startup, because the redirect would never end. |
| `SECURE_HSTS_SECONDS` | Optional, non-negative integer, default off. Sends `Strict-Transport-Security` for the host only (no subdomains, no preload). Browsers remember it for the whole period, so start low. Requires production and `TRUSTED_PROXY_HOPS` above `0`. |
| `MEDIA_STORE`                                                                   | Where photograph media lives: `filesystem` for local development and tests (rejected outside `APP_ENV=development`) or `s3` for an S3-compatible store such as Cloudflare R2. Required; nothing is inferred from other variables.                                |
| `MEDIA_ROOT`                                                                    | `filesystem` only. Media directory, relative to `services/api` (`.media` in `.env.example`, ignored by Git).                                                                                                                                                     |
| `MEDIA_PUBLIC_BASE_URL`                                                         | Base URL of the public renditions, without a trailing slash, query or fragment. Must be `https` outside `APP_ENV=development`.                                                                                                                                   |
| `MEDIA_S3_ENDPOINT_URL`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` | `s3` only. `https` endpoint and credentials, from the environment only.                                                                                                                                                                                          |
| `MEDIA_PUBLIC_BUCKET`, `MEDIA_ORIGINALS_BUCKET`                                 | `s3` only. Two different buckets: public renditions and private originals.                                                                                                                                                                                       |

### Production deployment

Production (`APP_ENV` anything but `development`) refuses to start unless HTTPS can be recognised: set `TRUSTED_PROXY_HOPS` to the number of proxies in front of the service, or list `CSRF_TRUSTED_ORIGINS`. Without one of them every Studio form post, including sign-in, would fail the CSRF origin check, because behind a TLS-terminating proxy Django sees plain HTTP.

Checklist for the Railway services:

- API: `DATABASE_URL`, `DJANGO_SECRET_KEY`, `PREVIEW_SIGNING_KEY` (different from the secret key), `ALLOWED_HOSTS` (the public API host plus `healthcheck.railway.app`), `TRUSTED_PROXY_HOPS=1`, `WEB_ORIGIN`, `CORS_ALLOWED_ORIGIN`, `MEDIA_STORE=s3` with its endpoint, credentials, buckets and `MEDIA_PUBLIC_BASE_URL`. Optionally `SECURE_HSTS_SECONDS`.
- Web: `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_CESIUM_ION_TOKEN` are inlined at build time (build arguments of the image), so set them before the build.
- `TRUSTED_PROXY_HOPS=1` is correct only while all of these hold: the API is reached from outside solely through Railway's HTTPS edge, which states `X-Forwarded-Proto: https` and redirects plain HTTP; the API service has no TCP proxy; and the only other callers on the project's private network are services you control, because they can send any header. Any other value of the header, `http` or a list such as `http, https`, makes the request insecure rather than secure, so a proxy that behaves differently breaks Studio form posts instead of weakening them. A proxy added in front of Railway's (a Cloudflare-proxied record for the API host, for example) raises the hop count to 2; see [docs/deployment.md](../deployment.md).
- Reach the API through the public HTTPS domain only. A TCP proxy would deliver plain HTTP without the forwarding headers.
- Whether a request is HTTPS is decided by Django alone, from `TRUSTED_PROXY_HOPS`. `gunicorn.conf.py` therefore sets `secure_scheme_headers = {}` and needs no `--forwarded-allow-ips`: with the default scheme headers and `*`, Gunicorn would mark a request secure from a header that a caller reaching the service without passing the edge could forge, and Django falls back to that when `TRUSTED_PROXY_HOPS` is `0`.
- The Studio's cookies are `Secure`, `HttpOnly`, `SameSite=Lax` and scoped to `/studio/`. The preview cookies are set by Next.js, which fixes them to `SameSite=None; Secure` in production, scoped to the previewed mountain and lasting 15 minutes.

#### Images

Each service has a `Dockerfile` in its own directory, and a platform that finds one builds with it (Railway root directories `services/api` and `apps/web`). GeoDjango loads GDAL and GEOS when it starts, and a platform build that only installs Python dependencies does not provide them, so the API image is the one place where the whole runtime is fixed. Both images run as an unprivileged user and start their server in exec form, so the server is PID 1 and receives the platform's `SIGTERM`.

| Image | Build | Start |
| ----- | ----- | ----- |
| API   | `uv sync --locked --no-dev` (fails when `uv.lock` is stale), then `collectstatic` with placeholder settings | `gunicorn config.wsgi:application` |
| Web   | `npm ci`, `npm run build` (copies the Cesium assets first), `npm run check:production-gate`, `npm prune --omit=dev` | `next start` |

```sh
docker build -t serendipeak-api services/api
docker build -t serendipeak-web \
  --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.com \
  --build-arg NEXT_PUBLIC_CESIUM_ION_TOKEN=<token> apps/web
```

- **API build versus runtime.** `collectstatic` needs no secret and no database: the settings validate the production environment when they load, so the Dockerfile gives them placeholders for that one command, and none reaches the image's environment. Every real variable is read when the container starts. Migrations belong to neither: run `python manage.py migrate --noinput` as the platform's pre-deploy command, or by hand.
- **Web build versus runtime.** Next inlines the `NEXT_PUBLIC_*` values into the browser bundle at build time, so they are build arguments, and changing one needs a new build. The build fails when `NEXT_PUBLIC_API_BASE_URL` is not an `https` origin or `NEXT_PUBLIC_CESIUM_ION_TOKEN` is empty. `PORT` is the only runtime variable.
- **Static files.** `collectstatic` gathers the Studio's stylesheet, fonts, brand image and scripts into `services/api/staticfiles/` (ignored by Git) under content-hashed names, and `WhiteNoiseMiddleware` (second in the stack, production only) serves them with a one-year `immutable` cache and gzip. They must be collected before the process starts, which the image build does. Static requests never reach the Studio's `no-store` headers or sign-in checks, and they follow the same HTTPS redirect as every other path.
- **Gunicorn** is configured in `gunicorn.conf.py`, which it reads from the working directory. It binds `[::]:$PORT` (the IPv6 wildcard also accepts IPv4 and the private network), runs the `gthread` worker class with `WEB_CONCURRENCY` workers (default 2) of 4 threads, allows 120 s per request so a photograph upload is not cut off, gives in-flight requests 30 s to finish after `SIGTERM`, and opens no control socket. One photograph upload decodes up to about 0.6 GiB above the idle worker, so size the service memory for the uploads that can overlap (2 GiB for two editors).
- **Development is unchanged.** With `APP_ENV=development` there is no WhiteNoise and no collected directory: `runserver` serves the app's static files through `django.contrib.staticfiles`, and Gunicorn is not involved.

The step-by-step procedure for a first production deployment, with its checks and recovery paths, is in [docs/deployment.md](../deployment.md).

Django does not load `.env` by itself. Run backend commands with `uv run --env-file ../../.env ...` from `services/api`, or export the variables in your shell.

## Database

```sh
docker compose up -d --wait
docker compose down
```

The compose project is `serendipeak-v2` and data lives in the named volume `serendipeak-v2_db-data`. `docker compose down -v` deletes that volume.

## Backend

```sh
cd services/api
uv sync
uv run --env-file ../../.env python manage.py check
uv run --env-file ../../.env python manage.py migrate
uv run --env-file ../../.env python manage.py load_catalog_snapshot --input <file> --sha256 <hash>  # first run only, see Catalog snapshot
uv run --env-file ../../.env python manage.py runserver
```

`runserver` listens on `localhost:8000`.

### Health endpoint

`GET /healthz` returns `200 {"status":"ok"}` when the database answers and `503 {"status":"database unavailable"}` otherwise. It does not use the API error envelope.

```sh
curl -i http://127.0.0.1:8000/healthz
```

### Mountain endpoint

`GET /api/v1/mountains/{slug}` returns an `active` or `inactive` mountain as JSON (`application/json; charset=utf-8`), in the shape of `contracts/v1/mountain-*.json`: camelCase members, members without a value omitted (never `null`), `continent`, `countries` and `region` always present (`region` is `null` without one). The lookup is exact and case-sensitive. A `draft` mountain, an unknown slug and a slug that breaks the slug rule answer `404 {"error":{"code":"MOUNTAIN_NOT_FOUND","message":"Mountain not found"}}`; any other failure answers `500` with code `INTERNAL_ERROR` and never its cause, which is logged with its traceback. The endpoint sends no `Cache-Control` header and answers JSON whatever the `Accept` header asks for. `today` and `random` are reserved words, never routed to this endpoint.

```sh
curl -i http://127.0.0.1:8000/api/v1/mountains/aconcagua
node scripts/verify-api.mjs http://127.0.0.1:8000
```

#### Photograph delivery

The shape of `primaryImage` is the v1 shape. Its photograph is the one SerendiPeak stores (see Photograph media), so two member values differ from v1, which pointed at Wikimedia hosts:

- `url` is the public URL of the viewer rendition, `{MEDIA_PUBLIC_BASE_URL}/{viewer key}`.
- `thumbnailUrl` is the public URL of the page rendition, `{MEDIA_PUBLIC_BASE_URL}/{page key}`. It is always present.

`width` and `height` keep describing the oriented original (the renditions keep its ratio and never exceed its size). The photograph's credit is one `author`; `sourcePageUrl`, `license` and `licenseUrl` are optional provenance.

SerendiPeak's `primaryImage` has no `attribution`, `creator` or `sourceIdentifier`: one `author` is the credit shown to visitors, and the Commons file title is not part of the contract. `sourcePageUrl`, `license` and `licenseUrl` are omitted when the photograph has none, so a photograph needs neither a source page nor a license to be served. Apart from the members named in this section, every member and every endpoint keeps the v1 shape. Storage keys, buckets, checksums and the original's location are never in a response. A photograph that has no media yet is served as a mountain without `primaryImage`, which v1 allows; `check_catalog` and `check_photograph_media` report it, so it must not reach a served environment. The API makes no outbound request: URLs are derived from the stored keys and the configured base.

A mountain serves no `prominenceMeters` and no `sources.wikipedia`: nothing renders the prominence, and the Wikidata item (`sources.wikidata`) is the language-independent reference that stays. `sources` is omitted when the mountain has neither a Wikidata id nor an OpenStreetMap node. The catalog stores one `osm_node_id`, a positive integer, because a summit is an OpenStreetMap node; `sources.osm` is `https://www.openstreetmap.org/node/{osm_node_id}`, the same URL as in the v1 fixtures.

A mountain serves `continent` as `{code, name}` and `countries` as a list of `{code, name}`, which v1 did not: v1 listed country names as text and had no continent. `continent` is always present; `countries` is always present and may be empty (a new draft can have none). Countries are ordered by English name in code point order, then by code. The `code` is the stable key (an approved continent code `AF AN AS EU NA OC SA`, an ISO 3166-1 alpha-2 country code) and `name` is the English name; the Spanish and Portuguese names are stored but not served, and the API and the web are English-only. The three Antarctic mountains, which v1 left without a country, now link `AQ`. `region` is `{slug, name, ancestors: [{slug, name}]}` or `null`, always present; `ancestors` run from the root to the immediate parent, so the full path is `ancestors` followed by the region, and `name` is the English name. The internal id, the children, Wikidata ids and Spanish and Portuguese names are not served. `rangeName` is gone: the flat range became a region. See Geography and reference data.

The v1 fixtures stay untouched. The API tests turn each fixture into SerendiPeak's own document by applying exactly these changes, and compare every response with the result member by member: `primaryImage.url` and `primaryImage.thumbnailUrl` hold owned media URLs, `attribution` is renamed `author`, and `creator` and `sourceIdentifier` are dropped, and `prominenceMeters` and `sources.wikipedia` are dropped (`sources` goes with them when nothing is left), and `continent` and the `{code, name}` countries are derived from the v1 country names by a rule that exists only in the tests and is not editorial (the names through the alias table, the continent of the first country, `AQ` and Antarctica for a mountain without any, and an explicit synthetic Europe for the invented mountain of `mountain-minimal.json`), and `rangeName` becomes a `region` by another rule that exists only in the tests (a root region named by the range, its slug the plain derivation of the name, or `null`); hierarchies are tested with invented taxonomies. Any other difference fails. `node scripts/verify-api.mjs` is the live-API counterpart of the vendored `contracts/v1/verify-api.mjs`, which describes the v1 API and is no longer run: it differs from it only in those members, fails when `prominenceMeters`, `sources.wikipedia` or `rangeName` is served or `countries` are served as names, checks the shape of `continent`, `countries` (an approved continent code, well-formed unique country codes, the order above) and `region` (present, `null` or `{slug, name, ancestors}` with valid slugs), and checks each of the 73 photographs by source page and dimensions. With `--geography <file> --geography-sha256 <hash>` it also compares the continent, country codes and region path of the mountains the private geography input covers; without them it says that the comparison of values was skipped.

### Mountain index endpoint

`GET /api/v1/mountains` returns every `active` mountain as `{"mountains":[...]}`, ordered by slug code points. Each entry is `{slug, name, coordinates: {latitude, longitude}, elevationMeters, continent: {code, name}, countries: [{code, name}], region}`, with the same values and rules as the same members of the mountain endpoint (`region` is `null` without one, `countries` may be empty). Every member is always present. It is the part of a mountain that names and locates it, for search and for anything that places every mountain on a map.

- `draft` and `inactive` mountains are never listed. An `inactive` mountain stays reachable at its permalink, but it is no longer offered for discovery.
- The entry serves no `id`, summary, camera, photograph, sources or status. Spanish and Portuguese names are not served, as everywhere else in the API.
- An empty catalog answers `200 {"mountains":[]}`. Any failure answers `500` with code `INTERNAL_ERROR`.
- A successful answer carries `Cache-Control: public, max-age=300`, so a published or deactivated mountain reaches visitors within five minutes without a deployment. Errors carry `Cache-Control: no-store`.
- The whole index is read in three queries whatever the catalog size: the mountains with their continent, their country links, and the region paths (none without a region).

The full index is about 300 bytes per mountain: 22 KB for 75 mountains, under 5 KB gzipped. Returning it whole stays reasonable up to a few thousand mountains (about 1 MB uncompressed, a few hundred KB compressed). Past that, the simplest step is to keep this shape and add optional filters that reuse it (`?continent=`, a bounding box `?bbox=` answered with a PostGIS index on `location`), then cursor pagination ordered by slug; full-text search belongs in a separate endpoint only when client-side filtering of names is no longer instant.

```sh
curl -i http://127.0.0.1:8000/api/v1/mountains
```

### Today's mountain endpoint

`GET /api/v1/mountains/today` returns `{"date":"YYYY-MM-DD","mountain":{...}}` in the shape of `contracts/v1/daily-mountain.json`, where `date` is the current UTC calendar date and `mountain` has the shape of the mountain endpoint.

- The first request of a UTC date chooses the mountain and stores it in `daily_discovery`; every later request of that date, after restarts too, returns the stored mountain, even when that mountain has been deactivated since. Stored discoveries are never changed or deleted.
- A new date chooses among the `active` mountains only, leaving out those chosen in the previous 30 UTC dates unless that leaves none, in which case every active mountain is eligible again. The choice is the SHA-256 of the ISO date, first 8 bytes as a big-endian integer, modulo the number of candidates sorted by slug code points.
- Concurrent first requests of a date store exactly one discovery and all answer it: the date is the table's primary key, and the insert is a single autocommitted `INSERT ... ON CONFLICT DO NOTHING` followed by a re-read of the stored row. There are no locks and no retries.
- With no `active` mountain, a new date answers `503 {"error":{"code":"NO_ELIGIBLE_MOUNTAINS","message":"No mountains are available for discovery"}}` and stores nothing; any other failure answers `500` with code `INTERNAL_ERROR`.
- Every answer, errors included, carries `Cache-Control: no-store`.

Requesting `today` writes to the database on a new date, so `scripts/verify-api.mjs` skips it unless `--include-stateful-today` is passed; pass it only against a disposable database.

```sh
curl -i http://127.0.0.1:8000/api/v1/mountains/today
node scripts/verify-api.mjs http://127.0.0.1:8000 --include-stateful-today
```

### Random mountain endpoint

`GET /api/v1/mountains/random[?exclude=<slug>]` returns one `active` mountain in the shape of the mountain endpoint, with no wrapper. Consecutive calls may return the same mountain.

- `exclude` removes that mountain from the candidates while another `active` mountain exists. Only the first `exclude` value is read. An empty, unknown, `inactive` or `draft` slug has no effect, the match is exact (no trimming or case folding), and when the excluded mountain is the only `active` one it is returned. An exclusion never produces `404`.
- The candidates are the `active` mountains sorted by slug code points; the index comes from `secrets.randbelow`, injected into the use case as `pick_index`.
- The endpoint only reads: it never creates or changes a daily discovery.
- With no `active` mountain it answers `503 NO_ELIGIBLE_MOUNTAINS`; any other failure answers `500` with code `INTERNAL_ERROR`.
- Every answer, errors included, carries `Cache-Control: no-store`.

```sh
curl -i "http://127.0.0.1:8000/api/v1/mountains/random?exclude=aconcagua"
```

### CORS

Only the origin in `CORS_ALLOWED_ORIGIN` is allowed, never a wildcard. A request from that origin gets `Access-Control-Allow-Origin` with the origin echoed; any other origin gets no `Access-Control-*` header. Allowed methods are `GET` and `OPTIONS`. Every response, errors included, carries `Vary: Origin`. The status code of a preflight answer is not part of the contract; what it grants is.

Logs go to stderr: readable lines with `APP_ENV=development`, one JSON object per line otherwise. Django's warnings for `4xx` answers are not logged. An unexpected failure is logged once, with its traceback, by the API error handler; mapped errors (`404`, `503`) are expected answers and are not logged.

### Tests, formatting and lint

Tests run against the real PostGIS database from `docker compose`.

```sh
cd services/api
uv run --env-file ../../.env pytest
uv run ruff format --check .
uv run ruff check .
```

Use `uv run ruff format .` and `uv run ruff check --fix .` to apply fixes.

### Catalog snapshot

The PostgreSQL/PostGIS database is the canonical catalog, and mutable editorial data is not versioned in Git. An empty environment is initialized from a **private catalog snapshot**: a JSON file kept outside the repository, covered by the owner's backups and verified by checksum. Three commands read or write it; none takes a default path.

```sh
cd services/api
uv run --env-file ../../.env python manage.py export_catalog_snapshot --output <new file> \
  [--exclude-slug <slug>]... [--exclude-region <slug>]... [--include-discoveries]
uv run --env-file ../../.env python manage.py load_catalog_snapshot --input <file> --sha256 <hash>
uv run --env-file ../../.env python manage.py verify_catalog_snapshot --input <file> --sha256 <hash>
uv run --env-file ../../.env python manage.py check_catalog
```

**The file** (`serendipeak.catalog-snapshot`, version 1) holds the region taxonomy, every mountain (ids, slug, names and summaries in all languages, status, coordinates, elevation, continent and country codes, region, camera, OpenStreetMap and Wikidata ids, the photograph record with its media keys, checksum and dimensions, author, license and source page, and the creation and update timestamps) and, only when asked for, the daily discoveries. `content_sha256` is the SHA-256 of the canonical serialization of `content` (UTF-8, sorted keys, no whitespace), so it depends on the data and not on the file layout. Lists are in a fixed order, so the same catalog always yields the same checksum. Users, sessions, secrets, the continent and country reference rows (they come from the migrations) and the media objects themselves are not in it.

- `export_catalog_snapshot` is read-only on the database. It prints the source database, creates the file with owner-only permissions, never replaces an existing file and refuses a path inside the repository. A mountain or a region is left out only by naming its slug; every exclusion is reported, and so is any region left holding no mountain. A kept mountain or region that points at an excluded region is refused. It reads the document back against the reference data before writing, so a file that could not be loaded is never produced. It prints `content_sha256`, which every other command requires: record it with the file.
- `load_catalog_snapshot` stops before reading the database unless the file has exactly the given checksum. It prints the target database, then loads regions, mountains, country links, photographs and discoveries in one transaction under a lock on the `mountain` table. It refuses a database that already holds a mountain (a concurrent second load waits, then refuses) and a continent or country code the reference rows lack. The load is committed before the verification; when that reports differences, recreate the database, run `migrate` and load again.
- `verify_catalog_snapshot` compares the stored catalog with the file row by row, timestamps included, and writes nothing. Daily discoveries are compared only when the file carries them. It proves a fresh load, or the source a snapshot was exported from; later editorial changes are legitimate differences. Exporting the source again with the same options also reproduces the same checksum when nothing changed.
- `check_catalog` is the routine check: it reads every `active` mountain for a valid slug, coordinates in range, positive elevation, a curated camera with framing inside the bounds, a primary image with owned media, dimensions and an author, a license URL only with its license name, and a summary that follows the summary rules. It can run at any time.

**Initializing an environment** takes four steps: `migrate` (the full migration history builds the schema, the continent and country reference rows and the triggers), `create_editor`, `load_catalog_snapshot`, then `check_catalog` and `check_photograph_media --deep`. The media objects are copied between buckets separately; the snapshot lists their keys and checksums.

### Refreshing the local catalog from production

```sh
export OPERATOR_ENV=<operator environment file>   # once, in your shell profile
npm run db:refresh
```

The command replaces the local development catalog with the current production catalog, with no other step. It starts the local PostGIS if needed, opens the Railway tunnel itself and always closes it. `OPERATOR_ENV` is the private operator file described in [deployment.md](../deployment.md#operator-shell): outside the repository, mode 600, with the tunnel's `DATABASE_URL`.

1. **Production is only read.** Every production session has `default_transaction_read_only=on`, and the only commands that can run against it are the identity probe and `export_catalog_snapshot`, twice: the two files must be byte-identical (it retries if production changes meanwhile). Nothing is migrated or written there.
2. **Identities are checked first.** The linked Railway target must be `serendipeak/production`; the operator file must say `APP_ENV=production` and the local one `APP_ENV=development`; the local `DATABASE_URL` must be the compose database's published port; and the source and destination must be different PostgreSQL clusters. The command prints both.
3. **A candidate is built beside the live database**: a new database `<name>_refresh_<timestamp>` is migrated, loaded from the snapshot, verified with `verify_catalog_snapshot` and checked with `check_catalog`.
4. **The swap happens only after all of that passes.** The live database is renamed `<name>_pre_refresh_<timestamp>` and the candidate takes its name in one transaction. Connections to the old database (a running dev server) are closed and reconnect on their own. A last `check_catalog` runs on the new database; if it fails, the previous database is put back.
5. **Failures never touch the live database before the swap**, and the temporary database, the snapshot (a private directory under the system temporary directory, never in the repository) and the tunnel are removed on success, failure or Ctrl-C. The command never prints credentials. One run at a time.

Options (pass them after `--`): `--dry-run` does everything except the swap; `--restore <backup>` puts a backup made by this command back in place (the database it replaces is kept as `<name>_pre_restore_<timestamp>`); `--no-tunnel` uses a source already reachable at the operator file's `DATABASE_URL`; `--env-file <file>` replaces the repository's `.env` as the destination, which is how the tests point it at disposable databases. Backups are never deleted by the command; list them with `docker exec serendipeak-v2-db-1 psql -U serendipeak -d postgres -c '\l'` and drop the ones you no longer need.

**Local accounts survive.** A snapshot holds no users or sessions, so the command copies `app_user` and `django_session` from the previous local database into the new one (never from production), and checks the copy by checksum. Your Studio login and open sessions keep working. An account that only exists in production is not created: use `create_editor`.

**Photographs after a refresh.** The snapshot carries each photograph's media keys, not the objects. Local development reads photographs from its own store (the development buckets, or `.media`), so a photograph that production added or replaced after that store was seeded has no local object: the page and viewer renditions answer 404 and the stage shows no image. The command reports how many photographs are affected. To see them, copy the keys as in "Media transfer" of the [runbook](../deployment.md#media-transfer), or temporarily point `MEDIA_PUBLIC_BASE_URL` in `.env` at the production media host (read-only for viewing; do not upload photographs while it is set).

Local-only work is replaced by production's catalog: mountains created or edited only locally, and the local daily-discovery history (the snapshot carries none; today's pick is created again on the first request). All of it stays in the backup database.

### Daily discovery retention

Daily discoveries are kept for 365 days: a discovery is kept while its date is on or after today (UTC) minus 365 days, and older ones are deleted. The table is otherwise immutable, and the database enforces it: its trigger refuses every `UPDATE` and any `DELETE` of a row inside the window, judged by the database's own UTC date whatever the caller asks for. The 30-day window of the daily selection lies inside the retention window, so today's discovery and the history that excludes recent mountains are never affected. The trigger's constant mirrors `RETENTION_DAYS` in `serendipeak/discovery/retention.py`.

```bash
uv run --env-file ../../.env python manage.py prune_daily_discoveries
```

The command is one `DELETE` on the date key, idempotent, and prints how many rows it removed and the cutoff. It is not scheduled by the application: a production deployment must run it daily (for example a Railway cron service) or the table grows without bound. The public request path never prunes.

### Geography and reference data

Every mountain has one **continent** and any number of **countries**, both references to fixed reference tables, and its name and summary are stored per language.

- **Localized text.** `mountain.name_en`, `name_es`, `name_pt` and `summary_en`, `summary_es`, `summary_pt`. English is the required language: `name_en` is never blank and the summary rules (`summary_violations`, the publication gate) apply to `summary_en` exactly as they always applied to the summary. The Spanish and Portuguese columns are null or not blank, and a summary translation needs `summary_en` (`mountain_summary_translation_requires_english`). Nothing writes a translation, the API and the web serve the English text only, and a missing translation will read as English once a consumer selects a language. Ids, slugs and codes never depend on a language.
- **Continent.** Table `continent`, seven fixed rows with the codes `AF AN AS EU NA OC SA` and names in English, Spanish and Portuguese. `mountain.continent_code` is `NOT NULL` on every status and `PROTECT`ed. The continent of a mountain is an editorial, explicit assignment, never derived from its countries: the Canary Islands belong to Africa although Spain is in Europe. Convention for the Europe-Asia boundary: the Ural Mountains, the Ural River, the Caspian Sea and the crest of the Greater Caucasus, applied to the position of the summit, never to the country.
- **Country.** Table `country`, 249 rows keyed by ISO 3166-1 alpha-2 code, with names in the three languages, a unique English name and a reference continent (UN M49 as CLDR publishes it, except `AQ`, which is Antarctica). `mountain_country` links mountains to countries with the composite primary key `(mountain_id, country_code)`, both keys `PROTECT`ed, and an index for the reverse lookup. Countries are never inferred from coordinates. A country of a mountain is edited as a link; the reference rows have no write path in the application.
- **Region.** Table `mountain_region`: a hierarchy of any depth. Each region has a stable UUID `id`, a globally unique and immutable `slug`, a required `name_en`, optional `name_es` and `name_pt`, an optional unique `wikidata_id` and a nullable `parent_id`. `mountain.region_id` is nullable, indexed and `PROTECT`ed, and points at the most specific region known, which may be a root, an intermediate node or a leaf. Names are not identifiers: roots may share a name, different parents may share a child name, and siblings differ by name ignoring case (`mountain_region_sibling_name_key`). The database refuses a self-parent (CHECK), a cycle at any depth (a trigger walks the ancestors of the new parent under one transaction-level advisory lock, so two concurrent moves that would close a cycle together let exactly one succeed), a change of `id` or `slug` (a trigger), and the deletion of a region that has a child or a mountain (the foreign keys, for raw SQL as much as for the ORM). The ids of a loaded taxonomy are `uuid5` of the slug. The application side is `catalog/regions.py`: the entities, slug derivation (accents dropped, every other run of characters one hyphen), the path of a region with its ancestors root first, and the tree order and labels the Studio selector uses. Regions are written by four use cases, `CreateMountainRegion`, `UpdateMountainRegion`, `MoveMountainRegion` and `DeleteMountainRegion`, over one port. Every write starts a transaction, checks that it runs under READ COMMITTED (the cycle trigger refuses a re-parenting under any stricter level, because its walk would read a stale tree), takes the structure advisory lock and only then locks rows, so writers wait holding nothing and the application writers cannot deadlock with each other or with the trigger. A direct SQL update of `parent_id` locks the row before the trigger asks for the lock, so it can still deadlock with an application writer; PostgreSQL then aborts one of them (SQLSTATE 40P01), and no automatic retry is implemented. An update never carries the slug or the parent; a move refuses the region itself and its subtree, an unknown parent and a sibling-name collision; a deletion is refused with the number of child regions and mountains while any exist, and nothing is reassigned or cascaded. The taxonomy is first loaded by the conversion below.
- **Reading.** A mountain read by slug costs three queries: the mountain with its photograph and continent, its countries, and, when it has a region, one recursive query for the region and all its ancestors (the same single query serves any number of mountains and any depth). A mountain without a region costs two. The catalog snapshot adds one query for the whole region table.

#### Reference data

The continent and country rows are loaded by two immutable migrations, `0015_continent_reference` and `0016_country_reference`, generated by `services/api/tools/generate_geography_reference.py` (standard library only; nothing is fetched by the tool). The header of each migration records the sources, versions and the generator command:

- **Names:** Unicode CLDR 49.0.0, locales `en`, `es` and `pt`, territory display names in their standard form (npm packages `cldr-core` and `cldr-localenames-full`, whose registry integrity is in the header). CLDR's own spellings are kept, including the forms it uses to disambiguate ("Congo - Kinshasa", "Hong Kong SAR China", "Myanmar (Burma)"), its house style ("St.", "&") and its current names ("Türkiye"). The list of overrides in the generator is empty: a name is changed only by an explicit entry (code, language, CLDR value, chosen value, reason).
- **Codes:** the 249 officially assigned ISO 3166-1 alpha-2 codes as listed by Debian `iso-codes` 4.20.1 (`data/iso_3166-1.json`, pinned by its sha256). User-assigned, exceptionally reserved, transitionally reserved and deleted codes are excluded, and the tool stops if the count is not 249.
- **Reference continent of a country:** its UN M49 region in CLDR's `territoryContainment`, with the Americas split into South America and the rest (North and Central America and the Caribbean). Transcontinental countries take M49's placement of the whole country (Russia Europe; Kazakhstan, Türkiye, Georgia, Armenia, Azerbaijan, Cyprus, Indonesia and Timor-Leste Asia; Egypt Africa; Panama North America). Overseas territories with their own ISO code take their own placement (Réunion and Mayotte Africa, French Guiana South America, Greenland North America). Only `AQ` is overridden.
- **Adopting a newer release** is never automatic. Download the packages and the list once, change the pins in the generator, generate new migrations and review the diff like these. A code that ISO withdraws while a mountain still links it is refused by `PROTECT`, so the mountain needs an explicit editorial change first.

```sh
cd services/api
npm pack cldr-core@49.0.0 cldr-localenames-full@49.0.0   # then extract each into its own directory
uv run python tools/generate_geography_reference.py --cldr-core <dir> --cldr-names <dir> \
  --iso-codes <iso_3166-1.json> --retrieved-on <date> --output-dir serendipeak/persistence/migrations
```

#### The private geography input

Which continent a mountain is on, which countries it is in and the region taxonomy are editorial data, and mutable editorial data is not versioned in Git. It lives in the database and, for transfers and for initializing an empty environment, in a private, checksum-verified JSON file that is kept outside the repository and covered by the owner's backups. The tools take explicit paths and never default into the working tree.

```json
{
  "format": "serendipeak.geography",
  "version": 1,
  "content_sha256": "<sha256 of the canonical content>",
  "mountains": [
    { "id": "<uuid>", "slug": "<slug>", "continent": "<AF|AN|AS|EU|NA|OC|SA>", "countries": ["<ISO alpha-2>"],
      "region": "<region slug or null>" }
  ],
  "regions": [
    { "slug": "<slug>", "name_en": "<name>", "parent": "<slug of an earlier region or null>", "wikidata_id": null }
  ]
}
```

`content_sha256` is the SHA-256 of the canonical serialization (UTF-8, sorted keys, no whitespace) of everything but itself, and every command that reads the file also takes the expected checksum, which must match; otherwise it stops before it reads the database. The tracked parser (`catalog/geography_input.py`) validates the format, unique ids and slugs, approved continent codes, well-formed unique country codes known to the reference data, and, against a catalog, **coverage** (every mountain appears exactly once, matched by id and slug; an entry without a mountain aborts the run) and **agreement** (the countries of an entry map, through the alias table of the v1 country names, to the names the mountain still stores; `AQ` is the one link that needs no legacy name). Regions are validated on their own: valid unique slugs, a non-blank English name, parents listed before their children (which excludes cycles), Wikidata ids that are well formed and unique, sibling names that differ, every `region` of a mountain being listed, and no region that no mountain is in, directly or through a child. Against a catalog that still holds `range_name`, the name of a mountain's region has to equal its range name exactly (or both are absent), and the stored regions have to be exactly the input's.

- `prepare_geography_input --output <file>` is read-only. It writes a draft from the database: ids, slugs and countries (the v1 names mapped to codes while the catalog still holds them), the continents empty, one root region per distinct range name with a slug derived from it (two names that derive one slug stop the draft) and the checksum unset, so a draft can never be applied. The operator qualifies ambiguous slugs, places only the parents that are verified, orders parents first and fills in the continents. The operator fills in the continents and freezes the file by writing the checksum, which `catalog.geography_input.geography_content_sha256` computes.
- `apply_geography_backfill --input <file> --sha256 <hash> [--dry-run]` prints the target first (database, host, port, catalog migration) and then judges the input against the stored mountains. It runs in one transaction under a lock on the mountain table, writes only the continent, the country links, the regions it lacks and the region of each mountain (no other column and no timestamp), is idempotent and creates, deletes or edits no mountain. It never edits or deletes a stored region: a stored region that the input lacks or that differs from it stops the run. Until the region table exists it writes the continent and the links only and reports that the regions were left out. `--dry-run` reports every change and writes nothing. It refuses a schema that is not the one it is meant for, and once the migration that validates a part is applied (`0018` for the continents and countries, `0020` for the regions) it only reports that part.

#### Converting an existing database

Three stages, so that no migration carries editorial data and a database with mountains converts without losing any:

1. `migrate` up to `0017_mountain_continent`. The migrations carry the schema and the reference data only: `0014_localized_mountain_text` renames `name` and `summary` to the English columns and adds the others, `0015` and `0016` create and fill the reference tables and the link table, and `0017` adds a nullable `continent_code`. The legacy text array `countries` stays.
2. `apply_geography_backfill`, first with `--dry-run`, then for real.
3. `migrate` to the head. `0018_geography_final_validation` refuses, naming the mountains, while one has no continent or its links disagree with the legacy country names (through the alias table, with `AQ` accepted), and only then makes `continent_code` `NOT NULL` and drops the text array. On a database without mountains it passes on zero rows. Reversing restores the text array from the links in alphabetical order and refuses a country that v1 had no name for.

The regions follow the same three stages from `0018`: `migrate` to `0019_mountain_region` (an empty `mountain_region` table with its constraints and triggers and a nullable `region_id`; `range_name` stays), `apply_geography_backfill` (inserts the regions and sets `region_id` by the input, after checking that each region's name is the mountain's `range_name`), and `migrate` to the head: `0020_region_final_validation` refuses, naming the mountains, while a `range_name` has no region or its region has another name, and then drops `range_name` and its CHECK. Reversing `0020` gives each mountain the English name of its region as `range_name`; the hierarchy goes with the table when `0019` is reversed.

A database that is initialized from a catalog snapshot is built by `migrate` and `load_catalog_snapshot`, which also loads the regions.

### Editorial Studio

The Studio at `/studio/` is the only editorial interface. It edits the catalog in place; there is no other source of truth. Django's administration site is not installed and `/admin/` answers 404. The Studio sets session and CSRF cookies (`Secure` outside `APP_ENV=development`, `HttpOnly`, `SameSite=Lax`, path `/studio/`), sends `X-Frame-Options: DENY`, and loads no map tiles: coordinates are plain latitude and longitude fields. The public API is unaffected: it sets no cookies and no frame policy.

#### The Studio shell

`/studio/` is a server-rendered Django app served by the same process as the API. It offers sign in, sign out, change password, an overview page, the mountain screens (see The Studio mountain screens), the region screens, the user screens and the read-only record of the daily discoveries (see The other Studio screens).

- **Routes.** `/studio/` (overview), `/studio/login/`, `/studio/logout/` (POST only), `/studio/password/`. Signing out returns to the sign-in page with a short message; signing in returns to the page asked for when it is local, otherwise to the overview.
- **Authorization** is one middleware (`serendipeak.studio.middleware.StudioAccessMiddleware`), deny by default. Every Studio route declares who may call it (`public`, `viewer` meaning any active user, or `editor`) through `declare_access`; a route that declares nothing answers 403 and logs an error. An anonymous visitor is sent to the sign-in page, a Viewer is refused an Editor page with 403, and the role is read from the stored user on every request, so a deactivation or role change applies on the next request. `tests/studio/test_authorization_matrix.py` lists every Studio URL for anonymous, inactive, Viewer and Editor callers and fails when a URL is missing from it.
- **Sign-in throttling.** Each attempt with a username and a password is counted before the password is checked: at most 5 per username and 20 per client address in a sliding 15 minutes, otherwise the answer is HTTP 429 with the same message whether or not the account exists, even for the right password. A successful sign-in forgets the failures of that username. Refused attempts are not stored, so retrying does not extend the lockout. Attempts are kept in `login_attempt` for the window only, with a SHA-256 of the lowercased username (a password typed into the wrong field is never persisted). The per-username limit means anyone can lock a known username for 15 minutes; that is the accepted cost of stopping a targeted guess. The client address comes from `REMOTE_ADDR` unless `TRUSTED_PROXY_HOPS` says otherwise.
- **Sessions and CSRF.** Django's database sessions last 12 hours from sign-in (or from the last password change), the session key is replaced on sign-in, a password change ends the user's other sessions, and every Studio view is CSRF protected, with a failure page that stays inside the Studio. The session and CSRF cookies are named `studio_sessionid` and `studio_csrftoken` and have the path `/studio/`, so a browser sends them to no other path and the public API and `/healthz` never receive, read or set them. The names differ from the framework defaults on purpose: an earlier deployment issued `sessionid` and `csrftoken` for the whole site, and a browser still holding them would send both cookies of one name to the Studio, where the one with the wider path could shadow the new one. Under their own names the old cookies are never read, and `LegacyCookieCleanupMiddleware` expires them (path `/`) in the first Studio response that finds them; it acts on Studio paths only, because the public API must never set a cookie. Sessions that were open at the cutover end there: the editor signs in again.
- **Headers** on every response under `/studio/`: `X-Frame-Options: DENY`, `Content-Security-Policy` (`default-src 'none'`, same-origin styles, scripts and fonts, images from the media origin and `blob:` previews of a file the editor chose, `frame-ancestors 'none'`, `form-action 'self'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` (not `no-referrer`: browsers then send `Origin: null` on form posts, which the CSRF check refuses), `X-Robots-Tag: noindex, nofollow` and `Cache-Control: private, no-store`. The public API sets none of them. HSTS and secure-redirect settings belong to the production deployment.
- **Security log.** The logger `serendipeak.security` writes one structured line per event with identifiers only: `login_succeeded`, `login_failed`, `login_throttled`, `logout`, `password_changed`, `password_change_refused`, `publication_changed`, `access_denied`, `csrf_failed` and `undeclared_view`. Fields are user ids, roles, addresses, request paths and the digest of a typed username; never a password or a typed username. Logs are not an audit trail. `publication_changed` (user id, role, mountain slug and the new status, `published` or `unlisted`) is written by the Studio view after a publish, unlist or list-again succeeds; a refused or stale attempt writes nothing. Its coverage is the Studio only: a transition made by a management command or SQL is not logged by it.
- **Design.** Templates are in `serendipeak/studio/templates/studio/` (`base.html` and `components/`), the stylesheet in `serendipeak/studio/static/studio/studio.css`, and Spectral and Instrument Sans are self-hosted as WOFF2 with their licenses. The `--sp-*` brand tokens are copied from `apps/web/src/shell/tokens.css`; `tests/studio/test_design_system.py` fails if the two drift and checks contrast for text and controls. There is no inline style or script, which the content security policy would refuse. The only scripts are three small files served from the Studio's own static directory, loaded by the mountain form: `unsaved-changes.js`, `photograph-upload.js` and `country-filter.js`; every page works without them except the warning before leaving unsaved edits and the preview of a chosen photograph.

#### The Studio mountain screens

- **Routes.** `/studio/mountains/` (list), `/studio/mountains/<slug>/` (read-only page, Viewer and Editor), and for Editors only: `/studio/new-mountain/` (outside `mountains/` because every valid slug, `new` included, is a mountain's address there), `/studio/mountains/<slug>/edit/`, `.../publish/` and `.../list/` (POST only), `.../unlist/` (a confirmation page, then POST) and `.../delete/` (a confirmation page, then POST). A Viewer gets 403 on every Editor route and sees none of the controls.
- **Writes** go through the use cases only: `CreateMountain`, `UpdateMountain`, `ChangeMountainLocation`, `DeleteDraftMountain`, `PublishMountain`, `DeactivateMountain` and `ReactivateMountain`. The Studio imports no ORM and no persistence module. The forms judge the same domain rules before the call, and every refusal a use case can still raise (slug taken, a reference deleted meanwhile, the publication gate, a rejected or unstorable photograph) comes back as an error on the form with what was typed kept.
- **Not one transaction.** The content and the coordinates are two use cases. The content is saved first; if the move is then refused (a race), the page says that the other changes were saved and the coordinates were not.
- **Coordinates** follow the existing rules: a published mountain's are shown locked, a draft's or an unlisted mountain's change only with the camera-reset confirmation, because the saved camera is cleared.
- **The slug is the public address** of a published or unlisted mountain. It stays editable on every status, as before, and the form warns that changing it breaks links to the old address. There is no redirect history.
- **Photograph.** A file is uploaded with its credit; with a saved photograph, a replacement whose credit is unchanged needs the confirmation that the credit still applies; a changed credit alone keeps the file; only a draft offers removing the photograph. The file is processed by the use case when the mountain is saved, so a refused form stores nothing, and the browser keeps the chosen file (IndexedDB, one hour) to offer it again. Uploaded files that a refusal or a removal leaves behind stay in storage.
- **Status** is changed from the mountain page, which judges the saved mountain. Publishing and listing again are disabled while the page lists what is missing; unlisting asks first and says what it does.
- **Unsaved edits.** The form warns before the page is left with edits (and counts as unsaved when it comes back refused), and a second submission while the first is on its way is ignored.
- **Not covered:** concurrent editors are last write wins (the form carries no version token).
- **Camera.** The mountain page and the edit page offer **Edit camera visually** to Editors. It opens the editor on `WEB_ORIGIN` at `/editorial/camera`; **Save camera…** there navigates to the Studio confirmation, `/studio/mountains/<slug>/camera/?heading=…&pitch=…&range=…&fx=…&fy=…&lat=…&lon=…&mountain=<id>` (Editors only; the Studio is located by `NEXT_PUBLIC_API_BASE_URL`).
- **Preview.** A draft has **Preview** on its mountain page (Editors and Viewers) and on its edit page (held back while the form has unsaved edits, because the preview shows the saved mountain). `GET /studio/mountains/<slug>/preview/` signs a token for that one draft (15 minutes, read-only, valid for nothing else) and redirects to `WEB_ORIGIN/preview#token=…&slug=…`. The fragment never reaches a server, a log or a `Referer`; that page posts the token to its own `/api/preview`, which stores it in a Next.js Preview Mode cookie scoped to `/mountains/<slug>` and removes it from the address bar, then opens the real mountain page. That page's server calls `GET /api/v1/previews/mountain` with `Authorization: Bearer <token>`; the API verifies signature, expiry and scope and answers only for a mountain that is still a draft. Every refusal (forged, expired, wrong key, malformed, no header) is the same `401`; a deleted or since-published draft is the public `404`, and the web page then serves the public route. Preview responses are `private, no-store` with `X-Robots-Tag: noindex`; the page also carries a notice and `noindex`. A published or unlisted mountain gets no token (the mountain page offers **View on site**). The endpoint is not part of the public contract and the public routes still answer `404` for drafts. A token names no user, so a user deactivated within the 15 minutes keeps the preview until it expires.
  - The GET writes nothing: it compares the stored and the proposed camera and says whether the mountain is on the site. An unreadable or out-of-bounds proposal is answered with 400, the reason and no save button; one composed on other coordinates, or for another mountain than the one the address now names (slugs can be renamed), is refused (409 and 400 respectively) and never saved.
  - Saving is a CSRF-protected POST that carries the proposal, the camera the page showed and the coordinates and mountain it was composed for. It calls `ChangeMountainCamera`: the coordinates and the shown camera are compared exactly under the mountain row lock, so a mountain that moved or whose camera changed meanwhile writes nothing. A changed camera reopens the confirmation with the newer one; a moved mountain offers to reopen the editor on its new location. Success returns to the mountain page's camera section. Saves are not recorded in a history.
- **Trying the screens in a browser.** The environment file selects the development R2 buckets, and a photograph uploaded while exploring would stay there. From `services/api`, `uv run --env-file ../../.env python tools/studio_scratch_server.py [--port 8001]` starts the server with `MEDIA_STORE=filesystem` and a temporary `MEDIA_ROOT` that is deleted when it stops, and refuses to start unless the settings it will use report the filesystem store. It does not isolate the database: point `DATABASE_URL` at a scratch copy before creating or editing anything.

#### The other Studio screens

- **Regions.** `/studio/regions/` (tree, searchable by name in any language or by slug), `/studio/regions/<slug>/`, and for Editors `/studio/new-region/` (`?parent=<slug>` preselects the parent), `.../edit/`, `.../move/` and `.../delete/`. Create and edit take the English name, optional Spanish and Portuguese names (stored, not served by the API) and the Wikidata identifier; the slug is chosen on creation and immutable afterwards. A name that exists elsewhere stops the first submission with the existing regions listed. A move lists every region, with the unavailable ones disabled and the reason in the label, and asks for confirmation. A region with child regions or mountains cannot be deleted; the page shows what blocks it. The use cases and their locking are the ones of the region store; the Studio adds no write path of its own.
- **Users.** `/studio/users/` (Editors only), `/studio/users/<id>/` (role and active state) and `/studio/users/<id>/password/`. The access guards of Users and roles apply through the screen, and a form that shows an access a colleague changed meanwhile is refused instead of overwriting it. An Editor cannot set their own password there: the change-password page asks for the current one. There is no screen that creates, renames or deletes an account.
- **Daily discoveries.** `/studio/daily-discoveries/` (Viewer and Editor) is a read-only table of the last year: date, mountain, its status now and the recorded instant.

#### Users and roles

Accounts are `catalog.UserRecord` (`AUTH_USER_MODEL`, table `app_user`): a username, a hashed password, a role, an active flag, `last_login` and `date_joined`. There are no staff or superuser flags, groups, per-user permissions, names or email addresses. Django's session authentication, CSRF protection, password hashers (PBKDF2 by default), password validators and password views are used unchanged.

- **Roles.** An **Editor** reads and writes everything: mountains, publication, photographs, the camera and users. A **Viewer** reads the mountains and the daily discoveries and writes nothing, and does not see the users. Anonymous visitors and inactive users reach no Studio page and cannot sign in. Authorization is derived from the role on every request, so a role or active-state change takes effect on the user's next request. `django.contrib.auth` stays installed, so its permission and group tables exist and stay empty; no code reads them.
- **Usernames** are 3 to 32 lowercase letters, digits, dots, hyphens or underscores, starting with a letter or digit. The database enforces the format, so two usernames never differ only in case; sign-in folds the typed username to lowercase, so it is case-insensitive while the stored form stays canonical.
- **Passwords** need at least 8 characters and must not be common, entirely numeric or similar to the username; there are no composition rules (uppercase, digits, symbols). This is a deliberately light single-factor policy for local development, not a recommended policy for an internet-facing Studio. The Studio sign-in is throttled (see The Studio shell), and this policy and multi-factor authentication should be reviewed together before the Studio is exposed to the internet. Setting or changing a password writes only the password column, so it can never overwrite a concurrent role or active-state change. The same policy applies to a new user, to a password set for another user and to a user changing their own password; setting a new password ends the other sessions of that user.
- **Access guards.** An Editor cannot deactivate or change the role of their own account, only an active Editor can change anyone's access, and the last active Editor can never be demoted or deactivated. The check and the change run under one row lock on the accounts involved, so two Editors acting at the same time cannot leave the system without an Editor. Users are deactivated, never deleted.
- **Accounts are created and recovered from the command line.** The Studio has no screen that creates an account, and Django's administration site is not installed.
  - `manage.py create_editor <username>` creates an active Editor and `manage.py create_viewer <username>` an active Viewer. The password is read from `SERENDIPEAK_EDITOR_PASSWORD` (`SERENDIPEAK_VIEWER_PASSWORD` for a Viewer) when it is set and prompted for twice otherwise; it is never accepted as an argument. Each command refuses a taken username and leaves that user unchanged. Create the first Editor with `create_editor` after `migrate`; `createsuperuser` does not apply to this user model.
  - Passwords: an Editor sets another user's password in the Studio (Users) and anyone changes their own with the current one. When no Editor can sign in, `manage.py changepassword <username>` (Django's own command, prompted twice, same policy) sets the password of an existing account without touching its role or active state, and `create_editor` can add another Editor. A lockout from failed sign-ins ends by itself after 15 minutes.
- The `catalog` migration `0013_user_record_and_role_permissions` creates the user table and drops the former `publish_mountain` permission. A database that applied the administration site's migrations before it was removed keeps its `django_admin_log` table; nothing reads or writes it, and a fresh database never creates it.

- A mountain is created as a `draft` with every field the form offers. A draft is editable and never public: it is not served by slug, `today` or `random`. The status is never a form field.
- The mountain page has the sections Publication, Mountain (name, slug, latitude, longitude, elevation), Geography (continent, countries, region), Editorial (summary), Camera and a collapsed Additional data (OpenStreetMap node id, Wikidata id). The add page has no Publication and no Camera section.
- Mountain data stays editable on every status, except that an active mountain's coordinates are fixed (see below): name, coordinates, elevation, continent, countries, region, summary and the additional data. The continent is required on every mountain, drafts included, and is chosen from the seven continents; it is never derived from the countries. Countries are a selection over the 249 reference countries (`Name (CODE)`, searchable, ordered by English name); saving writes only the links that differ, in the same transaction as the mountain. A mountain may have none. A draft that still has countries cannot be deleted until they are removed, like a draft with a photograph. The name and summary are the English text; the Spanish and Portuguese columns exist but nothing writes them yet. The region is a select over the whole taxonomy in tree order (siblings by English name), every option labelled with its path from the root (`Root › Child › Grandchild`, with the slug added when two labels are equal) plus `No region`, and the choice may be any node. Regions are edited in the Studio; continents and countries are reference data and have no screen. Latitude and longitude are form fields; saving rebuilds the stored point from them.
- The slug is editable on every status and keeps its syntax, reserved-name and uniqueness checks. A slug change leaves no redirects or history.
- The camera is read-only in the mountain form, which never writes it, including on creation, so a draft starts without a camera; publication still needs one. The Camera section shows the stored values and whether they are complete and within bounds.
- **Changing the coordinates.** A camera is framed on the summit where it was composed, so it never outlives a move. The form compares the submitted latitude and longitude with the stored point, exactly, and the point is written only by the `ChangeMountainLocation` use case, never by the form's own update:
  - A draft or inactive mountain needs the **Clear the camera if the coordinates change** box ticked. Without it nothing is saved and the form says why. With it, one statement writes the new point and removes all five camera columns, framing included, in the same transaction as the rest of the save: a later failure, such as a photograph that cannot be stored, rolls the move back with it. The page then says that the camera must be configured again and links to the camera editor, which opens on the new location with no saved camera.
  - An active mountain's coordinates cannot change: unlist it first. The status is never changed on the way.
  - Unchanged coordinates, and edits to anything else, keep the camera whether or not the box is ticked. An inactive mountain without a camera can be edited, but it is reactivated, like a draft is published, only once a valid camera exists again.
- **Edit camera visually** (on the mountain page and the edit page, for Editors only) opens the camera editor on `WEB_ORIGIN` at `/editorial/camera`, with the mountain and its stored camera in the query because a draft has no public API. The editor renders the real stage, shows the live pose as it would be saved and, on **Save camera…**, navigates to the Studio confirmation (see The Studio, Camera) with the quantized camera (heading and pitch to two decimals, range to the meter, framing to four). It writes nothing itself and never navigates to an address taken from its query: the Studio is located by `NEXT_PUBLIC_API_BASE_URL`.
- The camera changes only through its confirmation page, `/studio/mountains/<slug>/camera/?heading=…&pitch=…&range=…&fx=…&fy=…&lat=…&lon=…&mountain=<id>`, which needs the Editor role and works on every status:
  - Opening it writes nothing. It compares the current camera with the proposed one and says whether the mountain is public. A query that is not five finite numbers, or a camera outside the bounds or without framing, is answered with the reason and no save button.
  - The editor adds the coordinates it was opened on (`lat`, `lon`) to the proposal. A proposal without readable coordinates is answered like an unreadable camera, and one for coordinates other than the mountain's current ones is answered with a 409, no save button and a link that reopens the editor on the latest coordinates.
  - Saving is a CSRF-protected POST that carries the proposed camera and the current camera the page showed. It also carries those coordinates, which are compared exactly, before the camera, under the same lock: a move clears the camera, so a mountain that had none still equals the camera a stale proposal expects, and only the coordinates tell that it was composed elsewhere. The camera is replaced only if the stored one still equals the one shown, compared exactly, under the same mountain row lock as edits and status changes; otherwise nothing is written and the page reopens with the newer camera to confirm again. The save writes the five camera columns and `updated_at`, never the status, and records `Camera changed.` in the history. The camera rules are those of publishing, so a public mountain stays publishable.
  - The lock does not conflict with the foreign-key lock of a daily discovery, so a camera save never delays the public API.
- OpenStreetMap and Wikidata references are optional. When present, the OpenStreetMap node id is a positive integer and the Wikidata id is a `Q` item id. Reversing the `catalog` migration `0005_optional_provenance` restores the former requirement that an `active` mountain has both references, so the reversal fails, and changes nothing, while an active mountain lacks either one; no data is invented to make it pass.
- The `catalog` migration `0012_catalog_pruning` turns `osm_type` and `osm_id` into `osm_node_id` and drops `prominence_meters` and `wikipedia_url`. It stops without changing anything when a row references a way or a relation. Reversing it restores `osm_type` (as `node`) and `osm_id` and leaves the prominence and the Wikipedia link empty.
- A photograph is uploaded, from any source, together with its credit; see Editorial photographs.
- Every save writes `updated_at`. The change history records who changed what.
- The summary is one trimmed line of at most 200 characters with no markup and in sentence form (a capitalized first word and a final period, by the same formatting rules as v1). The form shows why a summary is refused, and publication refuses a mountain whose stored summary breaks them.
- The mountain page opens with a read-only Publication section: the status, the timestamps and, for a draft, either `Ready to publish` or the reasons it cannot be published. Readiness uses the same checks as publishing and judges the saved mountain, not unsaved form edits. The summary is a multiline text area.
- Statuses change only through the buttons on the mountain page (Publish for a draft, Unlist for a published mountain, List again for an unlisted one). Both call the publication use cases, are for Editors only and act on the saved mountain, so save edits before using the button. Saving the form never changes the status:
  - **Publish** moves `draft` to `active`. It is refused, with the reasons, unless the mountain passes the same checks as `check_catalog`.
  - **Deactivate** (Unlist in the Studio) moves `active` to `inactive`: the mountain stays addressable by slug and keeps its daily history, and leaves `random`.
  - **Reactivate** (List again in the Studio) moves `inactive` to `active`, with the same checks as publishing.
  - Nothing returns a mountain to `draft`.
- Saving an `active` or `inactive` mountain checks the mountain it would become (the saved row with the form and photograph changes applied) with the same checks as publishing. When the result would not be publishable the save is refused with the reasons and nothing is written. A draft may stay incomplete.
- A save locks the mountain row before it reads the status or judges the form, as the publication actions do, so an edit that waited for a status change is judged against the new status. It writes only the columns the form owns plus `updated_at`, never the status or the camera. Two editors saving the same mountain are serialized and the later save wins for the fields both forms contain.
- Only a `draft` can be deleted, one at a time. Its photograph is removed first, from the mountain page; the database refuses to delete a mountain that still has one or has a daily discovery.
- The daily discovery history is listed read-only. The database refuses to update or delete it.

#### Editorial photographs

Download the photograph outside SerendiPeak (from Unsplash, Commons or anywhere else), upload the file on the mountain page and record where it comes from. Nothing is typed that SerendiPeak can derive: the stored file, its renditions and its dimensions come from the upload.

- The photograph section asks for the **Photograph** file (JPEG, PNG or WebP), the **Author** (required, the credit shown to visitors) and the **Photo page URL** (optional, an `https` link to the page where the photograph is published; the credit links to it). A **License** section follows with the license name and the license URL, both optional; the URL needs the name. A photo page does not stand in for a license: a photograph is publishable with an author alone, and the license is recorded when there is one.
- **Technical details** is collapsed and read-only: the dimensions and a short checksum of the stored original. Storage keys are never shown. There is no creator, creator link or import record in the form: the catalog keeps one author per photograph.

- The saved photograph and the selected one are shown side by side and named: **Saved photograph** and **Selected photograph, not saved yet**, with a **Cancel** button next to the second that clears the selection and keeps the saved photograph. A chosen file is previewed in the browser without any request. The file is required when adding a photograph; when changing one it is optional, and leaving it empty keeps the saved photograph.
- A replacement does not inherit the previous credit unreviewed. When a new file is chosen and the author, photo page, license name and license URL are exactly those of the photograph being replaced, saving is refused until the editor changes any of them or confirms that they also describe the new photograph.
- A chosen file is checked as soon as it is submitted: over 30 MiB, not an image, another format, animated, damaged, too many pixels, or a file that cannot be processed is a field error and nothing is stored. A valid file is stored only when the whole form is valid and the mountain row is locked: a submission refused for any reason stores nothing, and the objects (the original and both renditions, under content-addressed keys) are written before the row that references them, so a committed row never points to a missing object. Because a file input cannot be filled by the server, the page keeps the chosen file in the editor's browser (IndexedDB, for at most an hour, dropped when the editor cancels, picks another file or opens the form again without an error) and puts it back, with its preview, when the form comes back refused for another reason; the typed values come back with the form. If the file itself was refused, it is not kept. If storing fails, nothing is saved, the page shows the failure and the file is put back. A bad upload never produces a server error.
- To be published, and on every save of a published mountain, a photograph needs its stored file, dimensions and author, with `https` links. A published photograph cannot be removed; a draft's can.
- The mountain row stays locked while the file is processed and stored, so a slow upload delays other saves of the same mountain, never public reads. A production deployment must accept request bodies and durations of at least the upload limit.

The `catalog` migration `0011_minimal_photograph` keeps in `mountain_image` what visitors and editors use: the media, its dimensions, the `author` (the previous `attribution`, which is the credit visitors saw), the optional source page and the license. It drops the creator, the creator link, the Commons file title, the import's file URL, reported license, election basis and approval date; the catalog no longer holds them. Applied to a populated database it loses those columns for good. Reversing restores the columns empty and fails, changing nothing, while a photograph has no source page. Reversing `0008_source_agnostic_photograph` further back fails once a photograph was uploaded, because it restores the required legacy file URL and source identifier.

### Photograph media

Mountain photographs are owned by SerendiPeak and stored as uploads, never hotlinked. An external URL is provenance only. Each photograph is stored as three content-addressed objects named after the SHA-256 of the original bytes:

- `photographs/{sha256}/original.{jpg|png|webp}`: the original, byte for byte, in a private location. The extension comes from the decoded format, never from the file name.
- `photographs/{sha256}/page-r2.jpg`: the page rendition, at most 1280 pixels wide.
- `photographs/{sha256}/viewer-r2.jpg`: the viewer rendition, at most 2560 pixels on the long edge.

Renditions are progressive 8-bit sRGB JPEGs at quality 85 with the EXIF orientation applied, transparency flattened onto white and no metadata (no EXIF, GPS, XMP, ICC profile or comments). They keep the aspect ratio and are never upscaled. `r2` is the current rendition version: public objects are cached for a year as immutable, so changing any rendition parameter needs a new version rather than new bytes under an existing key. `r2` replaced `r1` because decoding a large JPEG at a reduced scale changes the rendition bytes of some photographs. Photographs already published under `r1` (the 73 of the development catalog) keep their `r1` keys and objects, which stay valid and are never rewritten; a photograph uploaded from now on gets `r2` keys; a row keeps the version it was written with. Objects are never overwritten and never deleted automatically; storing the same photograph again writes nothing, and a retry after a partial failure writes only the missing objects. The original is stored before its renditions.

Only JPEG, PNG and WebP decoded from the content are accepted; animated images and other formats are rejected. Corruption detection is whatever Pillow rejects: the file is verified and then fully decoded, and a truncated or undecodable image is refused (`LOAD_TRUNCATED_IMAGES` is never enabled). Some damaged JPEGs are still decodable, and libjpeg completes the missing data with gray pixels; such a file is accepted, because ingestion makes no forensic claim beyond what Pillow can reject. A JPEG may have at most 200 megapixels and a PNG or WebP at most 25, checked from the header before any pixel is decoded. A JPEG is decoded at the smallest DCT scale (1/2, 1/4 or 1/8) that still covers both renditions, whatever its shape, and is refused when even that would decode more than 50 megapixels, which only a very long and narrow photograph does; a photograph whose rendition would be longer than JPEG's 65535 pixels is refused too. A failure while rendering a decoded photograph is reported as a processing failure, not as a rejection of the file. An editor's upload may have at most 30 MiB; photographs of the existing catalog may have up to 150 MiB (the largest of the 73 has 78.4 MiB).

An image row records its photograph media in four columns (`original_key`, `original_sha256`, `page_key`, `viewer_key`): all or none, each matching the key or digest format, and only with dimensions. The public API derives the photograph URLs from these keys and the configured `MEDIA_PUBLIC_BASE_URL` and never exposes the keys. The database also ties the keys to the checksum: `original_key` starts with `photographs/{original_sha256}/original.`, and `page_key` and `viewer_key` are the page and viewer keys of that checksum under one published rendition version (`r1` or `r2`), the same for both. A new rendition version therefore needs a migration that widens those constraints along with the code that builds the keys. An image without media is not served as a photograph (see Photograph delivery).

Production stores photographs in S3-compatible storage (Cloudflare R2): outside `APP_ENV=development`, `MEDIA_STORE=filesystem` is rejected at startup, because a deployment without a volume would lose its media on every redeploy. With `MEDIA_STORE=filesystem` (development and tests), originals and public renditions live in separate `originals/` and `public/` directories under `MEDIA_ROOT`. In development only, Django serves the public directory at `/media/`; originals are never served. With `MEDIA_STORE=s3`, originals go to `MEDIA_ORIGINALS_BUCKET` and renditions to `MEDIA_PUBLIC_BUCKET` with `Cache-Control: public, max-age=31536000, immutable`. No ACLs are sent; bucket policy alone makes the public bucket public. Requests use region `auto`, a 5 s connect and 60 s read timeout, and at most three attempts with the SDK's standard backoff.

#### Checking the photographs

`check_photograph_media` checks every image, in any status, and exits non-zero on any problem. These checks hold for any photograph, whoever uploaded it: by default that the row has media whose keys derive from its checksum; `--deep` also that the original and both renditions exist in the media store; `--checksums` also that every original still hashes to its checksum, which reads all of them in full. `check_catalog` reports a photograph without media as `image_media_missing`.

```sh
cd services/api
uv run --env-file ../../.env python manage.py check_photograph_media --deep --checksums
```

After the snapshot of an environment is loaded and its objects are copied, `check_photograph_media --deep` is what proves that every key the catalog references exists in the target buckets. `node scripts/verify-api.mjs` compares the live API with the frozen v1 contract and only fits an unedited copy of the original catalog: a photograph replaced in the Studio reports as a mismatch that is not a regression.

The R2 smoke test checks a real S3-compatible store and is deselected by default; run it on demand with the development bucket settings (`MEDIA_STORE=s3`): `uv run --env-file ../../.env pytest -m r2_smoke`. It stores a few bytes under fresh keys, reads the original back, checks that the original is not reachable through `MEDIA_PUBLIC_BASE_URL`, and fetches the public object through it with its `Content-Type` and immutable `Cache-Control`.

## Web

```sh
cd apps/web
npm ci
echo 'NEXT_PUBLIC_API_BASE_URL=http://localhost:8000' >> .env.local
npm run dev
```

To run the whole app locally, start the database, then the backend (with a catalog loaded from a snapshot, or created in the Studio), then `npm run dev`, and open `http://localhost:3000`. The backend must be running first: without it the pages answer 500. Open the site at exactly the origin in `CORS_ALLOWED_ORIGIN` (`localhost`, not `127.0.0.1`), or the browser blocks the API calls. If `.env.local` already sets `NEXT_PUBLIC_API_BASE_URL`, edit that line instead of appending, and restart `next dev`: Next inlines the value at build time.

`NEXT_PUBLIC_API_BASE_URL` is required at build time because Next inlines it; the server-side pages read it through `readPublicConfig`. A missing or invalid value fails the request with a 500 instead of rendering.

The 3D stage reads two more build-time values through `readCesiumConfig`, so a bad API URL cannot take the globe down:

- `NEXT_PUBLIC_CESIUM_ION_TOKEN`: the Cesium ion access token. It is public by design; restrict it by domain on the ion side. Without it the stage shows "The 3D globe isn't available on this site." and makes no provider request; the editorial content is unaffected.
- `NEXT_PUBLIC_CESIUM_IMAGERY_MODE`: `sentinel2`, `world` or `none`. When unset, development uses `sentinel2` and production uses `world`. An invalid value makes the stage report that the globe could not be loaded; the adapter only ever receives the resolved mode.

The server also reads one runtime value, so changing it needs a restart but no new build:

- `SITE_ORIGIN`: the public origin the site is served from (for example `https://serendipeak.example`, no path), used for absolute URLs such as the atlas's canonical link. Unset, no canonical link is published; a value that is not a bare `http` or `https` origin is logged as a warning and treated as unset, because a wrong canonical is worse than none.

| Script                          | Purpose                                                                                                                                                                                                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                  | Prettier check and ESLint (`eslint-config-next`)                                                                                                                                                                                                                        |
| `npm run typecheck`             | `tsc --noEmit`, strict                                                                                                                                                                                                                                                  |
| `npm test`                      | Vitest unit tests (`src/**/*.spec.ts`)                                                                                                                                                                                                                                  |
| `npm run build`                 | Next production build                                                                                                                                                                                                                                                   |
| `npm run cesium:assets`         | Copies Cesium `Workers`, `ThirdParty`, `Assets` and `Widgets` into `public/cesium` (gitignored), served under `CESIUM_BASE_URL` `/cesium/`; runs before `dev` and `build`                                                                                               |
| `npm run test:ssr`              | Builds with `NEXT_PUBLIC_API_BASE_URL` pointing at the stub API, starts `next start` and the stub, and runs the HTTP-level SSR tests (status, title, heading, `Cache-Control`) plus the Try again browser flow; overwrites `.next`, so run it after the production gate |
| `npm run check:production-gate` | Fails when forbidden diagnostic identifiers reach `.next/static` or `.next/server`; run it after `build`                                                                                                                                                                |
| `npm run test:webgl`            | Real-WebGL scene tests (`@webgl`, Chromium) against `next dev`, where React Strict Mode runs effects twice; builds nothing in `.next`                                                                                                                                   |
| `npm run test:webgl:prod`       | The same suite against a production build served by `next start`                                                                                                                                                                                                        |

### Mountain search

The Search button in the site header opens a modal dialog that finds mountains by name and opens the chosen one at `/mountains/<slug>` by client navigation. The index lives in one `MountainIndexStore` per app, created in `_app` and shared through `MountainIndexProvider`. Only two things fill it: the first opening of search, which requests `GET /api/v1/mountains` once, and the atlas page, which hands it the index it was rendered with, so search on the atlas makes no request. No other page loads the index. An opening more than five minutes after the last load refreshes the index in the background while the one already loaded stays searchable; a failed refresh keeps it and the next opening tries again. The browser's HTTP cache honours the API's own five-minute lifetime, so a newly published mountain appears in search within about ten minutes at most, without a deployment.

Filtering runs in the browser on every keystroke, with no request: names are compared case-, accent- and punctuation-insensitively (`Huascaran` finds Huascarán, `mont blanc` finds Mont-Blanc), names that start with the query come first, then names with a word that starts with it, then any other match. The dialog follows the combobox pattern with a listbox of results (arrow keys move the active result, Enter opens it or the first result, Escape or Close dismisses it and returns focus to the button) and announces loading, failures, the prompt and the number of results in one status region. It needs no WebGL.

### Atlas

`/atlas` shows every active mountain on the globe's sheet, grouped by continent. It is server-rendered from the index (`getServerSideProps` → `loadAtlasPage`), indexable, and canonicalizes to `${SITE_ORIGIN}/atlas`. An index the API cannot serve answers 503 (unreachable) or 502 with a retry, like a mountain page.

- **List.** Each continent is a native `<details>` disclosure with its mountain count, collapsed on a fresh visit; several may be open at once. Closed continents keep their links in the server-rendered document, and the disclosures open by keyboard and touch without JavaScript. The stage layout remembers which continents are open, so coming back from a mountain page (Back or the "Back to atlas" link) finds the list as it was left; a page without the stage, or a full load, starts collapsed again.
- **Choosing a mountain** is a plain link to `/mountains/<slug>`: a normal history entry, a client navigation that keeps the `Viewer`, and the mountain page's usual flight. Without JavaScript it is an ordinary link. Mountain permalinks link back to `/atlas` ("Back to atlas"); the header links to `/atlas` on every page.
- **Legacy links.** `/atlas?mountain=<slug>` redirects (307, never cached: the links come from an unpublished experience) to the mountain page when the index holds the slug, and to `/atlas` otherwise. While the index is unavailable the error page is served instead of a redirect.
- **Overview.** The atlas presents no mountain. Every entry (a full load, the header link, Back from a mountain page, the return link) lets go of the mountain shown before and shows the same editorial overview: the whole globe above 20° N, 10° E (`ATLAS_VIEW`), at a distance that fits the globe to the stage's narrower side. A full load places it at once; a client navigation flies there from wherever the camera stopped, cancelling any flight in progress. Reset flies back to it.
- **Ambient rotation.** Once the overview settles, `ViewerOrbit` turns the camera about the polar axis, one turn every `ATLAS_ORBIT_PERIOD_SECONDS` (300 s), keeping altitude and tilt; the globe's frame is untouched. It stops at a press or wheel on the globe, a zoom step, any flight, or any camera movement it did not make, and resumes only from the stage's rotation control (which flies back to the overview first if the camera left it) or from Reset. Pausing from the control is kept until the reader resumes, across atlas visits. It never runs under `prefers-reduced-motion`, renders nothing while the page is hidden (its clock restarts when the page shows again, so the globe does not jump), and stops when the atlas is left or the scene is destroyed. The Viewer already renders continuously, so the orbit adds no render loop of its own.
- **Markers.** Only the atlas draws its mountains on the globe: one point per index entry, from the same index the list is rendered with, so the two always agree. `StageLayout` maps the entries to markers and hands them to the stage on a path of their own, apart from the overview, so a changed catalog replaces the markers without moving the camera or restarting the orbit; the scene reconciles them by slug, keeping the entity of every unchanged mountain. `AtlasMarkers` keeps them in a Cesium `CustomDataSource` of its own, apart from `viewer.entities` where the mountain pages' summit marker lives; the atlas presents no mountain, so the two never show together. Leaving the atlas hides the layer in the same step that starts the next flight and returning shows it again, on the same `Viewer`; the scene removes it when it is destroyed.
  - *Position.* Each marker stands at the catalog's latitude, longitude and elevation, never clamped to terrain, so it is drawn exactly where the scene projects it. The scene's depth settings stay at Cesium's defaults: a summit behind a nearer ridge may show through it, which is accepted at atlas distances.
  - *Visibility* is decided in JavaScript and applied through `entity.show`: a marker shows only while it is in front of the camera, above the horizon (`EllipsoidalOccluder`) and projected inside the canvas. A projection alone is not enough, because a summit on the far side of the Earth still lands inside the canvas. The pass runs whenever the camera moves, turns or the canvas is resized, checked every frame against small thresholds, since Cesium's `camera.changed` fires too seldom during the slow orbit. It is O(n) per changed frame in the number of markers and rebuilds nothing; markers are shown and hidden.
  - *Look* (`ATLAS_MARKER_STYLE`). Points are vermilion with a dark ink outline, readable over snow, desert, ocean and forest, and shrink and soften with distance through Cesium's per-marker distance properties evaluated on the GPU. Labels carry the name only, in a system face because Cesium rasterizes them before web fonts may have loaded, on the dark translucent plate (`MARKER_LABEL_PLATE`) that the summit marker's label shares. They fade in between 1,600 and 1,200 km from the camera: the global overview shows points only, and a regional view names its summits. In captures a label looks fainter than its fade value says: names read comfortably from 1,200 km and are a ghost of that by 1,300 km. The visibility pass also switches each label on only within 1,600 km. The distance condition alone would hide a far label on the GPU, but Cesium would still build and update its glyphs; on a software renderer, 2,000 such labels cut the overview from 11 to 4 frames per second, and the gate brings it back to the rate with no markers at all. Summits a few kilometres apart (Cerro Torre and Fitz Roy, Everest and Ama Dablam) still overlap at that distance; there is no on-screen label decluttering. Markers take no input: no picking, hover or selection.
- **Without WebGL** the list and every link work, and no rotation control is offered.

### Continuous integration

The WebGL suites are the slow part of CI, so they run apart from the other web checks (lint, types, unit tests, build, production gate, SSR and no-WebGL tests):

- **Concurrency.** The development and production suites run at the same time, each split into two shards with `--shard=<n>/2`. A shard is a separate runner with its own checkout, build directory, server and stub API, and runs one Playwright worker. The WebGL config sets `fullyParallel` only so that Playwright shards by test instead of by file; the one worker still runs tests in order. Run a shard locally with `npm run test:webgl -- --shard=1/2` (or `test:webgl:prod`).
- **Coverage.** The `WebGL` check summarizes the shard reports and fails when a test ran twice within a mode, or ran in one mode and not in the other. It is the single check to require: the shard jobs are skipped when the suites do not run, and a skipped matrix job cannot satisfy a required check by name.
- **Skipping.** `scripts/classify-changes.mjs` decides, for pull requests and for pushes to `main`, whether the WebGL suites run. They are skipped only when every changed path is under `docs/` or is a Markdown file in the repository root. A pull request is compared with its merge base and a push over the whole range from the previous tip to the new one. Any other path, an empty diff, a new branch, a base commit that is missing or malformed, and any other event run them.
- **Durations.** Each shard uploads its Playwright JSON report. The `WebGL` job summary lists, per shard and mode, the test time and wall time and the imbalance between shards, then the duration by spec and the slowest tests. When one shard is consistently slower, rebalance by changing the number of shards or by splitting the heaviest spec.

### Stage lifecycle

The stage is one Cesium `Viewer` per mounted `StageLayout`. `AppFrame` renders the layout at the same position of the React tree for every page built around the stage (`/`, `/mountains/[slug]` and `/atlas`), so client navigation between them keeps the layout, its `SceneStore` and the `Viewer`; only the target changes and the camera travels to the new mountain, or, on the atlas, lets go of it and flies to the overview. A page without the stage (About, the 404 and error views) renders no layout: the layout unmounts, the session stops and the `Viewer` is destroyed, and coming back builds a fresh one. A full page load always starts a new one.

`useStage` starts a `StageBinding` in an effect and disposes it in the cleanup. The binding owns a `SceneSession` and a `ResizeObserver` on the viewport, and `SceneSession` aborts creation that is still pending and destroys a scene that resolves after that. Under Strict Mode (`mount`, `cleanup`, `mount`) the first creation is aborted before it builds a `Viewer`, so exactly one WebGL context and one `Viewer` exist. The `SceneStore` is created by the layout and read with `useSyncExternalStore`; the loader and the stage notice both render from its snapshot.

The test-only camera reading (`window.__serendipeakCamera`), globe position (`window.__serendipeakGlobe`) and atlas layer (`window.__serendipeakAtlas`: per marker, the visibility and canvas position from the same pass that shows or hides it, its distance and label state) exist only in builds made with `NEXT_PUBLIC_E2E_DIAGNOSTICS=1`. `next.config.ts` always defines the variable so the bundler folds the branch away otherwise, and `check:production-gate` fails the build if the identifier reaches the output. `NEXT_DIST_DIR` redirects the build directory; the `@webgl` suite uses `.next-e2e` so it never touches the production build.

`e2e/stub-api/server.mjs` serves the vendored `contracts/v1/` fixtures, and a mountain index built from them, for browser and SSR tests without a network or database (`node e2e/stub-api/server.mjs`, port `STUB_API_PORT`, default 8099). `POST /__control/scenario/<ok|unreachable|malformed|server-error|no-eligible|catalog>` switches every API answer (the index has no `no-eligible` answer; `catalog` serves the 73 mountains of `contracts/v1/catalog.json` as the index, with synthetic continents, for tests that need real density on the globe, and answers every other route as `ok`), `GET /__control/requests` lists the API paths requested and `POST /__control/reset` restores `ok` and clears the list. `eslint` pins ESLint 9 because `eslint-plugin-react`, bundled by `eslint-config-next`, does not declare ESLint 10 support.

## Frozen contracts

```sh
npm ci
npm run contracts:verify
```

`contracts:verify` is offline. It fails when a vendored file is modified, added or removed, or when the lock provenance differs from the frozen source. `npm run contracts:sync [path-to-source-clone]` copies `contracts/v1/` again from a local clone of the original implementation at its frozen tag and regenerates the lock. That repository is not public, so only the maintainer runs the command; it never runs in CI.

## Commits

Commit messages follow Conventional Commits, validated by commitlint through a Husky hook (`npm ci` installs it).
