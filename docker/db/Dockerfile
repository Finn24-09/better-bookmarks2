FROM postgres:16-alpine

# Install build dependencies for pgjwt and pgtap
RUN apk add --no-cache \
    git \
    make \
    gcc \
    musl-dev \
    patch \
    perl \
    postgresql-dev

# Install pgjwt (JWT signing inside PostgreSQL)
RUN cd /tmp \
    && git clone --depth 1 https://github.com/michelp/pgjwt.git \
    && cd pgjwt \
    && make install \
    && cd / && rm -rf /tmp/pgjwt

# Install pgTAP (unit testing framework for PostgreSQL)
RUN cd /tmp \
    && git clone --depth 1 --branch v1.3.3 https://github.com/theory/pgtap.git \
    && cd pgtap \
    && make install \
    && cd / && rm -rf /tmp/pgtap

# Remove build dependencies to keep image small
RUN apk del git make gcc musl-dev postgresql-dev

# Init scripts are mounted/copied via docker-compose
