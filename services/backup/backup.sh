#!/bin/sh
# Daily logical backup of the production database to a private S3-compatible bucket (R2).
#
#   backup run     dump, verify, checksum, upload and re-verify the upload (default); exits non-zero
#                  on any failure and, when BACKUP_HEARTBEAT_URL is set, reports the outcome to it
#   backup check   fail unless the newest daily backup is recent, intact and listable; never reports
#
# Retention is not done here: the bucket's lifecycle rules expire `daily/` and `weekly/`, so this
# job needs no delete permission.
set -eu

mode="${1:-run}"
case "$mode" in
  run | check) ;;
  *)
    echo "usage: backup [run|check]" >&2
    exit 2
    ;;
esac

# The URL is a bearer secret. It stays in a shell variable, out of the environment that pg_dump and
# curl inherit, and out of every argument list and message.
heartbeat_url="${BACKUP_HEARTBEAT_URL:-}"
unset BACKUP_HEARTBEAT_URL

workdir=""

# Delivery problems are logged and never change the job's own result: a backup that succeeded must
# not fail because the monitor was unreachable, and the monitor alerts on a missing ping anyway.
heartbeat() {
  [ -n "$heartbeat_url" ] || return 0

  case "$heartbeat_url" in
    https://[!/]*) ;;
    *)
      echo "heartbeat skipped: BACKUP_HEARTBEAT_URL is not an https URL" >&2
      return 0
      ;;
  esac
  case "$heartbeat_url" in
    *[!A-Za-z0-9._~:/%-]*)
      echo "heartbeat skipped: BACKUP_HEARTBEAT_URL has characters that are not allowed" >&2
      return 0
      ;;
  esac

  # The URL goes to curl on stdin because `printf` is a builtin, so it never reaches `ps`.
  hb_status=0
  printf 'url = "%s%s"\n' "${heartbeat_url%/}" "$1" |
    curl --config - --silent --fail --output /dev/null \
      --max-time 10 --retry 3 --retry-delay 2 --retry-all-errors || hb_status=$?

  if [ "$hb_status" -ne 0 ]; then
    echo "heartbeat delivery failed (curl exit $hb_status)" >&2
  fi
  return 0
}

# Runs on every way out of the script, including a failed configuration check and a signal, so the
# exit status seen here is the original one and is returned unchanged.
finish() {
  status=$?
  trap '' INT TERM

  if [ -n "$workdir" ]; then
    rm -rf "$workdir"
  fi

  if [ "$mode" = "run" ]; then
    if [ "$status" -eq 0 ]; then
      heartbeat ""
    else
      heartbeat "/fail"
    fi
  fi

  exit "$status"
}

# A trap action on INT or TERM does not stop the script by itself; `exit` does, and reaches `finish`.
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# `${VAR:?}` is not used: bash 3.2 in POSIX mode (the macOS `sh`) carries on with status 0.
require() {
  for var in "$@"; do
    eval "value=\${$var:-}"
    if [ -z "$value" ]; then
      echo "$var is not set" >&2
      exit 1
    fi
  done
}

require BACKUP_S3_ENDPOINT_URL BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY BACKUP_BUCKET

DUMP_TIMEOUT="${BACKUP_DUMP_TIMEOUT_SECONDS:-1500}"
MAX_AGE_SECONDS="${BACKUP_MAX_AGE_SECONDS:-129600}"
BASE_URL="${BACKUP_S3_ENDPOINT_URL%/}/${BACKUP_BUCKET}"

workdir="$(mktemp -d)"

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
  require PGHOST PGUSER PGPASSWORD PGDATABASE

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

  uploaded="daily/$name"
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

  # A separate directory keeps the downloaded copy from overwriting the local dump of a `run`.
  verify_dir="$workdir/verify"
  mkdir -p "$verify_dir"

  name="${latest#daily/}"
  s3 --output "$verify_dir/$name" "$BASE_URL/$latest"
  s3 --output "$verify_dir/$name.sha256" "$BASE_URL/$latest.sha256"
  (cd "$verify_dir" && sha256sum -c "$name.sha256")
  pg_restore --list "$verify_dir/$name" >/dev/null
  echo "check ok: $latest"
}

run() {
  backup
  check

  # Without this a stale-but-recent dump could vouch for an upload that never became listable.
  if [ "$latest" != "$uploaded" ]; then
    echo "newest daily backup is $latest, expected the one just uploaded: $uploaded" >&2
    exit 1
  fi
}

"$mode"
