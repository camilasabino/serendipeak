# syntax=docker/dockerfile:1

# `pg_dump` must match the server's major version (PostgreSQL 18), so the image starts from the
# official client tools instead of a generic base.
FROM postgres:18-alpine

RUN apk add --no-cache curl

COPY backup.sh /usr/local/bin/backup

USER postgres
ENTRYPOINT ["/usr/local/bin/backup"]
CMD ["run"]
