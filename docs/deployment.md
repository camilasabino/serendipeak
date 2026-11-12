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
- the Backblaze account, the offsite bucket name, and the inventory of its application keys (scopes, rotation dates), kept apart from the Cloudflare and Railway credentials so that one compromise does not reach both copies.

## Services and names

| Unit                           | What it is                                                                                                           | Public                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `postgres`                     | PostgreSQL with PostGIS, same major version as CI (`postgis/postgis:18-3.6`), on a volume                            | never                                       |
| `api`                          | image built from `services/api/Dockerfile`; serves the API and the Studio                                            | `https://api.serendipeak.camilasabino.dev`  |
| `web`                          | image built from `apps/web/Dockerfile`                                                                               | `https://serendipeak.camilasabino.dev`      |
| `backup`                       | cron service built from `services/backup`; daily `pg_dump` to a private R2 bucket                                    | never                                       |
| R2 bucket `<public-bucket>`    | public photograph renditions                                                                                         | `https://media.serendipeak.camilasabino.dev` (custom domain) |
| R2 bucket `<originals-bucket>` | private original photographs                                                                                         | never                                       |
| `offsite-backup`               | cron service built from `services/offsite-backup`; copies the originals, renditions and dumps to Backblaze B2 | never                                       |
| B2 bucket `<offsite-bucket>`   | private independent copy (`originals/`, `media/`, `db-backups/`, `manifests/`)                                       | never                                       |

`WEB_ORIGIN` and `CORS_ALLOWED_ORIGIN` are single origins and must name the web origin in use. The web build inlines the API origin, so changing the API host needs a new web build. A custom domain on an R2 bucket needs the zone, or a Cloudflare-supported partial setup for that hostname, on Cloudflare.

## Operator shell

Management commands against production run from a checkout on the operator's machine, with the production values in a file outside the repository. Run them through a clean environment so nothing from a development shell or the repository's own `.env` leaks in (`uv run --env-file` does not override variables that are already set):

```sh
export OPERATOR_ENV=<path to the operator environment file>   # outside the repository, mode 600
prod() { env -i PATH="$PATH" HOME="$HOME" uv run --env-file "$OPERATOR_ENV" "$@"; }
```

