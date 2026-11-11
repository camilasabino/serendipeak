#!/bin/sh
# Offsite disaster-recovery copy of the production originals, public renditions and database dumps
# from R2 to a private bucket at an independent provider (Backblaze B2).
#
#   offsite-backup run          copy what is new, check coverage and content, record a checksum
#                               manifest and, when OFFSITE_HEARTBEAT_URL is set, report the outcome
#   offsite-backup check        fail unless the offsite bucket covers every source and manifest key,
#                               the newest manifest is recent and the newest daily dump is intact
#   offsite-backup deep-check   re-hash every object in the offsite bucket against the manifest
#
# `check` and `deep-check` never report to the heartbeat.
#
# Nothing here deletes or overwrites. Copies skip keys that already exist, `rc` accepts only the
# verbs this job needs, and the offsite key is meant to lack deleteFiles. The source credentials are
# meant to be read-only, and no database access is needed.
set -eu

mode="${1:-run}"
case "$mode" in
  run | check | deep-check) ;;
  *)
    echo "usage: offsite-backup [run|check|deep-check]" >&2
    exit 2
    ;;
esac

# The URL is a bearer secret. It stays in a shell variable, out of the environment that rclone and
# curl inherit, and out of every argument list and message.
heartbeat_url="${OFFSITE_HEARTBEAT_URL:-}"
unset OFFSITE_HEARTBEAT_URL

workdir=""

# Delivery problems are logged and never change the job's own result: a copy that succeeded must not
# fail because the monitor was unreachable, and the monitor alerts on a missing ping anyway.
heartbeat() {
  [ -n "$heartbeat_url" ] || return 0

  case "$heartbeat_url" in
    https://[!/]*) ;;
    *)
      echo "heartbeat skipped: OFFSITE_HEARTBEAT_URL is not an https URL" >&2
      return 0
      ;;
  esac
  case "$heartbeat_url" in
    *[!A-Za-z0-9._~:/%-]*)
      echo "heartbeat skipped: OFFSITE_HEARTBEAT_URL has characters that are not allowed" >&2
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

newline='
'

# `${VAR:?}` is not used: bash 3.2 in POSIX mode (the macOS `sh`) carries on with status 0.
# A newline would let a value add lines to the rclone configuration written below.
require() {
  for var in "$@"; do
    eval "value=\${$var:-}"
    if [ -z "$value" ]; then
      echo "$var is not set" >&2
      exit 1
    fi
    case "$value" in
      *"$newline"*)
        echo "$var contains a line break" >&2
        exit 1
        ;;
    esac
  done
}

require_bucket_name() {
  eval "value=\${$1}"
  case "$value" in
    *[!A-Za-z0-9.-]*)
      echo "$1 is not a bucket name" >&2
      exit 1
      ;;
  esac
}

# Credentials are sent to this URL, so plain http is refused, and a path, query or user info is too:
# it is the bare origin of an S3 endpoint. The value is never echoed, since a wrong one may carry a
# secret.
require_https_endpoint() {
  eval "value=\${$1}"
  case "$value" in
    https://*[!A-Za-z0-9.:-]* | https:// | https://[!A-Za-z0-9]*) ;;
    https://*) return 0 ;;
  esac
  echo "$1 must be an https:// URL of the form https://host, without a path" >&2
  exit 1
}

require_number() {
  eval "value=\${$1}"
  case "$value" in
    '' | *[!0-9]*)
      echo "$1 is not a number" >&2
      exit 1
      ;;
  esac
}

require OFFSITE_SRC_ENDPOINT_URL OFFSITE_SRC_ACCESS_KEY_ID OFFSITE_SRC_SECRET_ACCESS_KEY \
  OFFSITE_SRC_ORIGINALS_BUCKET OFFSITE_SRC_PUBLIC_BUCKET OFFSITE_SRC_BACKUP_BUCKET \
  OFFSITE_DST_ENDPOINT_URL OFFSITE_DST_REGION OFFSITE_DST_ACCESS_KEY_ID \
  OFFSITE_DST_SECRET_ACCESS_KEY OFFSITE_DST_BUCKET

