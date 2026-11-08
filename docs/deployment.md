# Production deployment runbook

How to take SerendiPeak from this repository to a running production environment on Railway, Cloudflare R2 and PostgreSQL/PostGIS, and how to get back out. It is written to be executed in order. Every step ends in a gate: do not continue until the gate holds.

Nothing in this file is a credential. Values in `<angle brackets>` are chosen by the operator and are never committed. Commands are run from the repository root unless a `cd` says otherwise.

## Rules that apply to every step

- **Secrets live in two places only**: Railway variables, and an *operator environment file* kept outside the repository (see "Operator shell"). Never in Git, in a chat, in shell history or in a command-line argument.
- **Confirm the target before every command that writes**: `railway status` for Railway, and the printed database and bucket names for the management commands. Several commands print their target on purpose; read it.
- **One writer**: while the previous production stack is the one serving visitors, nothing in this runbook moves a name that stack uses until step 11. The new stack is reached only on names of its own until then.
- **A failed catalog load is recreated, never patched**: drop the database, `migrate`, load again.
- **The snapshot file is private editorial data.** It lives in a directory outside the repository that the owner backs up, next to a note of its `content_sha256`. The tooling refuses paths inside the repository.

## Services and names

| Unit | What it is | Public |
| ---- | ---------- | ------ |
| `postgres` | PostgreSQL with PostGIS, same major version as CI (`postgis/postgis:18-3.6`) | never |
| `api` | image built from `services/api/Dockerfile` | `<api-host>` |
| `web` | image built from `apps/web/Dockerfile` | `<web-origin>` |
| `prune` | cron service, same image and variables as `api` | never |
| R2 bucket `<public-bucket>` | public photograph renditions | `<media-host>` (custom domain) |
| R2 bucket `<originals-bucket>` | private original photographs | never |

**Decisions to record before starting** (the runbook cannot choose them):

1. The final hostnames: `<web-origin>`, `<api-host>`, `<media-host>`. The web build inlines the API origin, so `<api-host>` must be final before the first web build.
2. The DNS arrangement for `<media-host>`. A custom domain on an R2 bucket needs the zone, or a Cloudflare-supported partial setup for that hostname, on Cloudflare.
3. Whether the web service is first reached on a staging hostname (needed when the previous stack still holds the final name). `WEB_ORIGIN` and `CORS_ALLOWED_ORIGIN` are single origins and are switched at step 11.
4. The backup destinations and schedule of step 2 and step 3.
5. What happens to the previous stack's data when the switch happens, and for how long it stays deployable (step 11).

## Operator shell

Management commands against production run from a checkout on the operator's machine, with the production values in a file outside the repository. Run them through a clean environment so nothing from a development shell or the repository's own `.env` leaks in (`uv run --env-file` does not override variables that are already set):

```sh
export OPERATOR_ENV=<path to the operator environment file>   # outside the repository, mode 600
prod() { env -i PATH="$PATH" HOME="$HOME" uv run --env-file "$OPERATOR_ENV" "$@"; }
```

The file holds the same variable names as the `api` service (see step 1) with the *public* database URL of the temporary proxy window and the production media settings, plus `PGSSLMODE=require`, plus `GDAL_LIBRARY_PATH` and `GEOS_LIBRARY_PATH` on macOS. `APP_ENV` is `production`. Use a dedicated R2 token for it and revoke the token when the work is done.

Before each production session:

```sh
git status --porcelain            # empty
git rev-parse HEAD                # the commit the deployed images were built from
cd services/api
prod python -c "import os,urllib.parse as u; d=u.urlsplit(os.environ['DATABASE_URL']); print(d.hostname, d.path)"
```

The printed host and database must be the production proxy host and database, not `localhost`.

## Order of execution