`npm run db:refresh` reads the same file through `OPERATOR_ENV` ([developer reference](engineering/developer-reference.md#refreshing-the-local-catalog-from-production)).

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

Each service builds from the `Dockerfile` in its directory (Railway root directories `services/api`, `apps/web`, `services/backup` and `services/offsite-backup`). Do not set a custom start command on `api` or `web`: the image's own `CMD` runs the server as PID 1. Config-as-code files are not used.

Generate secrets with at least 32 random characters, all different:

```sh
openssl rand -base64 48   # DJANGO_SECRET_KEY
openssl rand -base64 48   # PREVIEW_SIGNING_KEY
```

**`api`**:

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

**`web`** (runtime variable: a change needs a restart, not a build):

| Variable      | Value                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `SITE_ORIGIN` | `https://serendipeak.camilasabino.dev` (no path or trailing slash); without it the atlas has no canonical |

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

The `backup` service is a Railway cron service built from `services/backup` (Dockerfile builder). It runs `pg_dump --format=custom` against `postgres` over the private network, checks the archive with `pg_restore --list`, writes a SHA-256 file next to it and uploads both to a private R2 bucket under `daily/`. On Sundays (UTC) it also writes `weekly/`. Each upload is checked by size, and once everything is uploaded the job downloads the newest `daily/` dump and runs the same verification as `backup check` on it, which must be the dump it just wrote. Retention is the bucket's lifecycle rules, not the job: `daily/` expires after 14 days and `weekly/` after 60 days, so the job holds no delete permission. R2 applies lifecycle rules asynchronously, so an object can outlive its limit by about a day.

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
| `BACKUP_HEARTBEAT_URL` (optional)                        | the Better Stack heartbeat URL, a secret; see "Monitoring and alerts". Unset, the job runs without reporting   |

- **No overlap.** Railway does not start a scheduled run while the previous one is still active, and `pg_dump` is bounded by `BACKUP_DUMP_TIMEOUT_SECONDS` (default 1500), so a hung run ends before it can block the next days for long.
- **Failure is visible.** Any error (database unreachable, dump or upload failure, size mismatch, a dump that cannot be read back) exits non-zero and Railway shows the run as failed. Enable deploy-failure notifications for the project so it reaches the owner by email; the heartbeat below adds a second, independent alert.
- **A missed run produces no failure on Railway**, so the heartbeat below alerts when the daily ping does not arrive. Independently, `backup check` fails unless the newest `daily/` dump is at most `BACKUP_MAX_AGE_SECONDS` old (default 36 h), its checksum matches and `pg_restore --list` reads it. Run it at least weekly, and after any change to the service, from any machine with Docker and the backup token (it needs no database access):

  ```sh
  docker build -t serendipeak-backup services/backup
  docker run --rm --env-file <file with BACKUP_S3_* and BACKUP_BUCKET> serendipeak-backup check
  ```

  The R2 dashboard (bucket, objects) shows the same thing: one `daily/` dump and checksum per day. `backup check` never sends a heartbeat, so running it by hand or from a script cannot hide a missed run. Keep the weekly check: the heartbeat proves the job finished, and the check proves the bucket still holds a readable dump.

- **Restore.** Download a dump and its `.sha256` from the bucket (dashboard or any S3 client), run `shasum -a 256 -c` on it, then restore into an empty PostGIS 18 database (`pg_restore --no-owner --exit-on-error --dbname <target> <file>`). The archive carries the `postgis` extension and no roles. Run `check_catalog` on the result before relying on it.
- **Credentials.** Rotate the R2 token by creating a new one, updating the two variables and running the service once; then revoke the old one.

### Offsite media and database copy

R2 holds the photographs and the dumps, and so does the account that could lose them. The `offsite-backup` service copies all of it to one private Backblaze B2 bucket, under another provider and other credentials, so that a lost or compromised Cloudflare account, a mistaken deletion or a corrupted object does not take the only copy with it.

It is a cron service with its own root directory, `services/offsite-backup`, and its own `Dockerfile` (Dockerfile builder, like the other services). It needs only `curl` and `rclone`, no PostgreSQL client and no database credentials. It shares no file with the `backup` service, so a change to either one redeploys only that service: keep the watch path of each at its own directory (`/services/backup/**` and `/services/offsite-backup/**`). It reads R2 with a read-only token and writes B2 with a key that cannot delete.

| Offsite prefix | Copied from                       | Verified by                                                                                                                   |
| -------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `originals/`   | `<originals-bucket>`              | the SHA-256 that is part of every key (`photographs/<sha256>/original.<ext>`), recomputed from the bytes stored in B2          |
| `media/`       | `<public-bucket>`                 | a hash of the source object compared with a hash of the B2 object, then recorded in the manifest                              |
| `db-backups/`  | `<backup-bucket>` (`daily/`, `weekly/`) | the `.sha256` file the dump job wrote, compared with the dump stored in B2; the checksum file is copied byte for byte    |
| `manifests/`   | written by the job                | `offsite-<UTC stamp>.sha256`, one per run, listing `sha256  <prefix>/<key>` for everything verified so far                    |

Keys are preserved under their prefix. The bucket has one prefix besides the three copies, `manifests/`: renditions are keyed by their original's digest, not their own, so without a recorded checksum nothing independent of R2 could verify them later.

**What a run does** (`offsite-backup run`):

1. Copies each source bucket with `rclone copy --ignore-existing`. A key that already exists offsite is never read, compared or replaced, so a repeat run transfers only what is new. A failed copy is retried (`OFFSITE_COPY_ATTEMPTS`, default 3, `OFFSITE_RETRY_DELAY_SECONDS`, default 30) and then fails the run.
2. Lists both sides with sizes. It fails on any source key or manifest key that is missing offsite, and on any key whose size differs from the source. Offsite-only objects (deleted at the source later) are expected and kept. A dump without its checksum file, or the reverse, fails too.
3. Hashes every object that is not yet in the manifest, reading the bytes back from B2: originals against their key, renditions against the source object, dumps against their checksum file.
4. Only if all of that passed, writes a new manifest and reads it back. A failed run writes no manifest, so the same objects are verified again next time.
5. Reports to its own heartbeat: success on exit status 0, `/fail` on any other outcome, nothing on `check` or `deep-check`.

`rclone` is reached through one function that accepts only `copy`, `copyto`, `lsf` and `hashsum`. The job has no `sync`, `delete`, `purge` or `cleanup` anywhere, and the B2 key has no `deleteFiles`, so neither a script change nor a stolen job credential can remove a backup. A source deletion therefore never propagates, and the offsite bucket only grows (see "Costs").

**Other commands**, both read-only and without heartbeat:

- `offsite-backup check` (cheap, run it weekly and after any change): every source and manifest key exists offsite with the same size, the newest manifest is at most `OFFSITE_MAX_AGE_SECONDS` old (default 36 h), and the newest `daily/` dump still matches its checksum.
- `offsite-backup deep-check` (reads every object back, so it costs egress and download transactions; run it monthly, and before a restore drill only if the account limits allow it, see "B2 limits and daily caps"): re-hashes everything in the manifest. This is what finds a stored object that changed without changing size, which a routine `run` does not re-read.

**What each operation reads from B2**, which is what spends download bandwidth and read transactions:

| Operation                | Reads from B2                                                                              | Proves                                                                                  | Cost to the daily limits                          |
| ------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `run`                    | listings, the latest manifest, and the bytes of objects **not yet** in the manifest         | new objects were copied and hash correctly; the manifest grew                           | small and proportional to what is new             |
| `check`                  | listings, the latest manifest, the newest `daily/` dump and its checksum file               | coverage (nothing missing, sizes match), freshness, and that the newest dump is intact  | one dump, regardless of the catalog size          |
| `deep-check`             | every object in the manifest                                                                | every stored byte still matches what was verified when it was copied                    | the whole bucket                                  |
| Targeted restore drill   | the newest `daily/` dump, its checksum, and three originals                                 | the dump restores and `check_catalog` passes; originals match their keys' SHA-256       | a dump plus three photographs                     |
| Full restore drill       | the whole bucket                                                                            | a complete recovery from B2 alone, checked against the newest manifest                  | the whole bucket, like `deep-check`               |

A full restore drill already re-verifies every object with the manifest, so after one a separate `deep-check` adds nothing.

**Settings of the `offsite-backup` service**

| Setting                                                                           | Value                                                                                                     |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Schedule                                                                          | `0 5 * * *` (UTC)                                                                                         |
| Restart policy                                                                    | never                                                                                                     |
| Public domain, TCP proxy                                                          | none                                                                                                      |
| `OFFSITE_SRC_ENDPOINT_URL`                                                        | `https://<account-id>.r2.cloudflarestorage.com`                                                           |
| `OFFSITE_SRC_ACCESS_KEY_ID`, `OFFSITE_SRC_SECRET_ACCESS_KEY`                      | an R2 token with **Object Read only** on the three source buckets, and nothing else                       |
| `OFFSITE_SRC_ORIGINALS_BUCKET`, `OFFSITE_SRC_PUBLIC_BUCKET`, `OFFSITE_SRC_BACKUP_BUCKET` | `<originals-bucket>`, `<public-bucket>`, `<backup-bucket>`                                         |
| `OFFSITE_DST_ENDPOINT_URL`, `OFFSITE_DST_REGION`                                  | the bucket's S3 endpoint, `https://s3.<region>.backblazeb2.com`, and the same `<region>`. Both endpoint variables must be `https://<host>` without a path: the job refuses anything else, and never prints the value                  |
| `OFFSITE_DST_ACCESS_KEY_ID`, `OFFSITE_DST_SECRET_ACCESS_KEY`                      | a B2 application key restricted to `<offsite-bucket>`, see below                                          |
| `OFFSITE_DST_BUCKET`                                                              | `<offsite-bucket>`                                                                                        |
| `OFFSITE_HEARTBEAT_URL` (optional)                                                | its own Better Stack heartbeat URL, a secret. Unset, the job runs without reporting                       |

No `PG*` variable, no production database credential and none of the `MEDIA_*` write tokens belong on this service. Credentials reach `rclone` through a configuration file inside a private temporary directory, are removed from the environment, and appear in no argument list, log line or message. The heartbeat URL is handled exactly as in "Monitoring and alerts", and is a different URL from the dump job's.

**Schedule.** The dump job starts at 03:30 UTC. `pg_dump` is bounded by `BACKUP_DUMP_TIMEOUT_SECONDS` (1500 s), so even a dump that runs to its limit ends by about 03:55, and its uploads and verification add a few minutes on a healthy day. Running the copy at **05:00 UTC** leaves over an hour of margin, so the day's dump is complete, checksum included, when it is copied. A dump caught half-uploaded would fail the run loudly rather than be copied wrongly, and the next run would pick it up. The heartbeat (period 24 h, grace 3 h) alerts around 08:00 UTC at the latest. Railway does not start a run while the previous one is active.

**Initial backfill and first-time setup** (once, from the operator's machine, nothing of this is committed):

1. In Backblaze create a private bucket with default encryption, no public access and versioning left on (the default). B2 keeps every version of a file, which is the only protection against an overwrite until Object Lock is adopted; do not set a lifecycle rule that deletes old versions.
2. Create the B2 application key restricted to that bucket with exactly the capabilities `listBuckets`, `listAllBucketNames`, `listFiles`, `readFiles` and `writeFiles`: not `deleteFiles`, not any `writeBucket*` or `deleteBucket*` capability (they include lifecycle rules, which could expire old versions) and no key administration. The Backblaze web console only offers the presets "Read and Write" (which includes `deleteFiles`), "Read Only" and "Write Only" (which cannot list or read), so create it with the B2 command-line tool, authorized interactively so no key appears in an argument: `b2 key create --bucket <offsite-bucket> <key name> listBuckets,listAllBucketNames,listFiles,readFiles,writeFiles` (the exact syntax depends on the tool's version). Note the key ID, the secret and the region; the secret is shown once. Put the values in a private file outside the repository (mode 600) with one `NAME=value` per line, no quotes, and with the endpoint as `https://s3.<region>.backblazeb2.com`.
3. In Cloudflare create the read-only R2 token for the three buckets (permission "Object Read only", scoped to exactly those buckets).
4. **Check the key's permissions, read-only, before anything is written.** The key's own description is authoritative and a check changes nothing. Use API version 4, because version 3 refuses keys that are restricted by bucket in a way it cannot represent. The credentials go to `curl` through standard input, never in an argument:

   ```sh
   set -a; . <env file>; set +a
   printf 'user = "%s:%s"\n' "$OFFSITE_DST_ACCESS_KEY_ID" "$OFFSITE_DST_SECRET_ACCESS_KEY" |
     curl --config - --silent https://api.backblazeb2.com/b2api/v4/b2_authorize_account |
     jq '.apiInfo.storageApi.allowed | {capabilities, buckets: [.buckets[].name], namePrefix}'
   ```

   The response also carries an authorization token, so print only the part above. `capabilities` must be exactly the five listed, `buckets` must be exactly `<offsite-bucket>`, and there must be no `deleteFiles`. If anything else is present, create a replacement key and delete the old one; do not carry on and do not test deletion to find out.
5. **Prove the key works with `rclone` before the service exists.** This uploads one small, uniquely named object under `_probe/`, a prefix the job ignores, lists it and reads it back through the same calls the job uses:

   ```sh
   docker build -t serendipeak-offsite services/offsite-backup
   docker run --rm --env-file <env file> --entrypoint sh serendipeak-offsite -c '
     umask 077
     printf "[dst]\ntype = s3\nprovider = Other\nendpoint = %s\nregion = %s\naccess_key_id = %s\nsecret_access_key = %s\nno_check_bucket = true\n" \
       "$OFFSITE_DST_ENDPOINT_URL" "$OFFSITE_DST_REGION" "$OFFSITE_DST_ACCESS_KEY_ID" "$OFFSITE_DST_SECRET_ACCESS_KEY" >/tmp/r.conf
     name="probe-$(date -u +%Y%m%dT%H%M%SZ)-$(head -c 4 /dev/urandom | od -An -tx1 | tr -d " \n").txt"
     echo "offsite probe $name" >/tmp/probe
     rclone --config /tmp/r.conf copyto --ignore-existing /tmp/probe "dst:$OFFSITE_DST_BUCKET/_probe/$name"
     rclone --config /tmp/r.conf lsf --format ps --separator ";" "dst:$OFFSITE_DST_BUCKET/_probe"
     echo "$name" >/tmp/one
     rclone --config /tmp/r.conf hashsum sha256 --download --files-from /tmp/one "dst:$OFFSITE_DST_BUCKET/_probe"
     sha256sum /tmp/probe
   '
   ```

   The two hashes must be equal. If the upload or listing is refused, adjust the key's capabilities, not the job. If `rclone` and the S3 endpoint do not get along at all, the fallback is rclone's native `b2` backend, which needs the job's remote definition changed and its tests rerun. The configuration file lives only inside this throwaway container. The probe object stays in the bucket: the job never deletes, and the key cannot. Remove it later with an administrative key. The probe is a few bytes, so it does not exercise multipart uploads; the first backfill does, with originals of up to 30 MiB.
6. Create the Railway service on the same project with root directory `services/offsite-backup`, the watch path `/services/offsite-backup/**`, the variables above and the schedule. Confirm the target with `railway status`. Do not enable the schedule yet.
7. **Backfill**: run the service once from Railway (or `docker run --rm --env-file <env file> serendipeak-offsite run` with the real values) and read the log to its `offsite ok:` line. The first run reads every object three times (source read, copy, B2 read-back); on a few GB that is minutes to tens of minutes, which is also why the first run is not left to the cron. Fix the cause of any failure (see below) and run again: copies resume where they stopped.
8. `offsite-backup check`, then the first scheduled run, then the `deep-check` below. Only then turn the heartbeat on.

**Incremental checks.** After every upload session of photographs, a second `run` is not needed: the next scheduled run picks the new objects up. To confirm immediately, run `check`: it fails with "objects missing from the offsite bucket" until a `run` has delivered them. Every run's log ends with `offsite ok: originals=<n> media=<n> db-backups=<n> newly-verified=<n>`; `originals` is one object per photograph, and `media` is the page and viewer renditions of every version kept, so compare both with the counts of the source buckets.

**When a run fails.** The message names the step and lists up to 20 keys.

| Message                                                                  | Meaning and action                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `copy of <name> failed after N attempts`                                  | A transfer problem: credentials, endpoint, network, a B2 incident or an account cap. Check the key and Caps & Alerts, then run again.                                                                    |
| `hashing objects under <remote> failed`                                   | `rclone` could not read the objects back. A `403` in the lines above it points to an exhausted download cap, not to corruption: see "B2 limits and daily caps". No verdict about the data was reached.   |
| `<name>: objects missing from the offsite bucket`                         | A key the source has, or an earlier run verified, is absent offsite. If the source still has it the next run copies it again. If it is gone from both, the object is **lost**: stop and see "Recovery".   |
| `<name>: objects whose size differs from the source`                      | An existing offsite object is truncated or different. It is never overwritten. Investigate with B2's file versions, then remove the bad object with an administrative key, outside the job, and run again. |
| `<name>: objects that are missing or do not match their checksum`         | Corrupt in transit or at rest. Same handling. For `db-backups/`, compare with the source before touching anything.                                                                                        |
| `originals: keys that are not content-addressed`                          | An object in the originals bucket does not follow `photographs/<sha256>/original.<ext>`. Find out how it got there; it cannot be verified.                                                              |
| `media: offsite objects absent from the source, so there is nothing to verify them against` | An unverified offsite object whose source is gone. Verify it by hand, then record it by hand or remove it.                                                         |
| `<manifest> has malformed lines`, `does not read back as written`          | The manifest is damaged. Do not delete it: an earlier manifest in `manifests/` is the fallback, and the file version history shows what changed.                                                         |

The job never repairs or removes anything on its own, so a failure repeats every day until someone has looked at it. That is intended.

**Recovery from the offsite copy.** Use a read-only B2 key (`listFiles`, `readFiles`) and, for databases or media, a scratch directory or empty environment, never the production buckets first:

1. Download the bucket to a scratch directory outside the repository. `rclone copy` with the S3 remote configured through environment variables, as in "Media transfer", is enough: `rclone copy dst:<offsite-bucket> <scratch>/offsite --checksum`.
2. Verify with the newest manifest, from the bucket's root:

   ```sh
   cd <scratch>/offsite
   latest="$(ls manifests | sort | tail -1)"
   shasum -a 256 -c "manifests/$latest"      # every line must say OK
   ```

   This needs neither R2 nor any credential, and proves the restored set is what the last run recorded.
3. **Originals and renditions**: copy `originals/photographs/…` into `<originals-bucket>` and `media/photographs/…` into `<public-bucket>` with `rclone copy --immutable --header-upload "Cache-Control: public, max-age=31536000, immutable"` for the public one, then follow steps 3 and 4 of "Media transfer" (`check_photograph_media --deep --checksums`, the headers check). The offsite copy does not preserve object metadata, so the `Cache-Control` header must be set again, as the command does.
4. **Database**: a dump and its checksum are at `db-backups/daily/` and `db-backups/weekly/`. Verify with `shasum -a 256 -c`, then restore as in "Automated database backups". The offsite bucket keeps dumps the R2 lifecycle rules have already expired.
5. Run the restored environment's checks (`check_catalog`, the smoke tests that apply).

**Isolated restore drill** (once after the first backfill, then at least twice a year, and after any change to the job). Record the date, the manifest used and the result in the owner's notes. A backup counts only after it has been restored once. There are two sizes, and they are scheduled apart (see "B2 limits and daily caps"):

- **Targeted drill**: on a machine with Docker, restore the newest `daily/` dump into a disposable PostGIS 18 container and run `check_catalog` on it (steps 2 and 4 above, for that one dump), then download the originals of three photographs into a scratch directory and compare each with its key's SHA-256. It reads a dump and three photographs, so it fits inside almost any daily limit.
- **Full drill**: steps 1 to 5 above for the whole bucket, verified against the newest manifest. It reads every object once, as `deep-check` does, so it replaces a `deep-check` of the same day.

### B2 limits and daily caps

Three different things decide whether B2 lets the job read. Exceeding the first two costs money; reaching the third stops the traffic:

- **Storage and egress allowances.** A free amount of storage, and a free amount of download bandwidth tied to the stored volume, after which the provider bills per GB. The allowances and prices are provider-dependent and change; read them on Backblaze's current pricing page, not in this file.
- **Transaction classes.** Backblaze counts API calls in classes with their own daily free allowance. Reading an object is a download transaction, and listing a bucket is a different class. `rclone hashsum --download` costs one read transaction per object plus its bytes, so a catalog of a few hundred objects spends a few hundred of them. Check the classification on Backblaze's transaction page.
- **Daily caps.** Limits the account owner sets (Caps & Alerts in the Backblaze console) on storage, download bandwidth and each transaction class. A cap is not a bill: it is a stop. It applies even when the usage would have been free, and a cap set or defaulted below the free allowance blocks earlier than the allowance would. Raising a cap above the free allowance may require a payment method on the account. Values and defaults are the owner's choice and the provider's, so record the ones in force in the owner's notes.

**Which limit was reached.** In the console open Caps & Alerts: each cap shows its daily limit and today's usage, and the one at 100% is the cause (download bandwidth, or the transaction class that covers reads). Both are raised in the same page.

**What the `403` means.** Reads (`hashsum --download`, `copy` from B2) fail with `403` while uploads and listings may still work, because only the exhausted resource is refused. The key, its capabilities and the bucket are fine, so do not rotate or recreate the key. The job reports the step (`hashing objects under <remote> failed`, or a failed copy) and never reaches a verdict on the data: a `403` is not corruption, and no object was compared. Nothing is written or deleted by the failure, and the next run or check starts clean.

**Reset.** Caps are daily and reset at midnight UTC according to Backblaze's current documentation; confirm that on the console. Verify downloads are available again before starting anything large by reading one small object, for example the newest manifest in `manifests/`, and checking in Caps & Alerts that today's usage is back near zero. Then start with the cheap operation (`check`), not the whole drill.

**Scheduling under restrictive limits.** When the daily download cap is smaller than the bucket, a full `deep-check` or full drill cannot finish in one day, and a run that reaches the cap halfway proves nothing about the objects it did not reach while spending the whole day's allowance, which also starves the next scheduled `run` and `check`. Therefore:

- Run `deep-check` and the full drill on a day chosen for it, outside the cron window (05:00 UTC), never on the day of another large read, and never together: the drill already re-verifies everything.
- Before starting, compare the cap with the bucket: the bucket's size from the console against the daily download cap, and its object count against the read-transaction cap. If either does not fit, raise the cap for that day (below) or do the targeted drill instead.
- Never use a failed large read as evidence of a bad backup, and never retry it the same day.

**Emergency recovery when the cap blocks the download.** Recovering matters more than the cap. Decide deliberately, in this order:

1. Confirm with Caps & Alerts that a cap, and not the key or the bucket, is the cause (the `403` above), and which cap.
2. If the data needed is small (one dump, a few photographs), wait for the reset or download only that: the newest `daily/` dump and its `.sha256` are one object each.
3. If the full bucket is needed now, raise only the exhausted cap, to a value a little above the bucket's size or object count, and leave the others. Estimate the cost first from the pricing page: the downloaded volume beyond the free egress allowance, times the current per-GB price, plus any transaction above its free allowance. For a few GB the cost is expected to be negligible, but it is the owner's call and the account's billing applies.
4. Download with the read-only key (`rclone copy --checksum`, as in "Recovery from the offsite copy"), verify against the newest manifest, and only then restore.
5. When the recovery is finished, put the cap back to its previous value and note the date, the old and new values and the reason in the owner's notes. A cap left high removes the protection against a runaway read or a stolen key that downloads in a loop.

**Recommended cadence**, sized so that routine operations stay far below any daily limit:

| Operation                       | How often                                                                | Download load                                  |
| ------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| `run`                           | daily, from the cron                                                     | only what is new                               |
| `check`                         | weekly, and after any change to the job                                  | one dump                                       |
| Targeted drill                  | after the first backfill, then every quarter, and after any change       | one dump and three photographs                 |
| `deep-check`                    | monthly while the bucket fits the daily limits; otherwise every quarter, on a day set aside for it | the whole bucket      |
| Full drill                      | once a year, or after an incident or a provider change, on a day set aside for it, replacing that day's `deep-check` | the whole bucket |

If the bucket outgrows caps that cannot be raised, a verification that stops at the cap is worthless: accept the targeted drill as the routine proof and raise the cap only on the day a full one is needed.

**Monitoring.** `serendipeak-offsite` heartbeat (see "Monitoring and alerts"), plus the `check` and `deep-check` of the cadence above, from any machine with Docker and the offsite variables:

```sh
docker run --rm --env-file <env file> serendipeak-offsite check
docker run --rm --env-file <env file> serendipeak-offsite deep-check
```

Both exit non-zero on any problem and never send a heartbeat, so running them cannot hide a missed run.

**Credentials.** Rotate by creating the new key first, updating the two variables, running the service once and `check`, then deleting the old key in its provider's console. A source token stolen from this service can read the media but not change it; a B2 key stolen from it can add objects, not remove them. `writeFiles` still allows a new version of an existing name and, in a bucket with versions, a delete marker that hides a file: every earlier version stays in the bucket and can be restored, which is why versions are kept and why the key must never have `deleteFiles` or any `writeBucket*` capability. Rotate the R2 and B2 credentials together after any incident, and never reuse the dump job's R2 token here.

**Rollback.** The service is additive. Stop it by removing its schedule (and the heartbeat, or pause the monitor); delete the Railway service if it is no longer wanted. Nothing in the production R2 buckets, the database or the existing `backup` service depends on it. The offsite bucket and its manifests stay and can be deleted from the Backblaze console, deliberately, as a separate step. A faulty release of the script is rolled back like any service, and an older manifest remains valid.

**Costs.** The figures in this paragraph are Backblaze's at the time of writing and are provider-dependent: confirm them on its pricing page. B2 charged $6.95 per TB per month for storage with the first 10 GB free, and its egress was free up to three times the average monthly stored data (then $0.01 per GB). Listing and download requests were free or inside the daily free allowance at this volume, unless a daily cap is set lower (see "B2 limits and daily caps"). The catalog is about 74 mountains with at most a 30 MiB original each plus renditions, a few GB at worst: **storage is zero to a few cents a month** and stays inside the free tier for a long time. The dumps are small and are kept forever offsite, a negligible, steadily growing amount. The daily run reads from B2 only the objects that are new, so egress is a small fraction of the free allowance; `deep-check` and a full restore read everything once, which a few GB of storage covers many times over. The Railway service runs for minutes a day and adds cents at most to the project's usage, which has a soft and a hard limit: check usage after the first backfill. R2 egress to the job is free.

**Limits to keep in mind.** The copy is not a point-in-time snapshot: an object created after the listing waits for the next run. Same-size corruption at rest of an object already in the manifest is caught by `deep-check`, not by `run`. Deletions never propagate, so deleted or replaced production objects accumulate offsite; clearing them is a manual administrative step. Object Lock is not enabled, so an attacker holding an administrative B2 key could still delete versions; keep that key out of the service and out of automation.

### Monitoring and alerts

Monitoring uses the Better Stack free plan and no additional infrastructure: one heartbeat per backup job and two uptime monitors. Alerts go to the owner by email. Nothing here needs a code change to the application.

| Monitor              | Type      | Target                                              | Alert when                                                                 |
| -------------------- | --------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| `serendipeak-web`    | uptime    | `GET https://serendipeak.camilasabino.dev/`         | the response is not 2xx, or does not arrive in time                        |
| `serendipeak-api`    | uptime    | `GET https://api.serendipeak.camilasabino.dev/healthz` | the response is not 2xx, or does not arrive in time                     |
| `serendipeak-backup` | heartbeat | the URL Better Stack generates for it               | no ping arrives for 24 h plus the grace period, or a `/fail` ping arrives |
| `serendipeak-offsite` | heartbeat | its own URL, never the one of `serendipeak-backup`  | no ping arrives for 24 h plus the grace period, or a `/fail` ping arrives |

- **Uptime monitors use `GET`.** `/healthz` accepts only `GET` (a `HEAD` is answered 405) and runs `SELECT 1`, so the API monitor also proves the database is reachable. The web monitor is the one that proves pages render.
- **Heartbeat**: period 24 h, grace 3 h. The job runs at 03:30 UTC and finishes within minutes, so a healthy day pings long before the limit and a missed or hung run alerts around 06:30 UTC at the latest.
- **What the job sends.** On exit status 0 (dump, archive check, checksum, uploads and the verification of the newest `daily/` dump all passed) it requests the URL, once. On any other outcome it requests the same URL with `/fail` appended, and exits with its original status. This includes a missing setting and `SIGTERM`/`SIGINT`. It does not send `/start`: how Better Stack treats it is not confirmed, and the 24 h period with a grace period does not need it.
- **Delivery problems never change the result.** The request is bounded (10 s, 3 retries). If it still fails the job logs `heartbeat delivery failed (curl exit N)` and keeps its own exit status. A good backup with an undelivered ping shows up as a late-heartbeat alert, not as a failed run, so the Railway log tells the two apart.
- **The URL is a secret.** It lives only in the `BACKUP_HEARTBEAT_URL` variable of the `backup` service, never in Git, a chat or an argument list. The job reads it from the environment, removes it from the environment of `pg_dump` and `curl`, and passes it to `curl` on standard input, so it appears in no process list and no log line. A URL that is not `https://`, has a query string, a quote or whitespace is skipped with a warning that does not print it, and the backup still runs.
- **Known limit.** A `SIGTERM` is handled when the command in progress returns, so a long `pg_dump` delays the `/fail` ping, bounded by `BACKUP_DUMP_TIMEOUT_SECONDS`. If Railway ends the container first, no `/fail` arrives and the missing ping raises the alert after the grace period.
- **Rotating the URL.** Rotate it whenever it has been pasted outside Railway (a chat, a ticket, shell history, a screenshot). It authorizes pings only: whoever holds it can hide a missed backup or raise a false alert, and cannot read any data. Better Stack gives a heartbeat a fixed URL, so rotating means replacing the heartbeat:
  1. In Better Stack create a new heartbeat with the same period, grace and alert policy. Copy its URL from the dashboard.
  2. Confirm the target with `railway status`, then set the variable on `backup` without putting the value in an argument: `pbpaste | railway variable set BACKUP_HEARTBEAT_URL --stdin --service backup`, and clear the clipboard afterwards (`pbcopy </dev/null`). The variable editor in the Railway dashboard works too.
  3. Pause the old heartbeat so it does not alert while the new one waits for its first run. The old URL keeps working until that heartbeat is deleted.
  4. After the next scheduled run, check that the `backup` log has neither `heartbeat delivery failed` nor `heartbeat skipped` and that the new heartbeat shows its ping. Then delete the old heartbeat, which is what invalidates the old URL.

**Configure once**

1. In Better Stack create the four monitors above with an email alert policy. Create each heartbeat first and copy its URL.
2. In Railway, on the `backup` service only, set `BACKUP_HEARTBEAT_URL` to the URL of `serendipeak-backup`, and on `offsite-backup` only, `OFFSITE_HEARTBEAT_URL` to the URL of `serendipeak-offsite`. Confirm the target with `railway status` before writing.
3. Check each monitor shows its first result: the uptime monitors immediately, the heartbeats after the next scheduled run.

**GitHub** (repository settings, Code security): enable secret scanning, push protection, Dependabot alerts and Dependabot security updates. Direct pushes to `main` stay allowed; the ruleset is not changed. Push protection blocks a push that contains a detected secret, and a bypass is a deliberate choice of the person pushing.

**Respond to an alert**

| Alert                                        | First look                                                                                                          | Recovery                                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Heartbeat `/fail`                            | The latest `backup` run in Railway. Its last log lines name the failing step and the exit status.                   | Fix the cause (database unreachable, R2 token, bucket), then run the service once and confirm the heartbeat recovers.                       |
| Heartbeat late, run succeeded in Railway     | The log shows `heartbeat delivery failed`. The URL is wrong, revoked or Better Stack was unreachable.               | Re-copy the URL into `BACKUP_HEARTBEAT_URL` if it changed; otherwise wait for the next run.                                                   |
| Heartbeat late, no run in Railway            | The cron schedule (`30 3 * * *`), whether the service is paused or removed, and the project's plan and usage.      | Restore the schedule or service, run it once, then `backup check`.                                                                            |
| Offsite heartbeat `/fail`                    | The latest `offsite-backup` run in Railway: its last lines name the failing step and the keys involved.            | "Offsite media and database copy", "When a run fails". Never re-run blindly: a corrupt object stays corrupt until it is dealt with.        |
| Offsite heartbeat late, no run in Railway    | The cron schedule (`0 5 * * *`), whether the service is paused or removed, and the project's plan and usage.       | Restore the schedule, run it once, then `offsite-backup check`.                                                                              |
| Log says `heartbeat skipped`                 | The variable is not an `https://` URL, or has a query string, quote or whitespace.                                  | Paste the bare URL Better Stack shows. The backup itself was not affected.                                                                    |
| Web or API monitor down                      | The monitor's incident (status code or timeout), then the service's deploy and runtime logs in Railway.             | Roll back as described in "Rollback and recovery". Confirm the smoke tests that apply.                                                        |

To pause alerts for planned work, pause the monitor in Better Stack and resume it afterwards. To stop reporting from the job, remove `BACKUP_HEARTBEAT_URL`: the job runs unchanged, and the heartbeat then alerts until it is paused or deleted.

### Daily discovery retention

Production has no scheduled job for this: the environment holds only `web`, `api`, `postgres` and `backup`. Nothing fails without it; the `daily_discovery` table just grows by one row a day. The command `python manage.py prune_daily_discoveries` is idempotent and safe to run at any time, and the database refuses to delete a discovery inside the retention window. Run it from the operator shell when needed (see "Operator shell"). Scheduling it would be a new cron service built from `services/api` with the same variables as `api`, and it would have to join the list in "Trusting forwarded headers". See the [developer reference](engineering/developer-reference.md#daily-discovery-retention).

## 3. R2 buckets and media domain

1. Buckets `<public-bucket>` and `<originals-bucket>` exist in the production account. `r2.dev` access is disabled on both; the originals bucket has no public access of any kind.
2. The media host is attached to `<public-bucket>` as a custom domain. No CORS rules, no workers, no cache rules: the objects carry their own `Cache-Control`.
3. A token with Object Read & Write on exactly those two buckets goes to the `api` variables. The operator token of "Operator shell" is a second token with the same scope.
4. Check the exposure of a bucket before any object exists there:

   ```sh
   curl -sI https://<media-host>/photographs/none/original.jpg | head -1      # 404, not a listing
   curl -s  https://<media-host>/ | head -c 200                                 # no bucket listing
   ```

**Backups of the media.** Objects are content-addressed and the application never overwrites or deletes them, so an incremental copy is safe to repeat. The `offsite-backup` service keeps an independent copy of both buckets and of the database dumps at another provider; see "Offsite media and database copy".

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
| Photographs are missing or damaged               | Re-copy the referenced keys from the offsite bucket ("Recovery from the offsite copy") or another bucket that holds them ("Media transfer"), then `check_photograph_media --deep --checksums`.                                                                                                          |
| No usable Editor                                 | `create_editor` from the operator shell through a new tunnel; close it again.                                                                                                                                                                                                                          |
| A secret is exposed                              | `DJANGO_SECRET_KEY`: replace and redeploy (ends every Studio session). `PREVIEW_SIGNING_KEY`: replace (ends outstanding previews). R2 token: create a new one, update the variables, redeploy, revoke the old one. Backblaze key or `OFFSITE_*` variable: see "Offsite media and database copy". Database password: rotate in Railway and redeploy every service that references it. |

Reversing the first migration drops the `postgis` extension and fails if other objects depend on it; do not migrate backwards on a database that holds data. The way back is a restore.

## Trusting forwarded headers

Django believes `X-Forwarded-Proto` only when `TRUSTED_PROXY_HOPS` is above `0` (`SECURE_PROXY_SSL_HEADER`), and uses the same value to pick the client address out of `X-Forwarded-For`. Gunicorn is configured not to derive the scheme from any header, `X-Forwarded-Host` is never trusted, and `ALLOWED_HOSTS` is an exact list. On Railway, `TRUSTED_PROXY_HOPS=1` is correct while **all** of these are true:

1. **Every outside request passes through Railway's HTTP edge.** The edge states `X-Forwarded-Proto: https` for what it forwards and redirects plain HTTP (a plain POST is turned into a GET and redirected), so a request that reaches the service from the internet was received over HTTPS. The `api` service has no TCP proxy and no other public route.
2. **The private network is a trust boundary.** Services in the same environment reach `api` without passing the edge and can send any header. The environment holds only services the owner controls (`postgres`, `web`, `backup`). `web` calls the API through its public HTTPS address, not through the private one.
3. **The edge replaces the header; Django fails closed otherwise.** Django compares the whole header value with `https`. `http`, an empty value or a list such as `http, https` make the request insecure, which turns into a redirect or a refused form post, never into a request treated as secure. A forged `X-Forwarded-Proto: https` from the internet is harmless, because the edge only forwards requests that really arrived over HTTPS. The smoke test above checks that the edge does not pass a client's `http` through.
4. **The hop count matches the proxies that append to `X-Forwarded-For`.** One for Railway's edge. Django reads the entry that many places from the right, so a client-supplied left-hand entry is ignored. Railway's documentation does not say whether the edge strips or appends client-supplied `X-Forwarded-For` values; reading from the right works in both cases. Adding another proxy in front (a Cloudflare-proxied record for the API host) makes it `2`. A wrong count is visible in the throttling check of the smoke tests.
5. **The health check needs none of this.** It arrives over plain HTTP from `healthcheck.railway.app`, carries no forwarding header, and is exempt from the redirect.

Verified in the production image with a bare client: no header and a forged `http` redirect to HTTPS; `https` is accepted; `http, https` redirects; a forged `X-Forwarded-Host` changes nothing; an unknown host is refused with 400; a forged left-hand `X-Forwarded-For` entry is ignored for the sign-in address. If any condition stops holding (a TCP proxy, an untrusted service in the environment, a proxy that forwards the client's value), set `TRUSTED_PROXY_HOPS=0` and list the public origin in `CSRF_TRUSTED_ORIGINS` instead; the redirect and HSTS then have to be handled at the edge, and sign-in throttling counts the proxy's address until the count is fixed.

CSRF stays on for every Studio form, cookies are `Secure` and scoped to `/studio/`, `ALLOWED_HOSTS` rejects unknown names, and the preview token is signed with its own key; none of these settings is relaxed by the deployment.

## Web security headers

The web service sends `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options`, `Permissions-Policy` and an enforced Content-Security-Policy limited to `base-uri`, `form-action`, `frame-ancestors` and `object-src`, which fetch nothing and cannot affect the globe. HSTS is deliberately not sent by the web service.

A fuller policy (`script-src`, `worker-src`, `connect-src`, `img-src`) is sent as `Content-Security-Policy-Report-Only`. It has no reporting endpoint, so violations show only in a browser console. Before enforcing it, load a mountain page and the camera editor on the production origin with the real Cesium ion token and read the console: every ion, imagery, terrain and media origin that is blocked must be added first. Enforcing without `'unsafe-inline'` for scripts additionally needs per-request nonces, which turns the statically built pages into dynamic ones.
