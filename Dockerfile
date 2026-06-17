# syntax=docker/dockerfile:1
FROM node:22-slim

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y \
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

# Default command (overridden by docker-compose per service)
CMD ["npm", "start"]