| Order | Step | Touches production |
| ----- | ---- | ------------------ |
| 1 | Infrastructure and secrets | Railway |
| 2 | PostgreSQL/PostGIS and its backups | Railway |
| 3 | R2 buckets, media domain and their backups | Cloudflare |
| 4, 5, 6 | Export, checksum and review, dry run | no (development and a disposable database) |
| 9a | First `api` deploy, which migrates | Railway, database |
| 7, 8 | Catalog import and R2 transfer, inside one database proxy window | database, R2 |
| 9b | Initial Editor, close the proxy window, `web` deploy | database, Railway |
| 10 | Smoke tests on the staging names | read-only, plus one Studio session |
| 11 | Switch, rollback and recovery | DNS |

## 1. Infrastructure configuration and required secrets

1. `railway whoami` and `railway status`: confirm the account, project and environment. Create the production environment if needed. Do not use an environment that holds the previous stack.
2. Create the services of the table above. For `api` and `web` use the repository with the root directory `services/api` and `apps/web`; Railway builds with the `Dockerfile` it finds there. Do not set a custom start command on them: the image's own `CMD` runs the server as PID 1. Config-as-code files are not used. Stage the variables of the next two items before the first deploy of each service, and do not deploy `api` or `web` yet: `api` first deploys at step 9a and `web` at step 9b.
3. Generate the secrets (each at least 32 random characters, all different):

   ```sh
   openssl rand -base64 48   # DJANGO_SECRET_KEY
   openssl rand -base64 48   # PREVIEW_SIGNING_KEY
   ```

4. Set the variables.

   **`api`** (and `prune`, which loads the same settings, so it needs the same values; use shared or reference variables):

   | Variable | Value |
   | -------- | ----- |
   | `APP_ENV` | `production` |
   | `DATABASE_URL` | reference to the Postgres service's private `DATABASE_URL` |
   | `DJANGO_SECRET_KEY`, `PREVIEW_SIGNING_KEY` | the generated secrets |
   | `ALLOWED_HOSTS` | `<api-host>,healthcheck.railway.app`; add the Railway-generated hostname only while it is in use, or remove that domain from the service |
   | `CORS_ALLOWED_ORIGIN`, `WEB_ORIGIN` | the web origin in use (`https://…`, no path or trailing slash) |
   | `TRUSTED_PROXY_HOPS` | `1`, only while the conditions of "Trusting forwarded headers" hold |
   | `MEDIA_STORE` | `s3` |
   | `MEDIA_PUBLIC_BASE_URL` | `https://<media-host>` |
   | `MEDIA_S3_ENDPOINT_URL`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` | R2 endpoint and a token scoped to the two production buckets only |
   | `MEDIA_PUBLIC_BUCKET`, `MEDIA_ORIGINALS_BUCKET` | `<public-bucket>`, `<originals-bucket>` |
   | `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `35` (Gunicorn waits up to 30 s for in-flight requests) |
   | `WEB_CONCURRENCY` | optional, default `2` |
   | `SECURE_HSTS_SECONDS` | leave unset now; raise in steps after step 11 |

   **`web`** (build arguments, so set them before the first build):

   | Variable | Value |
   | -------- | ----- |
   | `NEXT_PUBLIC_API_BASE_URL` | `https://<api-host>` (the build fails unless it is an `https` origin) |
   | `NEXT_PUBLIC_CESIUM_ION_TOKEN` | a Cesium ion token restricted to the allowed web origins in the ion dashboard (the build fails when empty; the value ships to every browser) |
   | `NEXT_PUBLIC_CESIUM_IMAGERY_MODE` | unset (`world` in production) |

5. Service settings.

   | Setting | `api` | `web` |
   | ------- | ----- | ----- |
   | Pre-deploy command | `python manage.py migrate --noinput` (set it only at step 9a) | none |
   | Health check path | `/healthz` | `/brand/serendipeak-mark.png` (a static file: the pages depend on the API) |
   | Health check timeout | 120 s | 120 s |
   | Memory | at least 2 GiB (one photograph upload decodes up to about 0.6 GiB above the idle worker; two editors can overlap) | default |
   | Public domain, TCP proxy | none yet | none yet |