for var in OFFSITE_SRC_ORIGINALS_BUCKET OFFSITE_SRC_PUBLIC_BUCKET OFFSITE_SRC_BACKUP_BUCKET \
  OFFSITE_DST_BUCKET; do
  require_bucket_name "$var"
done

require_https_endpoint OFFSITE_SRC_ENDPOINT_URL
require_https_endpoint OFFSITE_DST_ENDPOINT_URL

COPY_ATTEMPTS="${OFFSITE_COPY_ATTEMPTS:-3}"
RETRY_DELAY="${OFFSITE_RETRY_DELAY_SECONDS:-30}"
MAX_AGE_SECONDS="${OFFSITE_MAX_AGE_SECONDS:-129600}"
require_number COPY_ATTEMPTS
require_number RETRY_DELAY
require_number MAX_AGE_SECONDS

DST_BUCKET="$OFFSITE_DST_BUCKET"
NAMES="originals media db-backups"

workdir="$(mktemp -d)"

# Credentials go through a configuration file so they never appear in a process argument list, and
# are then dropped from the environment that later commands inherit.
umask 077
rclone_conf="$workdir/rclone.conf"
cat >"$rclone_conf" <<EOF
[src]
type = s3
provider = Cloudflare
endpoint = $OFFSITE_SRC_ENDPOINT_URL
access_key_id = $OFFSITE_SRC_ACCESS_KEY_ID
secret_access_key = $OFFSITE_SRC_SECRET_ACCESS_KEY
region = auto
no_check_bucket = true

[dst]
type = s3
provider = Other
endpoint = $OFFSITE_DST_ENDPOINT_URL
region = $OFFSITE_DST_REGION
access_key_id = $OFFSITE_DST_ACCESS_KEY_ID
secret_access_key = $OFFSITE_DST_SECRET_ACCESS_KEY
no_check_bucket = true
EOF
unset OFFSITE_SRC_ACCESS_KEY_ID OFFSITE_SRC_SECRET_ACCESS_KEY \
  OFFSITE_DST_ACCESS_KEY_ID OFFSITE_DST_SECRET_ACCESS_KEY

# The only door to rclone. Listing, hashing and copying cannot remove anything, whereas `sync`,
# `move`, `delete` or `purge` could, so a typo or a later edit cannot reach them.
rc() {
  case "$1" in
    copy | copyto | lsf | hashsum) ;;
    *)
      echo "refusing rclone $1: only copy, copyto, lsf and hashsum are allowed" >&2
      exit 1
      ;;
  esac
  rclone --config "$rclone_conf" --log-level NOTICE "$@"
}

source_remote() {
  case "$1" in
    originals) echo "src:$OFFSITE_SRC_ORIGINALS_BUCKET" ;;
    media) echo "src:$OFFSITE_SRC_PUBLIC_BUCKET" ;;
    db-backups) echo "src:$OFFSITE_SRC_BACKUP_BUCKET" ;;
  esac
}

dest_remote() {
  echo "dst:$DST_BUCKET/$1"
}

fail_if_any() {
  if [ -s "$1" ]; then
    echo "$2:" >&2
    head -n 20 "$1" | sed 's/^/  /' >&2
    echo "  ($(wc -l <"$1" | tr -d ' ') in total)" >&2
    exit 1
  fi
}

# Listings are "key;size". `LC_ALL=C` keeps `sort` and `comm` agreeing on the order.
keys_of() {
  sed 's/;[0-9]*$//' "$1" | LC_ALL=C sort -u
}

# The destination prefix does not exist before the first copy, and rclone reports that as exit 3.
list_remote() {
  list_status=0
  rc lsf --recursive --files-only --format ps --separator ';' "$1" >"$2.raw" || list_status=$?

  if [ "$list_status" -eq 3 ] && [ "${3:-}" = "allow-missing" ]; then
    : >"$2.raw"
    list_status=0
  fi
  if [ "$list_status" -ne 0 ]; then
    echo "listing $1 failed (rclone exit $list_status)" >&2
    exit 1
  fi

  LC_ALL=C sort "$2.raw" >"$2"
}

collect_listings() {
  for name in $NAMES; do
    list_remote "$(source_remote "$name")" "$workdir/$name.src.lst"
    list_remote "$(dest_remote "$name")" "$workdir/$name.dst.lst" allow-missing
    keys_of "$workdir/$name.src.lst" >"$workdir/$name.src.keys"
    keys_of "$workdir/$name.dst.lst" >"$workdir/$name.dst.keys"
  done
}

