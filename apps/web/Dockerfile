# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS build

WORKDIR /app

# `npm ci` fails when package-lock.json and package.json disagree.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Next inlines NEXT_PUBLIC_* into the browser bundle when it builds, so a wrong value cannot be
# fixed by changing the running service's variables: it needs a new build. Failing here is
# cheaper than a deployed site whose pages answer 500. All three values are public by design;
# they ship to every browser, so they are build arguments and not secrets.
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_CESIUM_ION_TOKEN
ARG NEXT_PUBLIC_CESIUM_IMAGERY_MODE
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    NEXT_PUBLIC_CESIUM_ION_TOKEN=${NEXT_PUBLIC_CESIUM_ION_TOKEN} \
    NEXT_PUBLIC_CESIUM_IMAGERY_MODE=${NEXT_PUBLIC_CESIUM_IMAGERY_MODE} \
    NEXT_TELEMETRY_DISABLED=1

RUN case "${NEXT_PUBLIC_API_BASE_URL}" in \
      https://*) ;; \
      *) echo "NEXT_PUBLIC_API_BASE_URL must be the API's public https origin" >&2; exit 1 ;; \
    esac
RUN test -n "${NEXT_PUBLIC_CESIUM_ION_TOKEN}" \
    || { echo "NEXT_PUBLIC_CESIUM_ION_TOKEN is required: the globe cannot load without it" >&2; exit 1; }

# `npm run build` copies the Cesium assets first (prebuild). The gate fails the build when a
# development-only identifier reaches the production bundle.
RUN npm run build \
    && npm run check:production-gate \
    && npm prune --omit=dev


FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/next.config.ts ./next.config.ts

USER node

# Exec form without npm: Next is PID 1 and handles the platform's SIGTERM itself. It listens on
# $PORT, which Railway injects.
CMD ["./node_modules/.bin/next", "start"]