6. Never add a TCP proxy to `api`, and do not place a service you do not control in the environment: its private-network traffic could send forged forwarding headers.

**Gate:** `railway status` shows the intended project and environment, and no variable of the tables above is empty or still a placeholder.

## 2. PostgreSQL/PostGIS provisioning and backup strategy

Railway's default PostgreSQL service may not ship PostGIS. Use a PostGIS-enabled PostgreSQL service (the PostGIS template, or the `postgis/postgis` image at the CI version) and prove it:

```sh
psql "$DATABASE_PUBLIC_URL" -c "select version();" \
  -c "select name, default_version from pg_available_extensions where name = 'postgis';" \
  -c "select rolsuper from pg_roles where rolname = current_user;"
```

The `postgis` extension must be available and the role must be a superuser: the first migration runs `CREATE EXTENSION postgis`. Attach a volume as the service requires; the `api` and `web` services have none.

The database is then reached from the `api` service over the private network (`DATABASE_URL` reference). The public proxy exists only inside the windows of steps 7 and 8 and is removed afterwards.

**Backups**, which together must make a restore possible without Railway:

- **Provider backups**: enable the scheduled volume backups if the plan offers them, and take a manual one before step 7.
- **Logical dumps**: `pg_dump --format=custom` through the proxy window (also available at any later time by reopening it), before step 7 and before every deploy that ships a migration; weekly otherwise. Store dumps outside Railway, in the directory the owner backs up, with their SHA-256.

  ```sh
  pg_dump --format=custom --no-owner --file "<custody>/serendipeak-<date>.dump" "$DATABASE_PUBLIC_URL"
  shasum -a 256 "<custody>/serendipeak-<date>.dump"
  ```

- **Catalog snapshots**: `export_catalog_snapshot` is read-only and verifies itself; exporting production regularly gives an editorial backup that the tooling can load and verify. It holds no users and no sessions.
- **Proof**: a backup counts only after it has been restored once into a disposable database and `check_catalog` passed on it (step 6 does this for the first dump).

**Gate:** extension and superuser checks pass; the backup mode and the dump location are recorded (decision 4).

## 3. R2 bucket, media domain and backup strategy

1. Buckets `<public-bucket>` and `<originals-bucket>` exist in the production account. `r2.dev` access is disabled on both; the originals bucket has no public access of any kind.
2. `<media-host>` is attached to `<public-bucket>` as a custom domain (decision 2). No CORS rules, no workers, no cache rules: the objects carry their own `Cache-Control`.
3. A token with Object Read & Write on exactly those two buckets goes to the `api` variables. The operator token of "Operator shell" is a second token with the same scope.
4. Check the exposure before any object exists there:

   ```sh
   curl -sI https://<media-host>/photographs/none/original.jpg | head -1      # 404, not a listing
   curl -s  https://<media-host>/ | head -c 200                                 # no bucket listing
   ```

**Backups.** Objects are content-addressed and the application never overwrites or deletes them, so an incremental copy is safe to repeat.

- The development buckets that supply the transfer stay as they are until a real backup exists. They are the first copy.
- Keep a second copy of **`<originals-bucket>`** (the renditions can be derived from the originals, the originals cannot be recovered) in a bucket under a different account or provider, refreshed with `rclone copy` (never `sync`, so a deletion cannot propagate), after the transfer of step 8 and after upload sessions, and compared with `rclone check`. Use a read-only token on the production side.
- Record where the copy lives and who refreshes it (decision 4).

**Gate:** buckets and domain exist; step 4's probes behave as stated; the backup destination is named.

## 4. Private snapshot export

On the development database that holds the curated catalog (read-only for this step). Stop editing: close every Studio session and development server so nothing writes during the export.