copy_all() {
  for name in $NAMES; do
    attempt=1
    while ! rc copy --ignore-existing --transfers 4 --checkers 8 \
      "$(source_remote "$name")" "$(dest_remote "$name")"; do
      if [ "$attempt" -ge "$COPY_ATTEMPTS" ]; then
        echo "copy of $name failed after $attempt attempts" >&2
        exit 1
      fi
      echo "copy of $name failed (attempt $attempt of $COPY_ATTEMPTS), retrying" >&2
      attempt=$((attempt + 1))
      sleep "$RETRY_DELAY"
    done
  done
}

# The manifest lists "sha256  <name>/<key>" for every verified original, rendition and dump, paths
# relative to the bucket root so `sha256sum -c` works from the root of a restored copy.
latest_manifest=""

load_manifest() {
  list_remote "dst:$DST_BUCKET/manifests" "$workdir/manifests.lst" allow-missing
  latest_manifest="$(keys_of "$workdir/manifests.lst" |
    awk 'index($0, "offsite-") == 1 && /\.sha256$/' | tail -n 1)"

  : >"$workdir/manifest.prev"
  if [ -n "$latest_manifest" ]; then
    rc copyto "dst:$DST_BUCKET/manifests/$latest_manifest" "$workdir/manifest.prev"
  fi

  awk '
    NF != 2 || length($1) != 64 || $1 !~ /^[0-9a-f]+$/ || $2 !~ /^(originals|media|db-backups)\// {
      print
    }
  ' "$workdir/manifest.prev" >"$workdir/manifest.bad"
  fail_if_any "$workdir/manifest.bad" "manifests/$latest_manifest has malformed lines"

  for name in $NAMES; do
    awk -v prefix="$name/" 'index($2, prefix) == 1 { print substr($2, length(prefix) + 1) }' \
      "$workdir/manifest.prev" | LC_ALL=C sort -u >"$workdir/$name.manifest.keys"
  done
}

# Source coverage is what the next copy would have to deliver, and manifest coverage is what an
# earlier run already verified, so an object lost from the offsite bucket is caught even after it
# has disappeared from the source.
verify_coverage() {
  for name in $NAMES; do
    LC_ALL=C sort -u "$workdir/$name.src.keys" "$workdir/$name.manifest.keys" \
      >"$workdir/$name.expected.keys"
    comm -23 "$workdir/$name.expected.keys" "$workdir/$name.dst.keys" >"$workdir/$name.missing"
    fail_if_any "$workdir/$name.missing" "$name: objects missing from the offsite bucket"

    # A key present on both sides with another size is a truncated or replaced object. Objects are
    # content-addressed and never rewritten, so it is never a legitimate update.
    comm -23 "$workdir/$name.src.lst" "$workdir/$name.dst.lst" |
      sed 's/;[0-9]*$//' | LC_ALL=C sort -u >"$workdir/$name.differing"
    fail_if_any "$workdir/$name.differing" "$name: objects whose size differs from the source"
  done

  # A dump and its checksum are one unit: either one alone cannot be verified.
  sed -n 's/\.dump$//p' "$workdir/db-backups.dst.keys" >"$workdir/dumps.base"
  sed -n 's/\.dump\.sha256$//p' "$workdir/db-backups.dst.keys" >"$workdir/sums.base"
  comm -3 "$workdir/dumps.base" "$workdir/sums.base" >"$workdir/unpaired"
  fail_if_any "$workdir/unpaired" "db-backups: dumps and checksum files that do not pair up"
}

# $1 remote, $2 file of keys, $3 output of "sha256  key" lines. rclone reads the whole object, since
# neither R2 nor B2 stores a SHA-256 to ask for, so what is compared is what is actually stored.
hash_objects() {
  : >"$3"
  [ -s "$2" ] || return 0

  rc hashsum sha256 --download --files-from "$2" "$1" >"$3" || {
    echo "hashing objects under $1 failed" >&2
    exit 1
  }
}

