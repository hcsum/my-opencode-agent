# syntax=docker/dockerfile:1
FROM node:22-slim

# Optional Debian mirror for faster apt behind slow cross-border links. Defaults
# to the upstream CDN; set per-deployment (e.g. a domestic mirror) via the
# APT_MIRROR build arg — wired through docker-compose from .env.
ARG APT_MIRROR=deb.debian.org

# Install build tools for native modules (better-sqlite3)
RUN if [ "$APT_MIRROR" != "deb.debian.org" ]; then \
      sed -i "s|deb.debian.org|$APT_MIRROR|g" \
        /etc/apt/sources.list /etc/apt/sources.list.d/*.sources 2>/dev/null || true; \
    fi && \
    apt-get update && apt-get install -y \
    build-essential \
    curl \
    git \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

ENV NODE_OPTIONS=--max-old-space-size=1536

# Runtime state lives under /workspace (see docker-compose XDG_*/GMAIL_MCP_DIR),
# not /root; opencode creates its XDG dirs on demand and the bind mounts create
# their own targets, so no /root scaffolding is needed here.

# Pin the CLI version so the container runtime stays aligned with local dev.
RUN npm install -g opencode-ai@1.15.3

# Copy package files first for layer caching
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .

# Install the .opencode plugin deps (mem0ai etc). These live in a separate
# package (.opencode/package.json) that the root `npm ci` above does not touch,
# and node_modules/ is .dockerignore'd — so without this step the mem0-memory
# plugin fails to load at runtime ("Cannot find module 'mem0ai/oss'") and no
# memory is ever written. npm ci builds it fresh from .opencode/package-lock.json.
RUN cd .opencode && npm ci

# Default command (overridden by docker-compose per service)
CMD ["npm", "start"]