```sh
cd services/api
uv run --env-file ../../.env python manage.py export_catalog_snapshot \
  --output "<custody>/catalog-a.json" \
  --exclude-slug <test-mountain-slug> \
  --exclude-region <region-that-only-it-owns> \
  [--include-discoveries]            # omit: production starts with an empty history
uv run --env-file ../../.env python manage.py export_catalog_snapshot \
  --output "<custody>/catalog-b.json" \
  --exclude-slug <test-mountain-slug> --exclude-region <region-that-only-it-owns>
cmp "<custody>/catalog-a.json" "<custody>/catalog-b.json" && echo identical
```

Every mountain or region that must not reach production is named by slug; the command reports each exclusion and any region left without mountains, and refuses a kept mountain that points at an excluded region.

**Gate:** both exports print the same `content_sha256` and the files are byte-identical (a difference means something wrote in between; export again). Keep one file, delete the other.

## 5. Snapshot checksum and review

1. Record `content_sha256` next to the file, in the owner's notes, with the date and the exported database.
2. Review the export report: counts of mountains, regions, country links, photographs with media and discoveries, the list of exclusions, and the empty regions. Compare them with what the owner expects of the catalog; any surprise stops the procedure.
3. Read the file, not the tooling's word for it: spot-check the status of every mountain (only `active` ones are public), the excluded slugs' absence, and the number of keys the file references:

   ```sh
   jq -r '"mountains \(.content.mountains|length), regions \(.content.regions|length), discoveries \(.content.daily_discoveries|length), media \([.content.mountains[].image.media? | select(. != null)]|length)"' "<custody>/catalog.json"
   jq -r '.content.mountains[] | "\(.status) \(.slug)"' "<custody>/catalog.json" | sort | less
   ```

**Gate:** the owner has approved the counts and the list, and the checksum is recorded.

## 6. Dry run on a disposable database

Rehearse exactly what steps 7 and 9 will do, on a database that can be thrown away. Use a local PostGIS (`docker compose up -d --wait`) with a bare database, so the migration has to create the extension itself:

```sh
docker exec serendipeak-v2-db-1 psql -U serendipeak -d postgres -c "CREATE DATABASE serendipeak_dryrun"
export DRYRUN_URL=postgres://serendipeak:serendipeak@localhost:5434/serendipeak_dryrun   # local container only
cd services/api
run() { env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$DRYRUN_URL" uv run --env-file ../../.env "$@"; }
```

A variable that is already set wins over the env file, so `run` points every command at the dry-run database and not at the development one. Prove it before going on: `run python manage.py showmigrations catalog | head -3` must list every migration unapplied (`[ ]`).

```sh
run python manage.py migrate --noinput
run python manage.py load_catalog_snapshot --input "<custody>/catalog.json" --sha256 <content_sha256>
run python manage.py verify_catalog_snapshot --input "<custody>/catalog.json" --sha256 <content_sha256>
run python manage.py check_catalog
run python manage.py load_catalog_snapshot --input "<custody>/catalog.json" --sha256 <content_sha256>   # must be refused: not empty
run python manage.py export_catalog_snapshot --output "<custody>/dryrun.json" [same exclusions]            # same content_sha256
```

Then rehearse the backup: `pg_dump` the dry-run database, restore it into a second disposable database and run `check_catalog` there. Also run the production image's `migrate` against a bare database once (the Dockerfile's own environment, the same `python manage.py migrate --noinput` that the pre-deploy command runs):

```sh
docker build -t serendipeak-api services/api
docker run --rm --env-file <env file with APP_ENV=production and the variables of step 1> serendipeak-api python manage.py migrate --noinput
```

Drop the disposable databases and delete the dry-run files.

**Gate:** load verified, second load refused, re-export checksum unchanged, restore passed, image migration passed.

## 7. Controlled production snapshot import

Do this only after step 9a (the schema exists and the `api` service is healthy with an empty catalog and no public domain) and keep the proxy window open through step 8.

