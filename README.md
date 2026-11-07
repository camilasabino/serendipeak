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

| Variable                                                                        | Purpose                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`            | Local database container. Port `5434` avoids the legacy database on `5433`.                                                                                                                                                                                      |
| `DATABASE_URL`                                                                  | Django database connection (`postgres://user:password@host:port/name`).                                                                                                                                                                                          |
| `APP_ENV`                                                                       | `development` enables `DEBUG`. Any other value, or none, is production.                                                                                                                                                                                          |
| `DJANGO_SECRET_KEY`                                                             | Django secret key. Required.                                                                                                                                                                                                                                     |
| `ALLOWED_HOSTS`                                                                 | Comma separated host names.                                                                                                                                                                                                                                      |
| `GDAL_LIBRARY_PATH`, `GEOS_LIBRARY_PATH`                                        | Optional overrides for the GDAL and GEOS shared library paths. Set them only when Django cannot find the libraries, for example `/opt/homebrew/lib/libgdal.dylib` and `/opt/homebrew/lib/libgeos_c.dylib` on macOS with Homebrew. Leave unset on Linux.          |
| `CORS_ALLOWED_ORIGIN`                                                           | Exactly one frontend origin allowed by CORS. Wildcards and lists are rejected at startup.                                                                                                                                                                        |
| `WEB_ORIGIN`                                                                    | Origin of the web app, where the Admin sends editors for the visual camera editor. Required; independent of `CORS_ALLOWED_ORIGIN`. One bare origin (scheme, host, optional port: no path, credentials or trailing slash), `https` outside `APP_ENV=development`. |
| `MEDIA_STORE`                                                                   | Where photograph media lives: `filesystem` for local development and tests (rejected outside `APP_ENV=development`) or `s3` for an S3-compatible store such as Cloudflare R2. Required; nothing is inferred from other variables.                                |
| `MEDIA_ROOT`                                                                    | `filesystem` only. Media directory, relative to `services/api` (`.media` in `.env.example`, ignored by Git).                                                                                                                                                     |
| `MEDIA_PUBLIC_BASE_URL`                                                         | Base URL of the public renditions, without a trailing slash, query or fragment. Must be `https` outside `APP_ENV=development`.                                                                                                                                   |
| `MEDIA_S3_ENDPOINT_URL`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` | `s3` only. `https` endpoint and credentials, from the environment only.                                                                                                                                                                                          |
| `MEDIA_PUBLIC_BUCKET`, `MEDIA_ORIGINALS_BUCKET`                                 | `s3` only. Two different buckets: public renditions and private originals.                                                                                                                                                                                       |
| `LEGACY_DATABASE_URL`                                                           | Optional. Legacy database connection used only by the legacy catalog export.                                                                                                                                                                                     |

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

`GET /api/v1/mountains/{slug}` returns an `active` or `inactive` mountain as JSON (`application/json; charset=utf-8`), in the shape of `contracts/v1/mountain-*.json`: camelCase members, members without a value omitted (never `null`), `continent` and `countries` always present. The lookup is exact and case-sensitive. A `draft` mountain, an unknown slug and a slug that breaks the slug rule answer `404 {"error":{"code":"MOUNTAIN_NOT_FOUND","message":"Mountain not found"}}`; any other failure answers `500` with code `INTERNAL_ERROR` and never its cause, which is logged with its traceback. The endpoint sends no `Cache-Control` header and answers JSON whatever the `Accept` header asks for. `today` and `random` are reserved words, never routed to this endpoint.

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

A mountain serves `continent` as `{code, name}` and `countries` as a list of `{code, name}`, which v1 did not: v1 listed country names as text and had no continent. `continent` is always present; `countries` is always present and may be empty (a new draft can have none). Countries are ordered by English name in code point order, then by code. The `code` is the stable key (an approved continent code `AF AN AS EU NA OC SA`, an ISO 3166-1 alpha-2 country code) and `name` is the English name; the Spanish and Portuguese names are stored but not served, and the API and the web are English-only. The three Antarctic mountains, which v1 left without a country, now link `AQ`. See Geography and reference data.

The v1 fixtures stay untouched. The API tests turn each fixture into SerendiPeak's own document by applying exactly these changes, and compare every response with the result member by member: `primaryImage.url` and `primaryImage.thumbnailUrl` hold owned media URLs, `attribution` is renamed `author`, and `creator` and `sourceIdentifier` are dropped, and `prominenceMeters` and `sources.wikipedia` are dropped (`sources` goes with them when nothing is left), and `continent` and the `{code, name}` countries are derived from the v1 country names by a rule that exists only in the tests and is not editorial (the names through the alias table, the continent of the first country, `AQ` and Antarctica for a mountain without any, and an explicit synthetic Europe for the invented mountain of `mountain-minimal.json`). Any other difference fails. `node scripts/verify-api.mjs` is the live-API counterpart of the vendored `contracts/v1/verify-api.mjs`, which describes the v1 API and is no longer run: it differs from it only in those members, fails when `prominenceMeters` or `sources.wikipedia` is served or `countries` are served as names, checks the shape of `continent` and `countries` (an approved continent code, well-formed unique country codes, the order above), and checks each of the 73 photographs by source page and dimensions. With `--geography <file> --geography-sha256 <hash>` it also compares the continent and country codes of the mountains the private geography input covers; without them it says that the comparison of values was skipped.

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

### Legacy catalog export

`services/api/seed/legacy-catalog-v1.json` is the seed input for the catalog bootstrap: every legacy mountain, its primary image and the daily discovery history. It is never a source of truth; the database is the canonical catalog.

`services/api/tools/export_legacy_catalog.py` produces it. The application never imports the tool. The tool imports the seed format and the content hash from the application seed parser, so the export and the bootstrap share one definition of both, and it runs as a module from `services/api`. It reads the legacy database inside one `REPEATABLE READ, READ ONLY` transaction with SELECT statements only, and reads `data/media.yaml` from the legacy repository at the frozen commit (after checking that `v1-behavioral-freeze` points to it), never from the working tree. It stops without writing when the legacy schema is not at version 9, when a legacy column is neither exported nor deliberately dropped, or when the media manifest disagrees with a stored image.

```sh
cd services/api
LEGACY_DATABASE_URL=postgres://serendipeak:serendipeak@localhost:5433/serendipeak \
  uv run python -m tools.export_legacy_catalog --legacy-repo ../../../serendipeak-legacy
