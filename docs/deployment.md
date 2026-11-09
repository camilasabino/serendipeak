# Deployment and operations

How SerendiPeak runs in production on Railway, Cloudflare R2 and PostgreSQL/PostGIS, how to change it safely, and how to recover it. It also describes how to initialize a new environment from a catalog snapshot, which is the path for disaster recovery and for a second environment.

Nothing in this file is a credential. Values in `<angle brackets>` are chosen by the operator and never committed. Commands run from the repository root unless a `cd` says otherwise. For environment variables and application behavior see the [developer reference](engineering/developer-reference.md).

## Rules that apply to every operation

- **Secrets live in two places only**: Railway variables, and an _operator environment file_ kept outside the repository (see "Operator shell"). Never in Git, in a chat, in shell history or in a command-line argument.
- **Confirm the target before every command that writes**: `railway status` for Railway, and the printed database and bucket names for the management commands. Several commands print their target on purpose; read it.
- **A failed catalog load is recreated, never patched**: drop the database, `migrate`, load again.
- **The snapshot file is private editorial data.** It lives in a directory outside the repository that the owner backs up, next to a note of its `content_sha256`. The tooling refuses paths inside the repository.

### What stays outside the repository

This runbook documents procedures and shapes. Keep these in the owner's private notes or password manager instead:

- the operator environment file and every real variable value, token and password;
- the inventory of R2 and Railway tokens, their scopes and rotation dates;
- Railway project, environment and service identifiers and the Cloudflare account identifier;
- catalog snapshot files, database dumps, scratch key lists and the notes that record their checksums;
- the location of the second copy of the originals bucket and who refreshes it.

## Services and names

| Unit                           | What it is                                                                                                           | Public                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `postgres`                     | PostgreSQL with PostGIS, same major version as CI (`postgis/postgis:18-3.6`), on a volume                            | never                                       |
| `api`                          | image built from `services/api/Dockerfile`; serves the API and the Studio                                            | `https://api.serendipeak.camilasabino.dev`  |
| `web`                          | image built from `apps/web/Dockerfile`                                                                               | `https://serendipeak.camilasabino.dev`      |
| `backup`                       | cron service built from `services/backup`; daily `pg_dump` to a private R2 bucket                                    | never                                       |
| `prune`                        | cron service, same image and variables as `api`; applies the daily discovery retention (see "Daily discovery retention") | never                                       |
| R2 bucket `<public-bucket>`    | public photograph renditions                                                                                         | `https://media.serendipeak.camilasabino.dev` (custom domain) |
| R2 bucket `<originals-bucket>` | private original photographs                                                                                         | never                                       |

`WEB_ORIGIN` and `CORS_ALLOWED_ORIGIN` are single origins and must name the web origin in use. The web build inlines the API origin, so changing the API host needs a new web build. A custom domain on an R2 bucket needs the zone, or a Cloudflare-supported partial setup for that hostname, on Cloudflare.

## Operator shell

Management commands against production run from a checkout on the operator's machine, with the production values in a file outside the repository. Run them through a clean environment so nothing from a development shell or the repository's own `.env` leaks in (`uv run --env-file` does not override variables that are already set):

```sh
export OPERATOR_ENV=<path to the operator environment file>   # outside the repository, mode 600
prod() { env -i PATH="$PATH" HOME="$HOME" uv run --env-file "$OPERATOR_ENV" "$@"; }
```

The file holds the same variable names as the `api` service with the database URL of the SSH tunnel (`127.0.0.1` and its local port) and the production media settings, plus `GDAL_LIBRARY_PATH` and `GEOS_LIBRARY_PATH` on macOS. `APP_ENV` is `production`. Use a dedicated R2 token for it and revoke the token when the work is done.

Before each production session:

```sh
git status --porcelain            # empty
git rev-parse HEAD                # the commit the deployed images were built from
cd services/api
prod python -c "import os,urllib.parse as u; d=u.urlsplit(os.environ['DATABASE_URL']); print(d.hostname, d.path)"
```