1. Take a provider backup and a `pg_dump` of the migrated, empty database (step 2).
2. Open the window: enable a TCP proxy on the `postgres` service only. Put its URL in `OPERATOR_ENV` as `DATABASE_URL`. Repeat the "Before each production session" checks.
3. Confirm the target is empty:

   ```sh
   psql "$DATABASE_PUBLIC_URL" -tAc "select count(*) from mountain"        # 0
   ```

4. Import and verify. `load_catalog_snapshot` prints the database it is about to write; read it.

   ```sh
   cd services/api
   prod python manage.py load_catalog_snapshot --input "<custody>/catalog.json" --sha256 <content_sha256>
   prod python manage.py verify_catalog_snapshot --input "<custody>/catalog.json" --sha256 <content_sha256>
   prod python manage.py check_catalog
   ```

**Gate:** load succeeded, verify matches, `check_catalog` reports every active mountain satisfied. If the load or verify fails: stop, restore or recreate the database (see rollback), find the cause, start again from step 6.

## 8. R2 object transfer and deep checksum verification

Copy exactly the objects the snapshot references, nothing else. A development bucket also holds objects of the excluded mountain and orphans of replaced photographs, and they must not reach production.

1. Key lists from the snapshot:

   ```sh
   jq -r '.content.mountains[].image.media? | select(. != null) | .original_key' "<custody>/catalog.json" | sort -u > "<scratch>/originals.txt"
   jq -r '.content.mountains[].image.media? | select(. != null) | .page_key, .viewer_key' "<custody>/catalog.json" | sort -u > "<scratch>/public.txt"
   wc -l "<scratch>/"*.txt     # three objects per photograph
   ```

2. Copy with `rclone`, with the source and destination remotes defined through environment variables (type `s3`, provider `Cloudflare`, the R2 endpoint, and the credentials of the development and production tokens), never in an argument or a committed file. Dry-run first:

   ```sh
   rclone copy src:<dev-originals-bucket> dst:<originals-bucket> --files-from "<scratch>/originals.txt" --metadata --checksum --immutable --s3-no-check-bucket --dry-run
   rclone copy src:<dev-public-bucket>    dst:<public-bucket>    --files-from "<scratch>/public.txt"    --metadata --checksum --immutable --s3-no-check-bucket --dry-run
   ```

   Review the listing, repeat without `--dry-run`. `--immutable` makes an existing different object an error instead of an overwrite.

3. Compare and prove, in this order:

   ```sh
   rclone check src:<dev-originals-bucket> dst:<originals-bucket> --files-from "<scratch>/originals.txt"
   rclone check src:<dev-public-bucket>    dst:<public-bucket>    --files-from "<scratch>/public.txt"
   cd services/api
   prod python manage.py check_photograph_media --deep --checksums
   ```

   `--deep --checksums` is the authority: every referenced original and rendition exists in the production buckets and every original still hashes to its checksum.

4. Headers. The transfer must have preserved what the application normally writes:

   ```sh
   curl -sI "https://<media-host>/$(head -1 "<scratch>/public.txt")" | grep -i -E '^(HTTP|content-type|cache-control)'
   ```

   Expect `200`, `image/jpeg` and `public, max-age=31536000, immutable`. If `cache-control` is missing, repeat the public copy with `--header-upload "Cache-Control: public, max-age=31536000, immutable"` for the objects of `public.txt`. The original must not be readable through the media host.

5. Delete the scratch lists. Close the proxy window only after step 9b's Editor creation, or now and reopen it.

**Gate:** `rclone check` clean for both lists and `check_photograph_media --deep --checksums` exits 0.

## 9. Migrations, initial Editor and application startup

### 9a. First `api` deploy (before step 7)

