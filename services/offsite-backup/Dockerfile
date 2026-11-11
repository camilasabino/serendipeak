# syntax=docker/dockerfile:1

# The copy job needs no PostgreSQL client and no database access, so it is its own service with its
# own image and root directory: a change here never redeploys the dump job, and the image carries
# only rclone and curl.
FROM alpine:3.22

RUN apk add --no-cache curl rclone

COPY offsite-backup.sh /usr/local/bin/offsite-backup

USER nobody
ENTRYPOINT ["/usr/local/bin/offsite-backup"]
CMD ["run"]