The printed host and database must be the tunnel's local address and the production database name; check that the tunnel, not a development database, is what listens on that port.

## 1. Service configuration

Each service builds from the `Dockerfile` in its directory (Railway root directories `services/api`, `apps/web` and `services/backup`). Do not set a custom start command on `api` or `web`: the image's own `CMD` runs the server as PID 1. Config-as-code files are not used.

Generate secrets with at least 32 random characters, all different:

```sh
openssl rand -base64 48   # DJANGO_SECRET_KEY
openssl rand -base64 48   # PREVIEW_SIGNING_KEY
```

**`api`** (and `prune`, which loads the same settings, so it needs the same values; use shared or reference variables):

| Variable                                                                        | Value                                                                                                                                    |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                                                                       | `production`                                                                                                                             |
| `DATABASE_URL`                                                                  | reference to the Postgres service's private `DATABASE_URL`                                                                               |
| `DJANGO_SECRET_KEY`, `PREVIEW_SIGNING_KEY`                                      | the generated secrets                                                                                                                    |
| `ALLOWED_HOSTS`                                                                 | `api.serendipeak.camilasabino.dev,healthcheck.railway.app`; add the Railway-generated hostname only while it is in use, or remove that domain from the service |
| `CORS_ALLOWED_ORIGIN`, `WEB_ORIGIN`                                             | `https://serendipeak.camilasabino.dev` (no path or trailing slash)                                                                       |
| `TRUSTED_PROXY_HOPS`                                                            | `1`, only while the conditions of "Trusting forwarded headers" hold                                                                      |
| `MEDIA_STORE`                                                                   | `s3`                                                                                                                                     |
| `MEDIA_PUBLIC_BASE_URL`                                                         | `https://media.serendipeak.camilasabino.dev`                                                                                             |
| `MEDIA_S3_ENDPOINT_URL`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` | R2 endpoint and a token scoped to the two production buckets only                                                                        |
| `MEDIA_PUBLIC_BUCKET`, `MEDIA_ORIGINALS_BUCKET`                                 | `<public-bucket>`, `<originals-bucket>`                                                                                                  |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`                                           | `35` (Gunicorn waits up to 30 s for in-flight requests)                                                                                  |
| `WEB_CONCURRENCY`                                                               | optional, default `2`                                                                                                                    |
| `SECURE_HSTS_SECONDS`                                                           | optional; raise in steps (300, then a day, then longer), redeploying `api` each time. Browsers remember it for the whole period          |

**`web`** (build arguments: a change needs a new build):

| Variable                          | Value                                                                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL`        | `https://api.serendipeak.camilasabino.dev` (the build fails unless it is an `https` origin)                                                  |
| `NEXT_PUBLIC_CESIUM_ION_TOKEN`    | a Cesium ion token restricted to the allowed web origins in the ion dashboard (the build fails when empty; the value ships to every browser) |
| `NEXT_PUBLIC_CESIUM_IMAGERY_MODE` | unset (`world` in production)                                                                                                                |

**Service settings:**

| Setting                  | `api`                                                                                                             | `web`                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Pre-deploy command       | `python manage.py migrate --noinput`                                                                              | none                                                                       |
| Health check path        | `/healthz`                                                                                                        | `/brand/serendipeak-mark.png` (a static file: the pages depend on the API) |
| Health check timeout     | 120 s                                                                                                             | 120 s                                                                      |
| Memory                   | at least 2 GiB (one photograph upload decodes up to about 0.6 GiB above the idle worker; two editors can overlap) | default                                                                    |
| Public domain            | yes                                                                                                               | yes                                                                        |
| TCP proxy                | never                                                                                                             | none                                                                       |

Never add a TCP proxy to `api`, and do not place a service you do not control in the environment: its private-network traffic could send forged forwarding headers.

## 2. PostgreSQL/PostGIS and backup strategy

Railway's default PostgreSQL service may not ship PostGIS. Use a PostGIS-enabled PostgreSQL service (the `postgis/postgis` image at the CI version) and prove it:

```sh
psql "$DATABASE_URL" -c "select version();" \
  -c "select name, default_version from pg_available_extensions where name = 'postgis';" \
  -c "select rolsuper from pg_roles where rolname = current_user;"
```

The `postgis` extension must be available and the role must be a superuser: the first migration runs `CREATE EXTENSION postgis`. With the `postgis/postgis` image at major 18 the volume mounts at `/var/lib/postgresql` (the data directory is a versioned subdirectory), not at `/var/lib/postgresql/data`. The image offers no TLS, which is fine because nothing connects to it over the public internet.

The database is reached from the `api` service over the private network (`DATABASE_URL` reference) and from the operator's machine through an SSH tunnel. It never gets a TCP proxy.

**Operator access.** The Railway CLI looks for a `DATABASE_URL` variable on the service, so give `postgres` one built from references to its own variables (private domain, port 5432). Register an SSH key with `railway ssh keys`, then open the tunnel and read the local address it prints (host `127.0.0.1`, an ephemeral or `-P` port); it stays open until interrupted, and the first connection can take about half a minute:

```sh
railway connect postgres --tunnel-only -P <local-port>
```

The tunnel is encrypted by SSH, so neither a TCP proxy nor server-side TLS is needed. The client must be PostgreSQL 18; Docker provides one without installing anything (`host.docker.internal` reaches the tunnel from a container on macOS). Close the tunnel when done: the `ssh` process it spawns survives an interrupted parent, so confirm the port no longer listens.

**Backups**, which together must make a restore possible without Railway:

- **Provider backups**: scheduled and manual volume backups exist only on a plan that offers them (the entry-level plan rejects them), and point-in-time recovery supports only the provider's own PostgreSQL images, not the PostGIS one. Without them, the logical dumps below are the only database backup; do not treat the volume as one.
- **Automated logical dumps**: the `backup` service, below.
- **Manual logical dumps**: `pg_dump --format=custom` through the tunnel, before every deploy that ships a migration. Store dumps outside Railway, in the directory the owner backs up, with their SHA-256.

  ```sh
  docker run --rm -e PGPASSWORD -v "<custody>":/out postgis/postgis:18-3.6 \
    pg_dump -h host.docker.internal -p <local-port> -U <user> -d <database> \
    --format=custom --no-owner --file /out/serendipeak-<date>.dump
  shasum -a 256 "<custody>/serendipeak-<date>.dump"
  ```

- **Catalog snapshots**: `export_catalog_snapshot` is read-only and verifies itself; exporting production regularly gives an editorial backup that the tooling can load and verify. It holds no users and no sessions.
- **Proof**: a backup counts only after it has been restored once into a disposable database and `check_catalog` passed on it.

### Automated database backups

The `backup` service is a Railway cron service built from `services/backup` (Dockerfile builder). It runs `pg_dump --format=custom` against `postgres` over the private network, checks the archive with `pg_restore --list`, writes a SHA-256 file next to it and uploads both to a private R2 bucket under `daily/`. On Sundays (UTC) it also writes `weekly/`. Each upload is checked by size. Retention is the bucket's lifecycle rules, not the job: `daily/` expires after 14 days and `weekly/` after 60 days, so the job holds no delete permission. R2 applies lifecycle rules asynchronously, so an object can outlive its limit by about a day.

