import os

# Railway injects PORT. "[::]" is dual-stack, so the public edge (IPv4) and the private network
# (IPv6) both reach the service.
bind = f"[::]:{os.environ.get('PORT', '8000')}"

# Threads share one interpreter's memory and the database connection is per thread, so a slow
# photograph upload occupies one thread, not a whole worker.
worker_class = "gthread"
workers = int(os.environ.get("WEB_CONCURRENCY", "2"))
threads = 4

# Processing a photograph upload holds the request open; the default 30 s would kill it midway.
timeout = 120

# Whether a request arrived over HTTPS is decided by Django alone, from TRUSTED_PROXY_HOPS. The
# default scheme headers would let Gunicorn mark a request as secure on its own, and without
# SECURE_PROXY_SSL_HEADER request.is_secure() falls back to that, so a header forged by a caller
# that skipped the edge would bypass the hop count. An empty mapping leaves the scheme at "http"
# and the decision to SECURE_PROXY_SSL_HEADER.
secure_scheme_headers = {}

accesslog = None
errorlog = "-"
