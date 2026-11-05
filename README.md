# SerendiPeak

SerendiPeak shows one mountain per day with a 3D globe and editorial content. This repository is the new implementation: a Django, Django REST Framework and GeoDjango API backed by PostgreSQL/PostGIS, with a Next.js (Pages Router) and React frontend in `apps/web`.

## Migration reference

The behavioral reference is the read-only legacy repository at tag `v1-behavioral-freeze` (`camilasabino/serendipeak-legacy`, commit `f9a66deb2c0591a9c574fb4751b938b5863e6a1e`). Its `contracts/v1/` files are vendored here byte for byte and protected by `contracts/v1.lock.json`. The legacy repository is never modified.

## Prerequisites

- [uv](https://docs.astral.sh/uv/) (Python 3.13 is installed and pinned by uv through `.python-version`)
- Docker with Compose
- Node 24 (see `.nvmrc`), used for repository tooling and `apps/web`
- GDAL and GEOS, required by GeoDjango. On macOS: `brew install gdal`

## Repository layout

- `services/api/` Django project managed by uv
- `apps/web/` Next.js (Pages Router) web foundation, npm package with its own lock file
- `contracts/v1/` frozen contract files vendored from the legacy repository
- `contracts/v1.lock.json` provenance and sha256 of every vendored file
- `scripts/` contract verification and sync
- `docker-compose.yml` local PostgreSQL/PostGIS
- `.env.example` every environment variable the project reads

## Environment

```sh
cp .env.example .env
```

| Variable                                                                        | Purpose                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`            | Local database container. Port `5434` avoids the legacy database on `5433`.                                                                                                                                                                             |
| `DATABASE_URL`                                                                  | Django database connection (`postgres://user:password@host:port/name`).                                                                                                                                                                                 |
| `APP_ENV`                                                                       | `development` enables `DEBUG`. Any other value, or none, is production.                                                                                                                                                                                 |
| `DJANGO_SECRET_KEY`                                                             | Django secret key. Required.                                                                                                                                                                                                                            |
| `ALLOWED_HOSTS`                                                                 | Comma separated host names.                                                                                                                                                                                                                             |
| `GDAL_LIBRARY_PATH`, `GEOS_LIBRARY_PATH`                                        | Optional overrides for the GDAL and GEOS shared library paths. Set them only when Django cannot find the libraries, for example `/opt/homebrew/lib/libgdal.dylib` and `/opt/homebrew/lib/libgeos_c.dylib` on macOS with Homebrew. Leave unset on Linux. |
| `CORS_ALLOWED_ORIGIN`                                                           | Exactly one frontend origin allowed by CORS. Wildcards and lists are rejected at startup.                                                                                                                                                               |
| `MEDIA_STORE`                                                                   | Where photograph media lives: `filesystem` for local development and tests (rejected outside `APP_ENV=development`) or `s3` for an S3-compatible store such as Cloudflare R2. Required; nothing is inferred from other variables.                       |
| `MEDIA_ROOT`                                                                    | `filesystem` only. Media directory, relative to `services/api` (`.media` in `.env.example`, ignored by Git).                                                                                                                                            |
| `MEDIA_PUBLIC_BASE_URL`                                                         | Base URL of the public renditions, without a trailing slash, query or fragment. Must be `https` outside `APP_ENV=development`.                                                                                                                          |
| `MEDIA_S3_ENDPOINT_URL`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` | `s3` only. `https` endpoint and credentials, from the environment only.                                                                                                                                                                                 |
| `MEDIA_PUBLIC_BUCKET`, `MEDIA_ORIGINALS_BUCKET`                                 | `s3` only. Two different buckets: public renditions and private originals.                                                                                                                                                                              |
| `LEGACY_DATABASE_URL`                                                           | Optional. Legacy database connection used only by the legacy catalog export.                                                                                                                                                                            |

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
uv run --env-file ../../.env python manage.py bootstrap_catalog  # first run only, see Catalog bootstrap
uv run --env-file ../../.env python manage.py runserver
```

`runserver` listens on `localhost:8000`.

### Health endpoint

`GET /healthz` returns `200 {"status":"ok"}` when the database answers and `503 {"status":"database unavailable"}` otherwise. It does not use the API error envelope.

```sh
curl -i http://127.0.0.1:8000/healthz
```

### Mountain endpoint

`GET /api/v1/mountains/{slug}` returns an `active` or `inactive` mountain as JSON (`application/json; charset=utf-8`), in the shape of `contracts/v1/mountain-*.json`: camelCase members, members without a value omitted (never `null`), `countries` always present. The lookup is exact and case-sensitive. A `draft` mountain, an unknown slug and a slug that breaks the slug rule answer `404 {"error":{"code":"MOUNTAIN_NOT_FOUND","message":"Mountain not found"}}`; any other failure answers `500` with code `INTERNAL_ERROR` and never its cause, which is logged with its traceback. The endpoint sends no `Cache-Control` header and answers JSON whatever the `Accept` header asks for. `today` and `random` are reserved words, never routed to this endpoint.

```sh
curl -i http://127.0.0.1:8000/api/v1/mountains/aconcagua
node contracts/v1/verify-api.mjs http://127.0.0.1:8000
```

### Today's mountain endpoint

`GET /api/v1/mountains/today` returns `{"date":"YYYY-MM-DD","mountain":{...}}` in the shape of `contracts/v1/daily-mountain.json`, where `date` is the current UTC calendar date and `mountain` has the shape of the mountain endpoint.

- The first request of a UTC date chooses the mountain and stores it in `daily_discovery`; every later request of that date, after restarts too, returns the stored mountain, even when that mountain has been deactivated since. Stored discoveries are never changed or deleted.
- A new date chooses among the `active` mountains only, leaving out those chosen in the previous 30 UTC dates unless that leaves none, in which case every active mountain is eligible again. The choice is the SHA-256 of the ISO date, first 8 bytes as a big-endian integer, modulo the number of candidates sorted by slug code points.
- Concurrent first requests of a date store exactly one discovery and all answer it: the date is the table's primary key, and the insert is a single autocommitted `INSERT ... ON CONFLICT DO NOTHING` followed by a re-read of the stored row. There are no locks and no retries.
- With no `active` mountain, a new date answers `503 {"error":{"code":"NO_ELIGIBLE_MOUNTAINS","message":"No mountains are available for discovery"}}` and stores nothing; any other failure answers `500` with code `INTERNAL_ERROR`.
- Every answer, errors included, carries `Cache-Control: no-store`.

Requesting `today` writes to the database on a new date, so `verify-api.mjs` skips it unless `--include-stateful-today` is passed; pass it only against a disposable database.

```sh
curl -i http://127.0.0.1:8000/api/v1/mountains/today
node contracts/v1/verify-api.mjs http://127.0.0.1:8000 --include-stateful-today
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

### Legacy catalog export

`services/api/seed/legacy-catalog-v1.json` is the seed input for the catalog bootstrap: every legacy mountain, its primary image and the daily discovery history. It is never a source of truth; the database is the canonical catalog.

`services/api/tools/export_legacy_catalog.py` produces it. The application never imports the tool. The tool imports the seed format and the content hash from the application seed parser, so the export and the bootstrap share one definition of both, and it runs as a module from `services/api`. It reads the legacy database inside one `REPEATABLE READ, READ ONLY` transaction with SELECT statements only, and reads `data/media.yaml` from the legacy repository at the frozen commit (after checking that `v1-behavioral-freeze` points to it), never from the working tree. It stops without writing when the legacy schema is not at version 9, when a legacy column is neither exported nor deliberately dropped, or when the media manifest disagrees with a stored image.

```sh
cd services/api
LEGACY_DATABASE_URL=postgres://serendipeak:serendipeak@localhost:5433/serendipeak \
  uv run python -m tools.export_legacy_catalog --legacy-repo ../../../serendipeak-legacy
```

The output is deterministic for a given `--exported-on` date (default: today in UTC). The artifact records the format and version, the export date, the legacy tag, commit and schema version, the sha256 of the media manifest, row counts and `content_sha256`. `content_sha256` is the SHA-256 of `content` serialized as UTF-8 JSON with sorted keys, `(",", ":")` separators, non-ASCII characters unescaped and no NaN, so it does not depend on the file layout or the export date.

The image rows drop the legacy `id`, `type`, `source`, `title`, `is_primary` and `created_at` columns: every image is the primary `wikimedia_commons` image and its title is the file name without the `File:` prefix and the extension, both checked during the export. `license_reported`, `license_election_basis_url` and `approved_on` come from the media manifest and are `null` for images without a manifest entry. Mountain `status` keeps the legacy values.

### Catalog bootstrap

The PostgreSQL/PostGIS database is the canonical catalog. `bootstrap_catalog` loads the seed artifact into an empty database once; `check_catalog` checks the publication invariants.

```sh
cd services/api
uv run --env-file ../../.env python manage.py migrate
uv run --env-file ../../.env python manage.py bootstrap_catalog
uv run --env-file ../../.env python manage.py check_catalog
```

- `bootstrap_catalog` validates the seed (format, legacy tag and commit, `content_sha256`, counts, field types, coordinate range) and compares it with the frozen `contracts/v1/catalog.json` before writing. It then loads mountains, images and daily discoveries in one transaction, keeping the legacy ids and timestamps, and verifies the stored catalog against the seed and the frozen catalog. Coordinates are compared within 1e-7 degrees and camera values within 1e-9; every other value exactly. Legacy `pending_media` becomes `draft`, which is never publicly visible.
- It refuses when the catalog already holds mountains. The emptiness check and the load run in one transaction that first locks the `mountain` table against concurrent writes (`SHARE ROW EXCLUSIVE`; reads are not blocked), so a concurrent second run waits for the first, then refuses and loads nothing. The load is all or nothing; foreign keys are deferred, so a reference to a missing mountain fails when the transaction commits and nothing is kept.
- The verification runs after the load has committed. When it reports mismatches, the loaded rows stay; recreate the database, run `migrate` and `bootstrap_catalog` again.
- `bootstrap_catalog --verify-only` runs only the verification, writes nothing and can be repeated. It verifies a freshly bootstrapped catalog, not a catalog in use: later daily discoveries and catalog edits are legitimate differences from the seed, and it reports them as mismatches.
- `check_catalog` is the routine check. It does not compare the catalog with the seed and can run at any time.
- `check_catalog` checks every `active` mountain: valid slug, coordinates in range, positive elevation, a curated camera with framing inside the bounds, a primary image with URL, attribution, source page, source identifier, license name, dimensions and a license URL (a public-domain image needs a creator instead), and a summary that follows the summary rules when there is one.

`--seed` and `--frozen-catalog` replace the input files. On failure each command lists the mismatches or violations on stderr and exits with status 1.

### Editorial admin

Django Admin at `/admin/` is the editorial interface. It edits the catalog in place; there is no other source of truth. Create the first user with `manage.py createsuperuser`, then create editor accounts under **Users** and give each one the `catalog` permissions they need directly. The permission selector lists only `catalog` permissions, and the admin has no groups. Publishing and changing a published mountain's status need the separate `catalog | mountain record | Can publish, deactivate and reactivate mountains` permission, so changing a mountain does not imply publishing it. The admin sets session and CSRF cookies (`Secure` outside `APP_ENV=development`, `HttpOnly`, `SameSite=Lax`), sends `X-Frame-Options: DENY`, and loads no map tiles: coordinates are plain latitude and longitude fields. The public API is unaffected: it sets no cookies and no frame policy.

- A mountain is created as a `draft` with every field the form offers. A draft is editable and never public: it is not served by slug, `today` or `random`. The status is never a form field.
- The mountain page has the sections Publication, Mountain (name, slug, latitude, longitude, elevation), Editorial (summary, range, countries), Camera and a collapsed Additional data (prominence, OpenStreetMap type and id, Wikidata id, Wikipedia URL). The add page has no Publication and no Camera section.
- Mountain data stays editable on every status: name, coordinates, elevation, summary, range, countries and the additional data. Latitude and longitude are form fields; saving rebuilds the stored point from them.
- The slug is editable on every status and keeps its syntax, reserved-name and uniqueness checks. The catalog is a pre-cutover editorial seed, so a slug change does not leave redirects or history.
- The camera is read-only in the admin. The mountain form never writes it, including on creation, so a draft starts without a camera; publication still needs one.
- OpenStreetMap and Wikidata references are optional. When present, the OpenStreetMap type and id go together and the Wikidata id is a `Q` item id. Reversing the `catalog` migration `0005_optional_provenance` restores the former requirement that an `active` mountain has both references, so the reversal fails, and changes nothing, while an active mountain lacks either one; no data is invented to make it pass.
- The photograph's URLs, dimensions, source page, identifier and license provenance are read-only after creation. Its creator, attribution and license name and URL stay editable.
- Every save writes `updated_at`. The change history records who changed what.
- The summary is one trimmed line of at most 200 characters with no markup and in sentence form (a capitalized first word and a final period, by the same formatting rules as v1). The form shows why a summary is refused, and publication refuses a mountain whose stored summary breaks them.
- The mountain page opens with a read-only Publication section: the status, the timestamps and, for a draft, either `Ready to publish` or the reasons it cannot be published. Readiness uses the same checks as publishing and judges the saved mountain, not unsaved form edits. The summary is a multiline text area.
- List filters always show their counts.
- Statuses change only through the changelist actions and the single button on the mountain page (Publish for a draft, Deactivate for an active mountain, Reactivate for an inactive one). Both call the publication use cases, need the publish permission and act on the saved mountain, so save edits before using the button. Saving the form never changes the status:
  - **Publish** moves `draft` to `active`. It is refused, with the reasons, unless the mountain passes the same checks as `check_catalog`.
  - **Deactivate** moves `active` to `inactive`: the mountain stays addressable by slug and keeps its daily history, and leaves `random`.
  - **Reactivate** moves `inactive` to `active`, with the same checks as publishing.
  - Nothing returns a mountain to `draft`.
- Saving an `active` or `inactive` mountain checks the mountain it would become (the saved row with the form and photograph changes applied) with the same checks as publishing. When the result would not be publishable the save is refused with the reasons and nothing is written. A draft may stay incomplete.
- A save locks the mountain row before it reads the status or judges the form, as the publication actions do, so an edit that waited for a status change is judged against the new status. It writes only the columns the form owns plus `updated_at`, never the status or the camera. Two editors saving the same mountain are serialized and the later save wins for the fields both forms contain.
- Only a `draft` can be deleted, one at a time. Its photograph is removed first, from the mountain page; the database refuses to delete a mountain that still has one or has a daily discovery.
- The daily discovery history is listed read-only. The database refuses to update or delete it.

### Photograph media

Mountain photographs are owned by SerendiPeak and stored as uploads, never hotlinked. An external URL is provenance only. Each photograph is stored as three content-addressed objects named after the SHA-256 of the original bytes:

- `photographs/{sha256}/original.{jpg|png|webp}`: the original, byte for byte, in a private location. The extension comes from the decoded format, never from the file name.
- `photographs/{sha256}/page-r1.jpg`: the page rendition, at most 1280 pixels wide.
- `photographs/{sha256}/viewer-r1.jpg`: the viewer rendition, at most 2560 pixels on the long edge.

Renditions are progressive 8-bit sRGB JPEGs at quality 85 with the EXIF orientation applied, transparency flattened onto white and no metadata (no EXIF, GPS, XMP, ICC profile or comments). They keep the aspect ratio and are never upscaled. `r1` is the rendition version: public objects are cached for a year as immutable, so changing any rendition parameter needs a new version rather than new bytes under an existing key. Objects are never overwritten and never deleted automatically; storing the same photograph again writes nothing, and a retry after a partial failure writes only the missing objects. The original is stored before its renditions.

Only JPEG, PNG and WebP decoded from the content are accepted; animated images and other formats are rejected. Corruption detection is whatever Pillow rejects: the file is verified and then fully decoded, and a truncated or undecodable image is refused (`LOAD_TRUNCATED_IMAGES` is never enabled). Some damaged JPEGs are still decodable, and libjpeg completes the missing data with gray pixels; such a file is accepted, because ingestion makes no forensic claim beyond what Pillow can reject. A JPEG may have at most 200 megapixels and a PNG or WebP at most 50, checked from the header before any pixel is decoded. An editor's upload may have at most 30 MiB; photographs of the existing catalog may have up to 150 MiB.

An image row records its photograph media in four columns (`original_key`, `original_sha256`, `page_key`, `viewer_key`): all or none, each matching the key or digest format, and only with dimensions. Images without media keep serving their stored URLs, and the public API does not expose media keys.

Production stores photographs in S3-compatible storage (Cloudflare R2): outside `APP_ENV=development`, `MEDIA_STORE=filesystem` is rejected at startup, because a deployment without a volume would lose its media on every redeploy. With `MEDIA_STORE=filesystem` (development and tests), originals and public renditions live in separate `originals/` and `public/` directories under `MEDIA_ROOT`. In development only, Django serves the public directory at `/media/`; originals are never served. With `MEDIA_STORE=s3`, originals go to `MEDIA_ORIGINALS_BUCKET` and renditions to `MEDIA_PUBLIC_BUCKET` with `Cache-Control: public, max-age=31536000, immutable`. No ACLs are sent; bucket policy alone makes the public bucket public. Requests use region `auto`, a 5 s connect and 60 s read timeout, and at most three attempts with the SDK's standard backoff.

## Web

```sh
cd apps/web
npm ci
echo 'NEXT_PUBLIC_API_BASE_URL=http://localhost:8000' >> .env.local
npm run dev
```

To run the whole app locally, start the database, then the backend (with a bootstrapped catalog), then `npm run dev`, and open `http://localhost:3000`. The backend must be running first: without it the pages answer 500. Open the site at exactly the origin in `CORS_ALLOWED_ORIGIN` (`localhost`, not `127.0.0.1`), or the browser blocks the API calls. If `.env.local` already sets `NEXT_PUBLIC_API_BASE_URL`, edit that line instead of appending, and restart `next dev`: Next inlines the value at build time.

`NEXT_PUBLIC_API_BASE_URL` is required at build time because Next inlines it; the server-side pages read it through `readPublicConfig`. A missing or invalid value fails the request with a 500 instead of rendering.

The 3D stage reads two more build-time values through `readCesiumConfig`, so a bad API URL cannot take the globe down:

- `NEXT_PUBLIC_CESIUM_ION_TOKEN`: the Cesium ion access token. It is public by design; restrict it by domain on the ion side. Without it the stage shows "The 3D globe isn't available on this site." and makes no provider request; the editorial content is unaffected.
- `NEXT_PUBLIC_CESIUM_IMAGERY_MODE`: `sentinel2`, `world` or `none`. When unset, development uses `sentinel2` and production uses `world`. An invalid value makes the stage report that the globe could not be loaded; the adapter only ever receives the resolved mode.

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

### Stage lifecycle

The stage is one Cesium `Viewer` per mounted `MountainLayout`. `AppFrame` renders the layout at the same position of the React tree for every page that has a mountain (`/` and `/mountains/[slug]`), so client navigation between them keeps the layout, its `SceneStore` and the `Viewer`; only the target changes and the camera travels to the new mountain. A page without a mountain (the 404 and error views) renders no layout: the layout unmounts, the session stops and the `Viewer` is destroyed, and coming back builds a fresh one. A full page load always starts a new one.

`useStage` starts a `StageBinding` in an effect and disposes it in the cleanup. The binding owns a `SceneSession` and a `ResizeObserver` on the viewport, and `SceneSession` aborts creation that is still pending and destroys a scene that resolves after that. Under Strict Mode (`mount`, `cleanup`, `mount`) the first creation is aborted before it builds a `Viewer`, so exactly one WebGL context and one `Viewer` exist. The `SceneStore` is created by the layout and read with `useSyncExternalStore`; the loader and the stage notice both render from its snapshot.

The test-only camera reading (`window.__serendipeakCamera`) exists only in builds made with `NEXT_PUBLIC_E2E_DIAGNOSTICS=1`. `next.config.ts` always defines the variable so the bundler folds the branch away otherwise, and `check:production-gate` fails the build if the identifier reaches the output. `NEXT_DIST_DIR` redirects the build directory; the `@webgl` suite uses `.next-e2e` so it never touches the production build.

`e2e/stub-api/server.mjs` serves the vendored `contracts/v1/` fixtures for browser and SSR tests without a network or database (`node e2e/stub-api/server.mjs`, port `STUB_API_PORT`, default 8099). `POST /__control/scenario/<ok|unreachable|malformed|server-error|no-eligible>` switches every API answer, `GET /__control/requests` lists the API paths requested and `POST /__control/reset` restores `ok` and clears the list. `eslint` pins ESLint 9 because `eslint-plugin-react`, bundled by `eslint-config-next`, does not declare ESLint 10 support.

## Frozen contracts

```sh
npm ci
npm run contracts:verify
```

`contracts:verify` is offline. It fails when a vendored file is modified, added or removed, or when the lock provenance differs from the frozen source. `npm run contracts:sync [path-to-legacy]` copies `contracts/v1/` again from the local legacy clone at the frozen tag and regenerates the lock. It is manual and never runs in CI.

## Commits

Commit messages follow Conventional Commits, validated by commitlint through a Husky hook (`npm ci` installs it).
