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
- `scripts/` contract verification and sync, web production gate
- `docker-compose.yml` local PostgreSQL/PostGIS
- `.env.example` every environment variable the project reads

## Environment

```sh
cp .env.example .env
```

| Variable | Purpose |
|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` | Local database container. Port `5434` avoids the legacy database on `5433`. |
| `DATABASE_URL` | Django database connection (`postgres://user:password@host:port/name`). |
| `APP_ENV` | `development` enables `DEBUG`. Any other value, or none, is production. |
| `DJANGO_SECRET_KEY` | Django secret key. Required. |
| `ALLOWED_HOSTS` | Comma separated host names. |
| `GDAL_LIBRARY_PATH`, `GEOS_LIBRARY_PATH` | Optional overrides for the GDAL and GEOS shared library paths. Set them only when Django cannot find the libraries, for example `/opt/homebrew/lib/libgdal.dylib` and `/opt/homebrew/lib/libgeos_c.dylib` on macOS with Homebrew. Leave unset on Linux. |
| `CORS_ALLOWED_ORIGIN` | Exactly one frontend origin allowed by CORS. Wildcards and lists are rejected at startup. |

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
uv run --env-file ../../.env python manage.py runserver
```

### Health endpoint

`GET /healthz` returns `200 {"status":"ok"}` when the database answers and `503 {"status":"database unavailable"}` otherwise. It does not use the API error envelope.

```sh
curl -i http://127.0.0.1:8000/healthz
```

### Tests, formatting and lint

Tests run against the real PostGIS database from `docker compose`.

```sh
cd services/api
uv run --env-file ../../.env pytest
uv run ruff format --check .
uv run ruff check .
```

Use `uv run ruff format .` and `uv run ruff check --fix .` to apply fixes.

## Web

```sh
cd apps/web
npm ci
npm run dev
```

| Script | Purpose |
|---|---|
| `npm run lint` | Prettier check and ESLint (`eslint-config-next`) |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm test` | Vitest unit tests (`src/**/*.spec.ts`) |
| `npm run build` | Next production build |
| `npm run check:production-gate` | Fails when forbidden diagnostic identifiers reach `.next/static` or `.next/server`; run it after `build` |

`e2e/stub-api/server.mjs` serves the vendored `contracts/v1/` fixtures for browser and SSR tests without a network or database (`node e2e/stub-api/server.mjs`, port `STUB_API_PORT`, default 8099). `eslint` pins ESLint 9 because `eslint-plugin-react`, bundled by `eslint-config-next`, does not declare ESLint 10 support.

## Frozen contracts

```sh
npm ci
npm run contracts:verify
```

`contracts:verify` is offline. It fails when a vendored file is modified, added or removed, or when the lock provenance differs from the frozen source. `npm run contracts:sync [path-to-legacy]` copies `contracts/v1/` again from the local legacy clone at the frozen tag and regenerates the lock. It is manual and never runs in CI.

## Commits

Commit messages follow Conventional Commits, validated by commitlint through a Husky hook (`npm ci` installs it).
