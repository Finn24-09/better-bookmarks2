# syntax=docker/dockerfile:1

# ─── Target: production ──────────────────────────────────────────────────────
# pgjwt only. All build tools are added and removed within a single RUN so
# they never appear in any committed layer, keeping the image close to the
# postgres:16-alpine base (~90 MB vs the old ~600 MB+ multi-layer approach).
FROM postgres:16-alpine AS production

RUN set -eux \
    && apk add --no-cache --virtual .build-deps \
           git make gcc musl-dev postgresql-dev \
    && git clone --depth 1 https://github.com/michelp/pgjwt.git /tmp/pgjwt \
    && make -C /tmp/pgjwt install \
    && rm -rf /tmp/pgjwt \
    && apk del .build-deps

# ─── Target: dev ─────────────────────────────────────────────────────────────
# Extends production with pgTAP (database unit testing framework).
# Selected via `build.target: dev` in docker-compose.override.yml.
FROM production AS dev

RUN set -eux \
    && apk add --no-cache --virtual .build-deps \
           git make gcc musl-dev patch perl postgresql-dev \
    && git clone --depth 1 --branch v1.3.3 \
           https://github.com/theory/pgtap.git /tmp/pgtap \
    && make -C /tmp/pgtap install \
    && rm -rf /tmp/pgtap \
    && apk del .build-deps