# $1 label, $2 file of expected "sha256  key" lines, $3 file of actual lines.
fail_on_hash_difference() {
  awk '
    NR == FNR { want[$2] = $1; next }
    { got[$2] = $1 }
    END { for (key in want) if (got[key] != want[key]) print key }
  ' "$2" "$3" | LC_ALL=C sort >"$workdir/hash.differing"
  fail_if_any "$workdir/hash.differing" "$1: objects that are missing or do not match their checksum"
}

record_verified() {
  awk -v prefix="$1/" '{ print $1 "  " prefix $2 }' "$2" >>"$workdir/manifest.new"
}

verify_new_originals() {
  comm -23 "$workdir/originals.dst.keys" "$workdir/originals.manifest.keys" >"$workdir/originals.new"
  [ -s "$workdir/originals.new" ] || return 0

  # The key carries the SHA-256 of the bytes it names, which is a check that needs no second copy.
  awk -F/ -v rejected="$workdir/originals.unaddressed" '
    NF == 3 && $1 == "photographs" && length($2) == 64 && $2 ~ /^[0-9a-f]+$/ &&
      $3 ~ /^original\.[a-z0-9]+$/ { print $2 "  " $0; next }
    { print $0 > rejected }
  ' "$workdir/originals.new" >"$workdir/originals.expected"
  : >>"$workdir/originals.unaddressed"
  fail_if_any "$workdir/originals.unaddressed" "originals: keys that are not content-addressed"

  hash_objects "$(dest_remote originals)" "$workdir/originals.new" "$workdir/originals.actual"
  fail_on_hash_difference "originals" "$workdir/originals.expected" "$workdir/originals.actual"
  record_verified originals "$workdir/originals.expected"
}

# A rendition's key names its original, not its own bytes, so the only independent reference is the
# source object itself. The hash recorded here is what `deep-check` and a restore later compare to.
verify_new_renditions() {
  comm -23 "$workdir/media.dst.keys" "$workdir/media.manifest.keys" >"$workdir/media.new"
  [ -s "$workdir/media.new" ] || return 0

  comm -23 "$workdir/media.new" "$workdir/media.src.keys" >"$workdir/media.unverifiable"
  fail_if_any "$workdir/media.unverifiable" \
    "media: offsite objects absent from the source, so there is nothing to verify them against"

  hash_objects "$(source_remote media)" "$workdir/media.new" "$workdir/media.expected"
  hash_objects "$(dest_remote media)" "$workdir/media.new" "$workdir/media.actual"
  fail_on_hash_difference "media" "$workdir/media.expected" "$workdir/media.actual"
  record_verified media "$workdir/media.expected"
}

# The checksum file is the one the backup job wrote when it made the dump, before any copy.
verify_new_dumps() {
  grep '\.dump$' "$workdir/db-backups.dst.keys" |
    comm -23 - "$workdir/db-backups.manifest.keys" >"$workdir/dumps.new" || true
  [ -s "$workdir/dumps.new" ] || return 0

  sed 's/$/.sha256/' "$workdir/dumps.new" >"$workdir/sums.new"
  mkdir "$workdir/sums"
  rc copy --files-from "$workdir/sums.new" "$(dest_remote db-backups)" "$workdir/sums"

  : >"$workdir/dumps.expected"
  : >"$workdir/dumps.badsum"
  while read -r dump; do
    line="$(cat "$workdir/sums/$dump.sha256")"
    digest="${line%% *}"
    named="${line#"$digest"}"
    while [ "${named#" "}" != "$named" ]; do
      named="${named#" "}"
    done
    named="${named#\*}"
    case "$digest" in
      *[!0-9a-f]* | '') echo "$dump.sha256" >>"$workdir/dumps.badsum" ;;
      *)
        if [ "${#digest}" -ne 64 ] || [ "$named" != "${dump##*/}" ]; then
          echo "$dump.sha256" >>"$workdir/dumps.badsum"
        else
          echo "$digest  $dump" >>"$workdir/dumps.expected"
        fi
        ;;
    esac
  done <"$workdir/dumps.new"
  fail_if_any "$workdir/dumps.badsum" "db-backups: checksum files that are malformed or name another file"

  hash_objects "$(dest_remote db-backups)" "$workdir/dumps.new" "$workdir/dumps.actual"
  fail_on_hash_difference "db-backups" "$workdir/dumps.expected" "$workdir/dumps.actual"
  record_verified db-backups "$workdir/dumps.expected"
}