```

The output is deterministic for a given `--exported-on` date (default: today in UTC). The artifact records the format and version, the export date, the legacy tag, commit and schema version, the sha256 of the media manifest, row counts and `content_sha256`. `content_sha256` is the SHA-256 of `content` serialized as UTF-8 JSON with sorted keys, `(",", ":")` separators, non-ASCII characters unescaped and no NaN, so it does not depend on the file layout or the export date.

The seed keeps each image's Commons `url` and `thumbnail_url`, `creator`, `source_identifier`, `license_reported`, `license_election_basis_url` and `approved_on`: the record of how each of the 73 photographs was imported and of the rights evidence behind its license. Loading validates all of them and stores none: the catalog keeps the photograph, so its `attribution` becomes the photograph's `author` and nothing else of that record reaches the database. The seed stays the durable record of that evidence, protected by `content_sha256`, and the photograph manifest pins each file's URL. The image rows drop the legacy `id`, `type`, `source`, `title`, `is_primary` and `created_at` columns: every image is the primary `wikimedia_commons` image and its title is the file name without the `File:` prefix and the extension, both checked during the export. `license_reported`, `license_election_basis_url` and `approved_on` come from the media manifest and are `null` for images without a manifest entry. Mountain `status` keeps the legacy values. The seed also keeps each mountain's `prominence_meters`, `wikipedia_url` and `osm_type` with `osm_id`: loading validates the first two and stores neither, and folds the last pair into `osm_node_id`, refusing a reference that is not a node.

### Catalog bootstrap

The PostgreSQL/PostGIS database is the canonical catalog. `bootstrap_catalog` loads the seed artifact into an empty database once; `check_catalog` checks the publication invariants.

```sh
cd services/api
uv run --env-file ../../.env python manage.py migrate
uv run --env-file ../../.env python manage.py bootstrap_catalog --geography <file> --geography-sha256 <hash>
uv run --env-file ../../.env python manage.py check_catalog
```

The seed holds neither continents nor country codes, and a mountain needs a continent, so `bootstrap_catalog` needs the private geography input and its checksum (see Geography and reference data) and refuses before writing without them. The input has to cover every seed mountain, and its countries have to agree with the seed's country names through the alias table; entries of mountains the seed does not have are ignored.

- `bootstrap_catalog` validates the seed (format, legacy tag and commit, `content_sha256`, counts, field types, coordinate range) and compares it with the frozen `contracts/v1/catalog.json` before writing. It then loads mountains, images and daily discoveries in one transaction, keeping the legacy ids and timestamps, and verifies the stored catalog against the seed and the frozen catalog. Coordinates are compared within 1e-7 degrees and camera values within 1e-9; every other value exactly. Legacy `pending_media` becomes `draft`, which is never publicly visible.
- It refuses when the catalog already holds mountains. The emptiness check and the load run in one transaction that first locks the `mountain` table against concurrent writes (`SHARE ROW EXCLUSIVE`; reads are not blocked), so a concurrent second run waits for the first, then refuses and loads nothing. The load is all or nothing; foreign keys are deferred, so a reference to a missing mountain fails when the transaction commits and nothing is kept.
- The verification runs after the load has committed. When it reports mismatches, the loaded rows stay; recreate the database, run `migrate` and `bootstrap_catalog` again.
- `bootstrap_catalog --verify-only` runs only the verification, writes nothing and can be repeated. With `--geography` and `--geography-sha256` it also compares the continent and countries of the seed mountains and says `Geography: compared.`; without them it leaves those out and says `Geography: not compared`. It verifies a freshly bootstrapped catalog, not a catalog in use: later daily discoveries and catalog edits are legitimate differences from the seed, and it reports them as mismatches.
- `check_catalog` is the routine check. It does not compare the catalog with the seed and can run at any time.
- `check_catalog` checks every `active` mountain: valid slug, coordinates in range, positive elevation, a curated camera with framing inside the bounds, a primary image with owned media, dimensions and an author, a license URL only with its license name, and a summary that follows the summary rules when there is one.

`--seed` and `--frozen-catalog` replace the input files. On failure each command lists the mismatches or violations on stderr and exits with status 1.

### Geography and reference data

Every mountain has one **continent** and any number of **countries**, both references to fixed reference tables, and its name and summary are stored per language.

- **Localized text.** `mountain.name_en`, `name_es`, `name_pt` and `summary_en`, `summary_es`, `summary_pt`. English is the required language: `name_en` is never blank and the summary rules (`summary_violations`, the publication gate) apply to `summary_en` exactly as they always applied to the summary. The Spanish and Portuguese columns are null or not blank, and a summary translation needs `summary_en` (`mountain_summary_translation_requires_english`). Nothing writes a translation, the API and the web serve the English text only, and a missing translation will read as English once a consumer selects a language. Ids, slugs and codes never depend on a language.
- **Continent.** Table `continent`, seven fixed rows with the codes `AF AN AS EU NA OC SA` and names in English, Spanish and Portuguese. `mountain.continent_code` is `NOT NULL` on every status and `PROTECT`ed. The continent of a mountain is an editorial, explicit assignment, never derived from its countries: the Canary Islands belong to Africa although Spain is in Europe. Convention for the Europe-Asia boundary: the Ural Mountains, the Ural River, the Caspian Sea and the crest of the Greater Caucasus, applied to the position of the summit, never to the country.
- **Country.** Table `country`, 249 rows keyed by ISO 3166-1 alpha-2 code, with names in the three languages, a unique English name and a reference continent (UN M49 as CLDR publishes it, except `AQ`, which is Antarctica). `mountain_country` links mountains to countries with the composite primary key `(mountain_id, country_code)`, both keys `PROTECT`ed, and an index for the reverse lookup. Countries are never inferred from coordinates. A country of a mountain is edited as a link; the reference rows have no write path in the application.
- **Reading.** A mountain read by slug costs two queries: the mountain with its photograph and continent, then its countries.

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

Which continent a mountain is on and which countries it is in is editorial data, and mutable editorial data is not versioned in Git. It lives in the database and, for transfers and for initializing an empty environment, in a private, checksum-verified JSON file that is kept outside the repository and covered by the owner's backups. The tools take explicit paths and never default into the working tree.

```json
{
  "format": "serendipeak.geography",
  "version": 1,
  "content_sha256": "<sha256 of the canonical content>",
  "mountains": [
    { "id": "<uuid>", "slug": "<slug>", "continent": "<AF|AN|AS|EU|NA|OC|SA>", "countries": ["<ISO alpha-2>"] }
  ]
}
```

`content_sha256` is the SHA-256 of the canonical serialization (UTF-8, sorted keys, no whitespace) of everything but itself, and every command that reads the file also takes the expected checksum, which must match; otherwise it stops before it reads the database. The tracked parser (`catalog/geography_input.py`) validates the format, unique ids and slugs, approved continent codes, well-formed unique country codes known to the reference data, and, against a catalog, **coverage** (every mountain appears exactly once, matched by id and slug; an entry without a mountain aborts the run) and **agreement** (the countries of an entry map, through the alias table of the v1 country names, to the names the mountain still stores; `AQ` is the one link that needs no legacy name).

- `prepare_geography_input --output <file>` is read-only. It writes a draft from the database: ids, slugs and countries (the v1 names mapped to codes while the catalog still holds them), the continents empty and the checksum unset, so a draft can never be applied. The operator fills in the continents and freezes the file by writing the checksum, which `catalog.geography_input.geography_content_sha256` computes.
- `apply_geography_backfill --input <file> --sha256 <hash> [--dry-run]` prints the target first (database, host, port, catalog migration) and then judges the input against the stored mountains. It runs in one transaction under a lock on the mountain table, writes only the continent and the country links (no other column and no timestamp), is idempotent and creates, deletes or edits no mountain. `--dry-run` reports every change and writes nothing. It refuses a schema that is not the one it is meant for, and once the final migration below is applied it only reports.

#### Converting an existing database

Three stages, so that no migration carries editorial data and a database with mountains converts without losing any:

1. `migrate` up to `0017_mountain_continent`. The migrations carry the schema and the reference data only: `0014_localized_mountain_text` renames `name` and `summary` to the English columns and adds the others, `0015` and `0016` create and fill the reference tables and the link table, and `0017` adds a nullable `continent_code`. The legacy text array `countries` stays.
2. `apply_geography_backfill`, first with `--dry-run`, then for real.
3. `migrate` to the head. `0018_geography_final_validation` refuses, naming the mountains, while one has no continent or its links disagree with the legacy country names (through the alias table, with `AQ` accepted), and only then makes `continent_code` `NOT NULL` and drops the text array. On a database without mountains it passes on zero rows. Reversing restores the text array from the links in alphabetical order and refuses a country that v1 had no name for.

A database that is initialized from the seed is built by `migrate` and `bootstrap_catalog --geography … --geography-sha256 …`.

### Editorial admin

Django Admin at `/admin/` is the editorial interface. It edits the catalog in place; there is no other source of truth. The admin sets session and CSRF cookies (`Secure` outside `APP_ENV=development`, `HttpOnly`, `SameSite=Lax`), sends `X-Frame-Options: DENY`, and loads no map tiles: coordinates are plain latitude and longitude fields. The public API is unaffected: it sets no cookies and no frame policy.

#### Users and roles

Accounts are `catalog.UserRecord` (`AUTH_USER_MODEL`, table `app_user`): a username, a hashed password, a role, an active flag, `last_login` and `date_joined`. There are no staff or superuser flags, groups, per-user permissions, names or email addresses. Django's session authentication, CSRF protection, password hashers (PBKDF2 by default), password validators and password views are used unchanged.

- **Roles.** An **Editor** reads and writes everything: mountains, publication, photographs, the camera and users. A **Viewer** reads the mountains and the daily discoveries and writes nothing, and does not see the users. Anonymous visitors and inactive users reach no admin page and cannot sign in. Authorization is derived from the role on every request, so a role or active-state change takes effect on the user's next request. `django.contrib.auth` stays installed, so its permission and group tables exist and stay empty; no code reads them.
- **Usernames** are 3 to 32 lowercase letters, digits, dots, hyphens or underscores, starting with a letter or digit. The database enforces the format, so two usernames never differ only in case; sign-in folds the typed username to lowercase, so it is case-insensitive while the stored form stays canonical.
- **Passwords** need at least 8 characters and must not be common, entirely numeric or similar to the username; there are no composition rules (uppercase, digits, symbols). This is a deliberately light single-factor policy for local development, not a recommended policy for an internet-facing Studio: the Studio needs brute-force protection on the login before it is exposed to the internet, and stronger authentication such as multi-factor can be evaluated then, together with this policy. Setting or changing a password writes only the password column, so it can never overwrite a concurrent role or active-state change. The same policy applies to a new user, to a password set for another user and to a user changing their own password; setting a new password ends the other sessions of that user.
- **Access guards.** An Editor cannot deactivate or change the role of their own account, only an active Editor can change anyone's access, and the last active Editor can never be demoted or deactivated. The check and the change run under one row lock on the accounts involved, so two Editors acting at the same time cannot leave the system without an Editor. Users are deactivated, never deleted.
- **First Editor.** `manage.py create_editor <username>` creates an active Editor. The password is read from `SERENDIPEAK_EDITOR_PASSWORD` when it is set and prompted for twice otherwise; it is never accepted as an argument. The command refuses a taken username and leaves that user unchanged, and it can add another Editor to recover access when every Editor is locked out. Create the first Editor with it after `migrate`; `createsuperuser` does not apply to this user model.
- The `catalog` migration `0013_user_record_and_role_permissions` creates the user table, runs before the admin's migrations because the admin log references it, and drops the former `publish_mountain` permission. Django cannot swap the user model on a database that already applied the admin migrations: such a database is rebuilt or its catalog tables are copied into a freshly migrated one.

- A mountain is created as a `draft` with every field the form offers. A draft is editable and never public: it is not served by slug, `today` or `random`. The status is never a form field.
- The mountain page has the sections Publication, Mountain (name, slug, latitude, longitude, elevation), Geography (continent, countries, range), Editorial (summary), Camera and a collapsed Additional data (OpenStreetMap node id, Wikidata id). The add page has no Publication and no Camera section.
- Mountain data stays editable on every status: name, coordinates, elevation, continent, countries, range, summary and the additional data. The continent is required on every mountain, drafts included, and is chosen from the seven continents; it is never derived from the countries. Countries are a selection over the 249 reference countries (`Name (CODE)`, searchable, ordered by English name); saving writes only the links that differ, in the same transaction as the mountain. A mountain may have none. A draft that still has countries cannot be deleted until they are removed, like a draft with a photograph. The name and summary are the English text; the Spanish and Portuguese columns exist but nothing writes them yet. The changelist shows the continent and the country codes and searches by English country name. Continents and countries are reference data: they have no Admin page. Latitude and longitude are form fields; saving rebuilds the stored point from them.
- The slug is editable on every status and keeps its syntax, reserved-name and uniqueness checks. The catalog is a pre-cutover editorial seed, so a slug change does not leave redirects or history.
- The camera is read-only in the mountain form, which never writes it, including on creation, so a draft starts without a camera; publication still needs one. The Camera section shows the stored values and whether they are complete and within bounds.
- **Edit camera visually** (object tools and Camera section, for Editors only) opens the camera editor on `WEB_ORIGIN` at `/editorial/camera`, with the mountain and its stored camera in the query because a draft has no public API. The editor renders the real stage, shows the live pose as it would be saved and, on **Save camera…**, navigates to the confirmation page below with the quantized camera (heading and pitch to two decimals, range to the meter, framing to four). It writes nothing itself and never navigates to an address taken from its query: the Admin is located by `NEXT_PUBLIC_API_BASE_URL`. The confirmation page offers the way back to the editor.
- The camera changes only through its confirmation page, `/admin/catalog/mountainrecord/<id>/camera/?heading=…&pitch=…&range=…&fx=…&fy=…`, which needs the Editor role and works on every status:
  - Opening it writes nothing. It compares the current camera with the proposed one and says whether the mountain is public. A query that is not five finite numbers, or a camera outside the bounds or without framing, is answered with the reason and no save button.
  - Saving is a CSRF-protected POST that carries the proposed camera and the current camera the page showed. The camera is replaced only if the stored one still equals the one shown, compared exactly, under the same mountain row lock as edits and status changes; otherwise nothing is written and the page reopens with the newer camera to confirm again. The save writes the five camera columns and `updated_at`, never the status, and records `Camera changed.` in the history. The camera rules are those of publishing, so a public mountain stays publishable.
  - The lock does not conflict with the foreign-key lock of a daily discovery, so a camera save never delays the public API.
- OpenStreetMap and Wikidata references are optional. When present, the OpenStreetMap node id is a positive integer and the Wikidata id is a `Q` item id. Reversing the `catalog` migration `0005_optional_provenance` restores the former requirement that an `active` mountain has both references, so the reversal fails, and changes nothing, while an active mountain lacks either one; no data is invented to make it pass.
- The `catalog` migration `0012_catalog_pruning` turns `osm_type` and `osm_id` into `osm_node_id` and drops `prominence_meters` and `wikipedia_url`. It stops without changing anything when a row references a way or a relation. Reversing it restores `osm_type` (as `node`) and `osm_id` and leaves the prominence and the Wikipedia link empty; the seed still holds both.
- A photograph is uploaded, from any source, together with its credit; see Editorial photographs.
- Every save writes `updated_at`. The change history records who changed what.
- The summary is one trimmed line of at most 200 characters with no markup and in sentence form (a capitalized first word and a final period, by the same formatting rules as v1). The form shows why a summary is refused, and publication refuses a mountain whose stored summary breaks them.
- The mountain page opens with a read-only Publication section: the status, the timestamps and, for a draft, either `Ready to publish` or the reasons it cannot be published. Readiness uses the same checks as publishing and judges the saved mountain, not unsaved form edits. The summary is a multiline text area.
- List filters always show their counts.
- Statuses change only through the changelist actions and the single button on the mountain page (Publish for a draft, Deactivate for an active mountain, Reactivate for an inactive one). Both call the publication use cases, are for Editors only and act on the saved mountain, so save edits before using the button. Saving the form never changes the status:
  - **Publish** moves `draft` to `active`. It is refused, with the reasons, unless the mountain passes the same checks as `check_catalog`.
  - **Deactivate** moves `active` to `inactive`: the mountain stays addressable by slug and keeps its daily history, and leaves `random`.
  - **Reactivate** moves `inactive` to `active`, with the same checks as publishing.
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

The `catalog` migration `0011_minimal_photograph` keeps in `mountain_image` what visitors and editors use: the media, its dimensions, the `author` (the previous `attribution`, which is the credit visitors saw), the optional source page and the license. It drops the creator, the creator link, the Commons file title, the import's file URL, reported license, election basis and approval date: the seed and the photograph manifest keep those, and a fresh bootstrap restores the 73 photographs without them. Applied to a populated database it loses those columns for good. Reversing restores the columns empty and fails, changing nothing, while a photograph has no source page. Reversing `0008_source_agnostic_photograph` further back fails once a photograph was uploaded, because it restores the required legacy file URL and source identifier.

### Photograph media

Mountain photographs are owned by SerendiPeak and stored as uploads, never hotlinked. An external URL is provenance only. Each photograph is stored as three content-addressed objects named after the SHA-256 of the original bytes:

- `photographs/{sha256}/original.{jpg|png|webp}`: the original, byte for byte, in a private location. The extension comes from the decoded format, never from the file name.
- `photographs/{sha256}/page-r2.jpg`: the page rendition, at most 1280 pixels wide.
- `photographs/{sha256}/viewer-r2.jpg`: the viewer rendition, at most 2560 pixels on the long edge.

Renditions are progressive 8-bit sRGB JPEGs at quality 85 with the EXIF orientation applied, transparency flattened onto white and no metadata (no EXIF, GPS, XMP, ICC profile or comments). They keep the aspect ratio and are never upscaled. `r2` is the current rendition version: public objects are cached for a year as immutable, so changing any rendition parameter needs a new version rather than new bytes under an existing key. `r2` replaced `r1` because decoding a large JPEG at a reduced scale changes the rendition bytes of some photographs. Photographs already published under `r1` (the 73 of the development catalog) keep their `r1` keys and objects, which stay valid and are never rewritten; a photograph materialized or uploaded from now on gets `r2` keys; a row keeps the version it was written with. Objects are never overwritten and never deleted automatically; storing the same photograph again writes nothing, and a retry after a partial failure writes only the missing objects. The original is stored before its renditions.

Only JPEG, PNG and WebP decoded from the content are accepted; animated images and other formats are rejected. Corruption detection is whatever Pillow rejects: the file is verified and then fully decoded, and a truncated or undecodable image is refused (`LOAD_TRUNCATED_IMAGES` is never enabled). Some damaged JPEGs are still decodable, and libjpeg completes the missing data with gray pixels; such a file is accepted, because ingestion makes no forensic claim beyond what Pillow can reject. A JPEG may have at most 200 megapixels and a PNG or WebP at most 25, checked from the header before any pixel is decoded. A JPEG is decoded at the smallest DCT scale (1/2, 1/4 or 1/8) that still covers both renditions, whatever its shape, and is refused when even that would decode more than 50 megapixels, which only a very long and narrow photograph does; a photograph whose rendition would be longer than JPEG's 65535 pixels is refused too. A failure while rendering a decoded photograph is reported as a processing failure, not as a rejection of the file. An editor's upload may have at most 30 MiB; photographs of the existing catalog may have up to 150 MiB (the largest of the 73 has 78.4 MiB).

An image row records its photograph media in four columns (`original_key`, `original_sha256`, `page_key`, `viewer_key`): all or none, each matching the key or digest format, and only with dimensions. The public API derives the photograph URLs from these keys and the configured `MEDIA_PUBLIC_BASE_URL` and never exposes the keys. The database also ties the keys to the checksum: `original_key` starts with `photographs/{original_sha256}/original.`, and `page_key` and `viewer_key` are the page and viewer keys of that checksum under one published rendition version (`r1` or `r2`), the same for both. A new rendition version therefore needs a migration that widens those constraints along with the code that builds the keys. An image without media is not served as a photograph (see Photograph delivery).

Production stores photographs in S3-compatible storage (Cloudflare R2): outside `APP_ENV=development`, `MEDIA_STORE=filesystem` is rejected at startup, because a deployment without a volume would lose its media on every redeploy. With `MEDIA_STORE=filesystem` (development and tests), originals and public renditions live in separate `originals/` and `public/` directories under `MEDIA_ROOT`. In development only, Django serves the public directory at `/media/`; originals are never served. With `MEDIA_STORE=s3`, originals go to `MEDIA_ORIGINALS_BUCKET` and renditions to `MEDIA_PUBLIC_BUCKET` with `Cache-Control: public, max-age=31536000, immutable`. No ACLs are sent; bucket policy alone makes the public bucket public. Requests use region `auto`, a 5 s connect and 60 s read timeout, and at most three attempts with the SDK's standard backoff.

#### Materializing the catalog photographs

The seed records where each of its 73 photographs was published (the Commons original file URL), and the photograph manifest pins that file; neither is the photograph itself. `materialize_photographs` copies those files into the media store; until it has run, an image has no media and the mountain is served without a photograph. A local database needs this one-time run to show photographs: with `--cache-dir` the files are downloaded once and later rebuilds need no network, and `--slug` limits the run to a subset. It is the only part of the backend that downloads anything, and the public API never does.

```sh
cd services/api
uv run --env-file ../../.env python manage.py materialize_photographs --cache-dir ../../.photograph-cache
uv run --env-file ../../.env python manage.py check_photograph_media --deep --checksums
```

For each photograph without media, in slug order and one at a time, it downloads the file the manifest pins for that mountain in `services/api/seed/legacy-photographs-v1.json` (or in the manifest given with `--manifest`; https only, redirects included, at most 150 MiB, with a descriptive User-Agent), runs it through the same ingestion as an upload, and requires the decoded, oriented dimensions to equal the photograph's stored dimensions and the file to be the pinned one: its checksum, size and dimensions. The manifest is always in force; there is no way to run without it. Only then are the original and the two renditions stored, and only after all three exist is the media attached to the image row, in a short transaction that locks the mountain and then its image and changes nothing else (not even `updated_at`). Attaching is refused when the row changed meanwhile: other dimensions or other media.

The manifest also decides what the command contacts: the operator's network may reach hosts an editor's browser cannot, and the catalog holds no file URL. The fetcher itself contacts only `upload.wikimedia.org`, on the https port, redirects included. A photograph the manifest does not pin is never downloaded: it is materialized only with an explicit `--file SLUG=PATH`, which still has to have the photograph's dimensions.

- `--manifest PATH` uses this manifest instead of the committed one.
- `--cache-dir DIR` keeps each downloaded file (named after the SHA-256 of its URL) and reads it from there on later runs, so a rebuild needs no network.
- `--dry-run` downloads and verifies every file but stores and attaches nothing.
- `--slug SLUG` (repeatable) limits the run to those photographs.
- `--file SLUG=PATH` uses a local file instead of downloading. For a pinned photograph it goes through the same dimension and manifest checks: a different file is never accepted, so an archived revision of a changed Commons file is accepted only after the manifest is deliberately changed to pin it. For a photograph outside the manifest it is the only way in, and only the dimension check applies.
- `--write-manifest PATH` writes the manifest of the run to a new file. It is written only when the run covered the whole catalog and downloaded and verified every photograph. It never replaces a file holding another manifest, including the committed one: it succeeds, writing nothing, when the file already holds exactly this manifest.

Every photograph gets one line, then a summary with the largest source file. A failed photograph never stops the run, and the command exits non-zero listing the failures:

| Failure                                                                                 | What happens                             | What to do                                                                                                         |
| --------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| download failed (network, timeout, non-200 status, non-https redirect, over 150 MiB)    | nothing is stored                        | rerun; use `--file` if the source is gone                                                                          |
| not an accepted image, or other dimensions than the photograph's                        | nothing is stored                        | the Commons file probably changed: find the archived revision with the stored dimensions and pass it with `--file` |
| `checksum_differs` or another manifest difference, or a photograph outside the manifest | nothing is stored                        | as above; the manifest pins the file materialized first. Outside the manifest, pass the file with `--file`         |
| storage failed part way                                                                 | nothing is attached                      | rerun: objects already stored are skipped                                                                          |
| stored but not attached (database error, or the row changed meanwhile)                  | the objects exist but are not referenced | rerun: the same file has the same keys, so it attaches without uploading                                           |

A photograph that already has media, uploaded in the Admin or not, is left alone and is not compared with the manifest. The file URL in the manifest is the materialization source only; it is never delivered.

A rerun skips photographs that already have media (`already attached`) without downloading or comparing them.

`check_photograph_media` checks every image, in any status, and exits non-zero on any problem. These checks hold for any photograph, whoever uploaded it: by default that the row has media whose keys derive from its checksum; `--deep` also that the original and both renditions exist in the store; `--checksums` (implies `--deep`) also downloads every original and compares its SHA-256 with the stored checksum. `--manifest [PATH]` adds the proof of the import: every photograph the manifest pins (the committed one unless given a path) must be the pinned one, with its checksum and dimensions, so media that is consistent with itself but is another file than the pinned one fails, and a pinned photograph the catalog no longer has is a problem. Together with `--deep --checksums` it proves that the stored bytes are the pinned ones.

The catalog keeps no record of which photographs are imported, so a pinned photograph that an editor replaced differs from its pin by design: `--manifest` is for the time between the import and the first replacement, and `--write-manifest` writes nothing while the catalog holds a photograph the run did not download. The checks without `--manifest` stay meaningful afterwards. A fresh bootstrap restores the 73 photographs.

The manifest pins the 73 photographs from their first materialization: per mountain id, the slug and file URL from the seed, and the SHA-256, size and dimensions of the file. Legacy never stored bytes, so the identity it proves is the same Commons file at the same dimensions; from the first materialization on, the checksum pins the bytes and every rendition key contains it. The seed and the manifest are consistent with each other (checked by a test), and the manifest belongs to the import, not to the catalog.

An environment is ready for owned photographs when, on a freshly bootstrapped and materialized catalog, `check_photograph_media --deep --checksums --manifest`, `check_catalog` (which reports a missing photograph file as `image_media_missing`) and `bootstrap_catalog --verify-only` are clean, and `node scripts/verify-api.mjs` passes against the running API. Media is attached after the bootstrap and is not part of the seed, so `--verify-only` ignores it.

These import checks assume the 73 photographs are unedited. `bootstrap_catalog --verify-only` compares each mountain and photograph with the seed, `check_photograph_media --manifest` with the manifest, and `node scripts/verify-api.mjs` compares each photograph's source page and dimensions with the frozen v1 values. A photograph replaced in the Admin carries none of those, so they report it as a mismatch that looks like a regression but is not. Run them before any editorial photograph change, or expect and name the mismatches; `check_photograph_media` without `--manifest` and `check_catalog` stay meaningful afterwards.

The R2 smoke test checks a real S3-compatible store and is deselected by default; run it on demand with the development bucket settings (`MEDIA_STORE=s3`): `uv run --env-file ../../.env pytest -m r2_smoke`. It stores a few bytes under fresh keys, reads the original back, checks that the original is not reachable through `MEDIA_PUBLIC_BASE_URL`, and fetches the public object through it with its `Content-Type` and immutable `Cache-Control`.

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