| Setting                                                  | Value                                                                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Schedule                                                 | `30 3 * * *` (UTC)                                                                                             |
| Restart policy                                           | never (a cron service must exit; the next run is the retry)                                                    |
| Public domain, TCP proxy                                 | none                                                                                                           |
| `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`           | references to `postgres` (`RAILWAY_PRIVATE_DOMAIN`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`)       |
| `PGPORT`                                                 | `5432`                                                                                                         |
| `BACKUP_S3_ENDPOINT_URL`                                 | `https://<account-id>.r2.cloudflarestorage.com`                                                                |
| `BACKUP_BUCKET`                                          | `<backup-bucket>`, private, with lifecycle rules for `daily/` and `weekly/`                                    |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | an R2 API token with Object Read & Write on the backup bucket only. It must not reach the media buckets        |

- **No overlap.** Railway does not start a scheduled run while the previous one is still active, and `pg_dump` is bounded by `BACKUP_DUMP_TIMEOUT_SECONDS` (default 1500), so a hung run ends before it can block the next days for long.
- **Failure is visible.** Any error (database unreachable, dump or upload failure, size mismatch) exits non-zero and Railway shows the run as failed. Enable deploy-failure notifications for the project so it reaches the owner by email.
- **A missed run produces no failure**, so look for it: `backup check` fails unless the newest `daily/` dump is at most `BACKUP_MAX_AGE_SECONDS` old (default 36 h), its checksum matches and `pg_restore --list` reads it. Run it at least weekly, and after any change to the service, from any machine with Docker and the backup token (it needs no database access):

  ```sh
  docker build -t serendipeak-backup services/backup
  docker run --rm --env-file <file with BACKUP_S3_* and BACKUP_BUCKET> serendipeak-backup check
  ```

  The R2 dashboard (bucket, objects) shows the same thing: one `daily/` dump and checksum per day. Nothing alerts on its own when the job stops being scheduled; the weekly check is the control for that.

- **Restore.** Download a dump and its `.sha256` from the bucket (dashboard or any S3 client), run `shasum -a 256 -c` on it, then restore into an empty PostGIS 18 database (`pg_restore --no-owner --exit-on-error --dbname <target> <file>`). The archive carries the `postgis` extension and no roles. Run `check_catalog` on the result before relying on it.
- **Credentials.** Rotate the R2 token by creating a new one, updating the two variables and running the service once; then revoke the old one.

### Daily discovery retention

The `prune` service runs `python manage.py prune_daily_discoveries` on a daily schedule (`0 1 * * *` UTC) with the same root directory (`services/api`) and variables as `api`. Nothing fails without it; the `daily_discovery` table just grows by one row a day. See the [developer reference](engineering/developer-reference.md#daily-discovery-retention).

## 3. R2 buckets and media domain

1. Buckets `<public-bucket>` and `<originals-bucket>` exist in the production account. `r2.dev` access is disabled on both; the originals bucket has no public access of any kind.
2. The media host is attached to `<public-bucket>` as a custom domain. No CORS rules, no workers, no cache rules: the objects carry their own `Cache-Control`.
3. A token with Object Read & Write on exactly those two buckets goes to the `api` variables. The operator token of "Operator shell" is a second token with the same scope.
4. Check the exposure of a bucket before any object exists there:

   ```sh
   curl -sI https://<media-host>/photographs/none/original.jpg | head -1      # 404, not a listing
   curl -s  https://<media-host>/ | head -c 200                                 # no bucket listing
   ```

**Backups of the media.** Objects are content-addressed and the application never overwrites or deletes them, so an incremental copy is safe to repeat. Keep a second copy of **`<originals-bucket>`** (the renditions can be derived from the originals, the originals cannot be recovered) in a bucket under a different account or provider, refreshed with `rclone copy` (never `sync`, so a deletion cannot propagate) after upload sessions, and compared with `rclone check`. Use a read-only token on the production side.

## 4. Deploying changes

Every deploy of `api` runs `python manage.py migrate --noinput` as the pre-deploy command, in a separate container with the service's variables and private network, before the new version starts. A non-zero exit cancels the deploy and the previous deployment stays live. While the migration runs the previous version keeps serving, so a migration must be compatible with it (add before use, remove after). Take a dump first for any deploy that ships a migration. `migrate` is forward-only; a rollback of the image does not undo it.

A healthy `api` deploy shows every pending migration applied, then Gunicorn listening on `[::]:$PORT`, then the health check passing (`/healthz` answers 200 from the host `healthcheck.railway.app` over plain HTTP, which is exempt from the HTTPS redirect).

## 5. Catalog snapshots and initializing an environment

The catalog is edited in the Studio and lives in the database. A private snapshot moves it between environments and restores it. Initializing an empty environment takes: `migrate`, `create_editor`, `load_catalog_snapshot`, the media transfer below, then `check_catalog` and `check_photograph_media --deep --checksums`.

### Export

On the source database (the command is read-only), with writers stopped so nothing changes during the export:

```sh
cd services/api
uv run --env-file ../../.env python manage.py export_catalog_snapshot \
  --output "<custody>/catalog-a.json" \
  [--exclude-slug <slug>] [--exclude-region <slug>] \
  [--include-discoveries]
uv run --env-file ../../.env python manage.py export_catalog_snapshot \
  --output "<custody>/catalog-b.json" [same options]
cmp "<custody>/catalog-a.json" "<custody>/catalog-b.json" && echo identical
```

Every mountain or region that must not reach the target is named by slug; the command reports each exclusion and any region left without mountains, and refuses a kept mountain that points at an excluded region. Both exports must print the same `content_sha256` and be byte-identical (a difference means something wrote in between). Keep one file, delete the other, and record `content_sha256` next to it with the date and the source database.

Review the report (counts of mountains, regions, country links, photographs with media and discoveries, exclusions, empty regions) and read the file, not only the tooling's word for it:

```sh
jq -r '"mountains \(.content.mountains|length), regions \(.content.regions|length), discoveries \(.content.daily_discoveries|length), media \([.content.mountains[].image.media? | select(. != null)]|length)"' "<custody>/catalog.json"
jq -r '.content.mountains[] | "\(.status) \(.slug)"' "<custody>/catalog.json" | sort | less
```

### Rehearsal on a disposable database

Rehearse a load before doing it for real. Use a local PostGIS (`docker compose up -d --wait`) with a bare database, so the migration has to create the extension itself:

```sh
docker exec serendipeak-v2-db-1 psql -U serendipeak -d postgres -c "CREATE DATABASE serendipeak_dryrun"
export DRYRUN_URL=postgres://serendipeak:serendipeak@localhost:5434/serendipeak_dryrun   # local container only
cd services/api
run() { env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$DRYRUN_URL" uv run --env-file ../../.env "$@"; }
```

A variable that is already set wins over the env file, so `run` points every command at the dry-run database and not at the development one. Prove it first: `run python manage.py showmigrations catalog | head -3` must list every migration unapplied (`[ ]`).

```sh
run python manage.py migrate --noinput
run python manage.py load_catalog_snapshot --input "<custody>/catalog.json" --sha256 <content_sha256>
run python manage.py verify_catalog_snapshot --input "<custody>/catalog.json" --sha256 <content_sha256>
run python manage.py check_catalog
run python manage.py load_catalog_snapshot --input "<custody>/catalog.json" --sha256 <content_sha256>   # must be refused: not empty
```

Then `pg_dump` the dry-run database, restore it into a second disposable database and run `check_catalog` there. Also run the production image's `migrate` against a bare database once:

```sh
docker build -t serendipeak-api services/api
docker run --rm --env-file <env file with APP_ENV=production and the api variables> serendipeak-api python manage.py migrate --noinput
```

Drop the disposable databases and delete the dry-run files.

### Import into a target environment

The target schema must exist and be empty (an `api` deploy has migrated it). Take a dump of the empty database first, open the tunnel, repeat the "Before each production session" checks and confirm the target is empty:

```sh
psql "$DATABASE_URL" -tAc "select count(*) from mountain"        # 0
cd services/api
prod python manage.py load_catalog_snapshot --input "<custody>/catalog.json" --sha256 <content_sha256>
prod python manage.py verify_catalog_snapshot --input "<custody>/catalog.json" --sha256 <content_sha256>
prod python manage.py check_catalog
```

`load_catalog_snapshot` prints the database it is about to write; read it. If load or verify fails, stop, recreate the database (see "Rollback and recovery") and start again from the rehearsal. Then create the first Editor, with the password from the environment and never from an argument or the screen:

```sh
read -s SERENDIPEAK_EDITOR_PASSWORD && export SERENDIPEAK_EDITOR_PASSWORD
prod python manage.py create_editor <username>
unset SERENDIPEAK_EDITOR_PASSWORD
```

Close the tunnel afterwards, delete its URL from `OPERATOR_ENV` and revoke the operator R2 token if no further transfer is planned.

### Media transfer

Copy exactly the objects the snapshot references, nothing else: a source bucket can also hold objects of excluded mountains and orphans of replaced photographs, and they must not reach the target.

1. Key lists from the snapshot:

   ```sh
   jq -r '.content.mountains[].image.media? | select(. != null) | .original_key' "<custody>/catalog.json" | sort -u > "<scratch>/originals.txt"
   jq -r '.content.mountains[].image.media? | select(. != null) | .page_key, .viewer_key' "<custody>/catalog.json" | sort -u > "<scratch>/public.txt"
   wc -l "<scratch>/"*.txt     # three objects per photograph
   ```

2. Copy with `rclone`, with the source and destination remotes defined through environment variables (type `s3`, provider `Cloudflare`, the R2 endpoint and the credentials of each token), never in an argument or a committed file. Dry-run first:

   ```sh
   rclone copy src:<source-originals-bucket> dst:<originals-bucket> --files-from "<scratch>/originals.txt" --metadata --checksum --immutable --s3-no-check-bucket --dry-run
   rclone copy src:<source-public-bucket>    dst:<public-bucket>    --files-from "<scratch>/public.txt"    --metadata --checksum --immutable --s3-no-check-bucket --dry-run
   ```

   Review the listing, repeat without `--dry-run`. `--immutable` makes an existing different object an error instead of an overwrite.

3. Compare and prove, in this order:

   ```sh
   rclone check src:<source-originals-bucket> dst:<originals-bucket> --files-from "<scratch>/originals.txt"
   rclone check src:<source-public-bucket>    dst:<public-bucket>    --files-from "<scratch>/public.txt"
   cd services/api
   prod python manage.py check_photograph_media --deep --checksums
   ```

   `--deep --checksums` is the authority: every referenced original and rendition exists in the target buckets and every original still hashes to its checksum.

4. Check the headers the application normally writes:

   ```sh
   curl -sI "https://<media-host>/$(head -1 "<scratch>/public.txt")" | grep -i -E '^(HTTP|content-type|cache-control)'
   ```

   Expect `200`, `image/jpeg` and `public, max-age=31536000, immutable`. If `cache-control` is missing, repeat the public copy with `--header-upload "Cache-Control: public, max-age=31536000, immutable"`. The original must not be readable through the media host. Delete the scratch lists.

## 6. Smoke tests

Set `API=https://api.serendipeak.camilasabino.dev`, `WEB=https://serendipeak.camilasabino.dev`, `MEDIA=https://media.serendipeak.camilasabino.dev`. All are read-only except the Studio session and, on a new UTC date, today's discovery, which the first request for it persists (that is the product working, not a test artifact).

**HTTPS, hosts and forwarded headers**

```sh
curl -sI  "http://api.serendipeak.camilasabino.dev/healthz" | head -1            # 301 to https
curl -si  "$API/healthz" | head -1                                               # 200
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: evil.example' "$API/healthz" # 400 or an edge error, never 200
curl -s -o /dev/null -w '%{http_code}\n' -H 'X-Forwarded-Host: evil.example' "$API/studio/login/"   # 200, and no link in the page names evil.example
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H 'X-Forwarded-Proto: http' "$API/studio/login/"   # 200: the edge overwrites the header
```

The last line is the check that Railway's edge replaces a client-supplied `X-Forwarded-Proto`. If it answers a `301` to the same address, the edge passed the forged value on instead of replacing it: Studio forms would be refused. Treat that as a failure (see "Trusting forwarded headers").

**Client address seen by sign-in throttling** (proves `TRUSTED_PROXY_HOPS`): from a known public address, post a sign-in with a wrong password for a name that does not exist while sending a forged `X-Forwarded-For: 203.0.113.9`, then read the `login_failed` line in the `api` logs. Its `address` must be your own public address: not `203.0.113.9`, not an address of Railway or of another proxy. If it is a proxy's address, `TRUSTED_PROXY_HOPS` is lower than the real number of proxies and every visitor shares one throttle bucket.

**Public API**

```sh
curl -s "$API/api/v1/mountains/today" | jq '{date, slug: .mountain.slug}'
curl -si "$API/api/v1/mountains/today" | grep -i '^cache-control'            # no-store
for i in $(seq 1 40); do curl -s "$API/api/v1/mountains/random" | jq -r .slug; done | sort | uniq -c | sort -rn | head
curl -s -o /dev/null -w '%{http_code}\n' "$API/api/v1/mountains/<draft-slug>"   # 404, a draft is never public
curl -si -H "Origin: $WEB" "$API/api/v1/mountains/<slug>" | grep -i '^access-control-allow-origin'   # exactly $WEB
curl -si -H 'Origin: https://other.example' "$API/api/v1/mountains/<slug>" | grep -ci '^access-control-allow-origin'   # 0
```

`node scripts/verify-api.mjs "$API"` compares the live catalog with the frozen v1 fixtures. It only fits a catalog that still matches the original one: a photograph or a value edited on purpose appears as a difference to classify, not a regression. It does not request today's mountain unless asked.

**Studio** (a browser, over HTTPS): sign in at `$API/studio/` with an Editor; the overview loads with its styles and fonts (no unstyled page); open a mountain; a failed sign-in shows the form error, not a CSRF page; the session and CSRF cookies are `Secure`, `HttpOnly`, `SameSite=Lax`, path `/studio/`; sign out. After a change to photograph handling, upload the largest allowed photograph (30 MiB, and a 25-megapixel WebP) to a draft in a scratch region and watch the service memory: no restart, no 502 from the edge. Delete the scratch draft; the objects it stored stay in the buckets, because nothing removes them automatically, so note their keys and delete them by hand.

**Photographs**: the page of one mountain shows its photograph from `$MEDIA`; `curl -I` on a rendition shows `200`, the right `content-type` and `cache-control: public, max-age=31536000, immutable`; the same key requested as an original (`…/original.jpg`) through `$MEDIA` is not found.

**Web and WebGL** (Chromium with WebGL2): `$WEB/` and `$WEB/mountains/<slug>` render; the globe loads, flies to the mountain and shows the curated camera framing; the browser console has no error; the network list shows only `$WEB`, `$API`, `$MEDIA` and the Cesium ion and imagery hosts. With the API stopped for a moment the pages show their unavailable state (HTTP 503), not a blank page.

**Preview**: in the Studio, preview a draft from its page. The web opens it with the draft visible; a fresh browser context requesting the same URL gets the public 404; the preview cookie is `Secure; HttpOnly`, scoped to that mountain and expires in 15 minutes; no token appears in a URL or in the page source.

## 7. Rollback and recovery

| Situation                                        | Action                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build, pre-deploy or health check fails          | The previous deployment keeps serving. Fix and redeploy.                                                                                                                                                                                                                                               |
| A released version misbehaves                    | Use Railway's rollback to the previous deployment of that service. If the release shipped a migration, the older version must still work with the new schema (that was the rule); if it does not, roll forward instead, or restore the dump taken before the release.                                  |
| A load or import is wrong or half done           | Recreate the database: new `postgres` service or empty database, `migrate`, load again and repeat the media transfer. Never patch a loaded catalog.                                                                                                                                                    |
| The database is lost or corrupt                  | Restore the latest provider backup or logical dump (see "Automated database backups") into a new database, point `DATABASE_URL` at it, then run `check_catalog`. Users and sessions come back with the dump; from a snapshot only, run `create_editor` again.                                          |
| Photographs are missing or damaged               | Re-copy the referenced keys from the second copy of the originals or another bucket that holds them ("Media transfer"), then `check_photograph_media --deep --checksums`.                                                                                                                              |
| No usable Editor                                 | `create_editor` from the operator shell through a new tunnel; close it again.                                                                                                                                                                                                                          |
| A secret is exposed                              | `DJANGO_SECRET_KEY`: replace and redeploy (ends every Studio session). `PREVIEW_SIGNING_KEY`: replace (ends outstanding previews). R2 token: create a new one, update the variables, redeploy, revoke the old one. Database password: rotate in Railway and redeploy every service that references it. |

Reversing the first migration drops the `postgis` extension and fails if other objects depend on it; do not migrate backwards on a database that holds data. The way back is a restore.

## Trusting forwarded headers

Django believes `X-Forwarded-Proto` only when `TRUSTED_PROXY_HOPS` is above `0` (`SECURE_PROXY_SSL_HEADER`), and uses the same value to pick the client address out of `X-Forwarded-For`. Gunicorn is configured not to derive the scheme from any header, `X-Forwarded-Host` is never trusted, and `ALLOWED_HOSTS` is an exact list. On Railway, `TRUSTED_PROXY_HOPS=1` is correct while **all** of these are true:

1. **Every outside request passes through Railway's HTTP edge.** The edge states `X-Forwarded-Proto: https` for what it forwards and redirects plain HTTP (a plain POST is turned into a GET and redirected), so a request that reaches the service from the internet was received over HTTPS. The `api` service has no TCP proxy and no other public route.
2. **The private network is a trust boundary.** Services in the same environment reach `api` without passing the edge and can send any header. The environment holds only services the owner controls (`postgres`, `web`, `prune`, `backup`). `web` calls the API through its public HTTPS address, not through the private one.
3. **The edge replaces the header; Django fails closed otherwise.** Django compares the whole header value with `https`. `http`, an empty value or a list such as `http, https` make the request insecure, which turns into a redirect or a refused form post, never into a request treated as secure. A forged `X-Forwarded-Proto: https` from the internet is harmless, because the edge only forwards requests that really arrived over HTTPS. The smoke test above checks that the edge does not pass a client's `http` through.
4. **The hop count matches the proxies that append to `X-Forwarded-For`.** One for Railway's edge. Django reads the entry that many places from the right, so a client-supplied left-hand entry is ignored. Railway's documentation does not say whether the edge strips or appends client-supplied `X-Forwarded-For` values; reading from the right works in both cases. Adding another proxy in front (a Cloudflare-proxied record for the API host) makes it `2`. A wrong count is visible in the throttling check of the smoke tests.
5. **The health check needs none of this.** It arrives over plain HTTP from `healthcheck.railway.app`, carries no forwarding header, and is exempt from the redirect.

Verified in the production image with a bare client: no header and a forged `http` redirect to HTTPS; `https` is accepted; `http, https` redirects; a forged `X-Forwarded-Host` changes nothing; an unknown host is refused with 400; a forged left-hand `X-Forwarded-For` entry is ignored for the sign-in address. If any condition stops holding (a TCP proxy, an untrusted service in the environment, a proxy that forwards the client's value), set `TRUSTED_PROXY_HOPS=0` and list the public origin in `CSRF_TRUSTED_ORIGINS` instead; the redirect and HSTS then have to be handled at the edge, and sign-in throttling counts the proxy's address until the count is fixed.

CSRF stays on for every Studio form, cookies are `Secure` and scoped to `/studio/`, `ALLOWED_HOSTS` rejects unknown names, and the preview token is signed with its own key; none of these settings is relaxed by the deployment.

## Web security headers

The web service sends `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options`, `Permissions-Policy` and an enforced Content-Security-Policy limited to `base-uri`, `form-action`, `frame-ancestors` and `object-src`, which fetch nothing and cannot affect the globe. HSTS is deliberately not sent by the web service.

A fuller policy (`script-src`, `worker-src`, `connect-src`, `img-src`) is sent as `Content-Security-Policy-Report-Only`. It has no reporting endpoint, so violations show only in a browser console. Before enforcing it, load a mountain page and the camera editor on the production origin with the real Cesium ion token and read the console: every ion, imagery, terrain and media origin that is blocked must be added first. Enforcing without `'unsafe-inline'` for scripts additionally needs per-request nonces, which turns the statically built pages into dynamic ones.