write_manifest() {
  : >>"$workdir/manifest.new"
  cat "$workdir/manifest.prev" "$workdir/manifest.new" | LC_ALL=C sort -k2,2 >"$workdir/manifest.next"

  awk '{ print $2 }' "$workdir/manifest.next" | uniq -d >"$workdir/manifest.duplicates"
  fail_if_any "$workdir/manifest.duplicates" "the manifest would list a key twice"

  manifest_key="manifests/offsite-$(date -u +%Y%m%dT%H%M%SZ).sha256"
  rc copyto --ignore-existing "$workdir/manifest.next" "dst:$DST_BUCKET/$manifest_key"
  rc copyto "dst:$DST_BUCKET/$manifest_key" "$workdir/manifest.readback"
  if ! cmp -s "$workdir/manifest.next" "$workdir/manifest.readback"; then
    echo "$manifest_key does not read back as written" >&2
    exit 1
  fi
}

count_of() {
  wc -l <"$1" | tr -d ' '
}

run() {
  copy_all
  collect_listings
  load_manifest
  verify_coverage

  : >"$workdir/manifest.new"
  verify_new_originals
  verify_new_renditions
  verify_new_dumps
  write_manifest

  echo "offsite ok: originals=$(count_of "$workdir/originals.dst.keys")" \
    "media=$(count_of "$workdir/media.dst.keys")" \
    "db-backups=$(count_of "$workdir/db-backups.dst.keys")" \
    "newly-verified=$(count_of "$workdir/manifest.new")" "manifest=$manifest_key"
}

require_manifest() {
  if [ -z "$latest_manifest" ]; then
    echo "no manifest found: the offsite copy has never completed" >&2
    exit 1
  fi
}

check() {
  collect_listings
  load_manifest
  require_manifest
  verify_coverage

  stamp="${latest_manifest#offsite-}"
  stamp="${stamp%.sha256}"
  oldest_allowed="$(date -u -d "@$(($(date +%s) - MAX_AGE_SECONDS))" +%Y%m%dT%H%M%SZ)"
  if [ "$stamp" \< "$oldest_allowed" ]; then
    echo "newest manifest is $latest_manifest, older than ${MAX_AGE_SECONDS}s" >&2
    exit 1
  fi

  newest="$(grep '^daily/serendipeak-.*\.dump$' "$workdir/db-backups.dst.keys" | tail -n 1 || true)"
  if [ -z "$newest" ]; then
    echo "no daily dump in the offsite bucket" >&2
    exit 1
  fi

  echo "$newest" >"$workdir/newest.keys"
  hash_objects "$(dest_remote db-backups)" "$workdir/newest.keys" "$workdir/newest.actual"
  mkdir "$workdir/sums"
  echo "$newest.sha256" >"$workdir/newest.sums"
  rc copy --files-from "$workdir/newest.sums" "$(dest_remote db-backups)" "$workdir/sums"
  read -r digest _ <"$workdir/sums/$newest.sha256"
  echo "$digest  $newest" >"$workdir/newest.expected"
  fail_on_hash_difference "db-backups" "$workdir/newest.expected" "$workdir/newest.actual"

  echo "check ok: $latest_manifest, $newest"
}

deep_check() {
  collect_listings
  load_manifest
  require_manifest
  verify_coverage

  for name in $NAMES; do
    awk -v prefix="$name/" 'index($2, prefix) == 1 { print $1 "  " substr($2, length(prefix) + 1) }' \
      "$workdir/manifest.prev" >"$workdir/$name.deep.expected"
    awk '{ print $2 }' "$workdir/$name.deep.expected" >"$workdir/$name.deep.keys"

    hash_objects "$(dest_remote "$name")" "$workdir/$name.deep.keys" "$workdir/$name.deep.actual"
    fail_on_hash_difference "$name" "$workdir/$name.deep.expected" "$workdir/$name.deep.actual"
  done

  echo "deep-check ok: $(count_of "$workdir/manifest.prev") objects match $latest_manifest"
}

case "$mode" in
  run) run ;;
  check) check ;;
  deep-check) deep_check ;;
esac
