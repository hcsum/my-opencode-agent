# syntax=docker/dockerfile:1
FROM node:22-slim

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

ENV NODE_OPTIONS=--max-old-space-size=1536

RUN mkdir -p /root/.local/share/opencode /root/.config/opencode

# Install OpenCode CLI globally
RUN npm install -g opencode-ai

# Copy package files first for layer caching
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Default command (overridden by docker-compose per service)
CMD ["npm", "start"]
