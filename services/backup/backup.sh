#!/bin/sh
# Daily logical backup of the production database to a private S3-compatible bucket (R2).
#
#   backup run     dump, verify, checksum and upload (default); exits non-zero on any failure
#   backup check   fail unless the newest daily backup is recent, intact and listable
#
# Retention is not done here: the bucket's lifecycle rules expire `daily/` and `weekly/`, so this
# job needs no delete permission.
set -eu

: "${BACKUP_S3_ENDPOINT_URL:?}" "${BACKUP_S3_ACCESS_KEY_ID:?}" "${BACKUP_S3_SECRET_ACCESS_KEY:?}"
: "${BACKUP_BUCKET:?}"

DUMP_TIMEOUT="${BACKUP_DUMP_TIMEOUT_SECONDS:-1500}"
MAX_AGE_SECONDS="${BACKUP_MAX_AGE_SECONDS:-129600}"
BASE_URL="${BACKUP_S3_ENDPOINT_URL%/}/${BACKUP_BUCKET}"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT INT TERM

# Credentials go through a config file so they never appear in a process argument list.
umask 077
printf 'user = "%s:%s"\n' "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" >"$workdir/curl.conf"

s3() {
  curl --config "$workdir/curl.conf" --aws-sigv4 "aws:amz:auto:s3" \
    -H "x-amz-content-sha256: UNSIGNED-PAYLOAD" \
    --fail --silent --show-error --retry 3 --retry-all-errors --max-time 600 "$@"
}

upload() {
  s3 --upload-file "$1" "$BASE_URL/$2" >/dev/null
  remote_size="$(s3 --head "$BASE_URL/$2" | tr -d '\r' | awk 'tolower($1) == "content-length:" {print $2}')"
  local_size="$(wc -c <"$1" | tr -d ' ')"
  if [ "$remote_size" != "$local_size" ]; then
    echo "upload of $2 is $remote_size bytes, expected $local_size" >&2
    exit 1
  fi
}

backup() {
  : "${PGHOST:?}" "${PGUSER:?}" "${PGPASSWORD:?}" "${PGDATABASE:?}"

  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  name="serendipeak-$stamp.dump"
  dump="$workdir/$name"

  timeout "$DUMP_TIMEOUT" pg_dump --format=custom --no-owner --no-acl --file "$dump"
  pg_restore --list "$dump" >/dev/null
  (cd "$workdir" && sha256sum "$name" >"$name.sha256")

  prefixes="daily"
  # Sunday (ISO weekday 7) in UTC also keeps a copy for the longer weekly retention.
  if [ "$(date -u +%u)" = "7" ]; then
    prefixes="daily weekly"
  fi

  for prefix in $prefixes; do
    upload "$dump" "$prefix/$name"
    upload "$dump.sha256" "$prefix/$name.sha256"
  done

  echo "backup ok: $name $(wc -c <"$dump" | tr -d ' ') bytes sha256=$(cut -d' ' -f1 "$dump.sha256") prefixes=$prefixes"
}

check() {
  latest="$(s3 --get "$BASE_URL?list-type=2&prefix=daily/" |
    grep -o '<Key>[^<]*\.dump</Key>' | sed 's/<[^>]*>//g' | sort | tail -n 1)"
  if [ -z "$latest" ]; then
    echo "no daily backup found" >&2
    exit 1
  fi

  stamp="${latest#daily/serendipeak-}"
  stamp="${stamp%.dump}"
  oldest_allowed="$(date -u -d "@$(($(date +%s) - MAX_AGE_SECONDS))" +%Y%m%dT%H%M%SZ)"
  if [ "$stamp" \< "$oldest_allowed" ]; then
    echo "newest daily backup is $latest, older than ${MAX_AGE_SECONDS}s" >&2
    exit 1
  fi

  name="${latest#daily/}"
  s3 --output "$workdir/$name" "$BASE_URL/$latest"
  s3 --output "$workdir/$name.sha256" "$BASE_URL/$latest.sha256"
  (cd "$workdir" && sha256sum -c "$name.sha256")
  pg_restore --list "$workdir/$name" >/dev/null
  echo "check ok: $latest"
}

case "${1:-run}" in
  run) backup ;;
  check) check ;;
  *)
    echo "usage: backup [run|check]" >&2
    exit 2
    ;;
esac