1. Set the pre-deploy command of `api` to `python manage.py migrate --noinput`. It runs in a separate container with the service's variables and private network before each deploy; a non-zero exit cancels the deploy and the previous deployment stays live.
2. Deploy `api`. Expected in the deploy logs: every migration applied (including the `postgis` extension), then Gunicorn listening on `[::]:$PORT`, then the health check passing (`/healthz` answers 200 from the host `healthcheck.railway.app` over plain HTTP, which is exempt from the HTTPS redirect). Public routes answer 404 or 503 until the catalog is loaded; that is expected.
3. The service has no public domain yet. Continue with steps 7 and 8.

**Every later deploy** runs the same migrations before the new version starts, while the previous version keeps serving. A migration therefore must be compatible with the version that is still running (add before use, remove after). Take a dump first for any deploy that ships a migration. `migrate` is forward-only; a rollback of the image does not undo it.

### 9b. Initial Editor, close the window, `web`

1. Create the first Editor from the operator shell, inside the proxy window. The password comes from the environment, never from an argument or the screen:

   ```sh
   cd services/api
   read -s SERENDIPEAK_EDITOR_PASSWORD && export SERENDIPEAK_EDITOR_PASSWORD
   prod python manage.py create_editor <username>
   unset SERENDIPEAK_EDITOR_PASSWORD
   ```

2. **Close the proxy window**: remove the TCP proxy from `postgres`, delete the proxy URL from `OPERATOR_ENV`, revoke the operator R2 token if no further transfer is planned. Check: `railway status` lists no TCP proxy on the database.
3. Give `api` its public domain `<api-host>`. `curl -i https://<api-host>/healthz` answers 200.
4. Deploy `web` (its build arguments were set in step 1) and give it the staging or final hostname that `WEB_ORIGIN` and `CORS_ALLOWED_ORIGIN` name.
5. Create the `prune` cron service (same root directory `services/api`, same variables, start command `python manage.py prune_daily_discoveries`, schedule `0 1 * * *` UTC) before the switch. Nothing fails without it; the discovery table just keeps growing by one row a day.

**Gate:** both services are deployed and healthy; the database has no public proxy.

## 10. Smoke tests

Set `API=https://<api-host>`, `WEB=<web origin in use>`, `MEDIA=https://<media-host>`. All are read-only except the Studio session and, once, today's discovery, which the first request for it persists (that is the product working, not a test artifact).

**HTTPS, hosts and forwarded headers**

```sh
curl -sI  "http://<api-host>/healthz" | head -1                                  # 301 to https
curl -si  "$API/healthz" | head -1                                               # 200
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: evil.example' "$API/healthz" # 400 or an edge error, never 200
curl -s -o /dev/null -w '%{http_code}\n' -H 'X-Forwarded-Host: evil.example' "$API/studio/login/"   # 200, and no link in the page names evil.example
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H 'X-Forwarded-Proto: http' "$API/studio/login/"   # 200: the edge overwrites the header
```

The last line is the check that Railway's edge replaces a client-supplied `X-Forwarded-Proto`. If it answers a `301` to the same address, the edge passed the forged value on instead of replacing it: Studio forms would be refused. Treat that as a failed gate (see "Trusting forwarded headers").

**Client address seen by sign-in throttling** (proves `TRUSTED_PROXY_HOPS`): from a known public address, post a sign-in with a wrong password for a name that does not exist while sending a forged `X-Forwarded-For: 203.0.113.9`, then read the `login_failed` line in the `api` logs. Its `address` must be your own public address: not `203.0.113.9`, not an address of Railway or of another proxy. If it is a proxy's address, `TRUSTED_PROXY_HOPS` is lower than the real number of proxies and every visitor shares one throttle bucket.

**Public API**

```sh
curl -s "$API/api/v1/mountains/today" | jq '{slug, status, primaryImage: .primaryImage.url}'
curl -si "$API/api/v1/mountains/today" | grep -i '^cache-control'            # no-store
for i in $(seq 1 40); do curl -s "$API/api/v1/mountains/random" | jq -r .slug; done | sort | uniq -c | sort -rn | head
curl -s -o /dev/null -w '%{http_code}\n' "$API/api/v1/mountains/<draft-slug>"   # 404, a draft is never public
curl -si -H "Origin: $WEB" "$API/api/v1/mountains/<slug>" | grep -i '^access-control-allow-origin'   # exactly $WEB
curl -si -H 'Origin: https://other.example' "$API/api/v1/mountains/<slug>" | grep -ci '^access-control-allow-origin'   # 0
node scripts/verify-api.mjs "$API"
```

`verify-api.mjs` compares the live catalog with the frozen v1 values. Photographs and values edited on purpose in the curated catalog appear as differences; the owner classifies every difference as intended or a regression. It does not request today's mountain unless asked.

**Studio** (a browser, over HTTPS): sign in at `$API/studio/` with the Editor; the overview loads with its styles and fonts (no unstyled page); open a mountain; a failed sign-in shows the form error, not a CSRF page; the session and CSRF cookies are `Secure`, `HttpOnly`, `SameSite=Lax`, path `/studio/`; sign out. Upload the largest allowed photograph (30 MiB, and a 25-megapixel WebP) to a draft in a scratch region and watch the service memory: no restart, no 502 from the edge. Delete the scratch draft; the objects it stored stay in the buckets, because nothing removes them automatically, so note their keys and delete them by hand.

**Photographs**: the page of one mountain shows its photograph from `$MEDIA`; `curl -I` on a rendition shows `200`, the right `content-type` and `cache-control: public, max-age=31536000, immutable`; the same key requested as an original (`…/original.jpg`) through `$MEDIA` is not found.

**Web and WebGL** (Chromium with WebGL2): `$WEB/` and `$WEB/mountains/<slug>` render; the globe loads, flies to the mountain and shows the curated camera framing; the browser console has no error; the network list shows only `$WEB`, `$API`, `$MEDIA` and the Cesium ion and imagery hosts. With the API stopped for a moment the pages show their unavailable state (HTTP 503), not a blank page.

**Preview**: in the Studio, preview a draft from its page. The web opens it with the draft visible; a fresh browser context requesting the same URL gets the public 404; the preview cookie is `Secure; HttpOnly`, scoped to that mountain and expires in 15 minutes; no token appears in a URL or in the page source.

**Gate:** every item passes, or its difference is classified by the owner.

## 11. Switch, rollback and recovery

### Switch

1. Lower the TTL of the records that will move, at least a day ahead.
2. If the web was tested on a staging hostname, set `CORS_ALLOWED_ORIGIN` and `WEB_ORIGIN` of `api` to the final origin, redeploy `api`, and check the health check and a CORS probe. `web` needs no rebuild: it inlines only the API origin.
3. Prefer a moment shortly after 00:00 UTC. Production starts with an empty discovery history, so the first request for today's mountain after the switch picks it by the product's own rule, which may differ from the one the previous stack showed earlier that day.
4. Point `<web-origin>` at the `web` service. Re-run the HTTPS, Studio sign-in and web smoke checks on the final names.
5. After a stable day, raise HSTS in steps (`SECURE_HSTS_SECONDS` 300, then a day, then longer), redeploying `api` each time. Browsers remember it for the whole period.

### Rollback

| Situation | Action |
| --------- | ------ |
| Build, pre-deploy or health check fails | Nothing is switched; the previous deployment keeps serving. Fix and redeploy. |
| A released version misbehaves | Use Railway's rollback to the previous deployment of that service. If the release shipped a migration, the older version must still work with the new schema (that was the rule); if it does not, roll forward instead, or restore the dump taken before the release. |
| Public traffic must return to the previous stack | Point the records back (the previous stack was never modified). Daily history written by the new stack does not exist there; decide beforehand whether that is acceptable (decision 5). |
| The import is wrong or half done | Recreate the database: new `postgres` service or empty database, `migrate`, repeat steps 7 to 8. Never patch a loaded catalog. |
| The database is lost or corrupt | Restore the latest provider backup or `pg_dump` into a new database, point `DATABASE_URL` at it, then run `check_catalog`. Users and sessions come back with the dump; from a snapshot only, run `create_editor` again. |
| Photographs are missing or damaged | Re-copy the referenced keys from the second copy or the development buckets (step 8), then `check_photograph_media --deep --checksums`. |
| No usable Editor | `create_editor` from the operator shell through a new proxy window; close it again. |
| A secret is exposed | `DJANGO_SECRET_KEY`: replace and redeploy (ends every Studio session). `PREVIEW_SIGNING_KEY`: replace (ends outstanding previews). R2 token: create a new one, update the variables, redeploy, revoke the old one. Database password: rotate in Railway and redeploy every service that references it. |

Reversing `catalog.0001_initial` drops the `postgis` extension and fails if other objects depend on it; do not migrate backwards on a database that holds data. The way back is a restore.

## Trusting forwarded headers

Django believes `X-Forwarded-Proto` only when `TRUSTED_PROXY_HOPS` is above `0` (`SECURE_PROXY_SSL_HEADER`), and uses the same value to pick the client address out of `X-Forwarded-For`. Gunicorn is configured not to derive the scheme from any header, `X-Forwarded-Host` is never trusted, and `ALLOWED_HOSTS` is an exact list. On Railway, `TRUSTED_PROXY_HOPS=1` is correct while **all** of these are true:

1. **Every outside request passes through Railway's HTTP edge.** The edge states `X-Forwarded-Proto: https` for what it forwards and redirects plain HTTP (a plain POST is turned into a GET and redirected), so a request that reaches the service from the internet was received over HTTPS. The `api` service has no TCP proxy and no other public route.
2. **The private network is a trust boundary.** Services in the same environment reach `api` without passing the edge and can send any header. The environment holds only services the owner controls (`postgres`, `web`, `prune`). `web` calls the API through its public HTTPS address, not through the private one.
3. **The edge replaces the header; Django fails closed otherwise.** Django compares the whole header value with `https`. `http`, an empty value or a list such as `http, https` make the request insecure, which turns into a redirect or a refused form post, never into a request treated as secure. A forged `X-Forwarded-Proto: https` from the internet is harmless, because the edge only forwards requests that really arrived over HTTPS. The smoke test of step 10 checks that the edge does not pass a client's `http` through.
4. **The hop count matches the proxies that append to `X-Forwarded-For`.** One for Railway's edge. Django reads the entry that many places from the right, so a client-supplied left-hand entry is ignored. Railway's documentation does not say whether the edge strips or appends client-supplied `X-Forwarded-For` values; reading from the right works in both cases. Adding another proxy in front (a Cloudflare-proxied record for the API host) makes it `2`. A wrong count is visible in the step 10 throttle check.
5. **The health check needs none of this.** It arrives over plain HTTP from `healthcheck.railway.app`, carries no forwarding header, and is exempt from the redirect.

Verified in the production image with a bare client: no header and a forged `http` redirect to HTTPS; `https` is accepted; `http, https` redirects; a forged `X-Forwarded-Host` changes nothing; an unknown host is refused with 400; a forged left-hand `X-Forwarded-For` entry is ignored for the sign-in address. If any condition stops holding (a TCP proxy, an untrusted service in the environment, a proxy that forwards the client's value), set `TRUSTED_PROXY_HOPS=0` and list the public origin in `CSRF_TRUSTED_ORIGINS` instead; the redirect and HSTS then have to be handled at the edge, and sign-in throttling counts the proxy's address until the count is fixed.

CSRF stays on for every Studio form, cookies are `Secure` and scoped to `/studio/`, `ALLOWED_HOSTS` rejects unknown names, and the preview token is signed with its own key; none of these settings is relaxed by the deployment.
