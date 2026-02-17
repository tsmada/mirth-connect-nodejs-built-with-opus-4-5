# Multi-stage Dockerfile for Node.js Mirth Connect
# Build context: repo root
# Usage: nerdctl build -t node-mirth:latest -f k8s/Dockerfile .

# ── Stage 1: Install dependencies ────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/fix-xslt-processor.js ./scripts/
RUN npm ci

# ── Stage 2: Compile TypeScript ──────────────────────────────────
FROM deps AS build
COPY src/ ./src/
COPY tsconfig.json ./
RUN npx tsc

# ── Stage 3: Production runtime ──────────────────────────────────
FROM node:20-alpine AS runtime

RUN addgroup -g 1001 mirth && \
    adduser -u 1001 -G mirth -s /bin/sh -D mirth

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts/fix-xslt-processor.js ./scripts/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist/

# Kitchen-sink validation directories (used by File connector scenarios)
RUN mkdir -p /tmp/mirth-ks/input \
             /tmp/mirth-ks/output \
             /tmp/mirth-ks/audit \
             /tmp/mirth-ks/chain-trace \
             /tmp/mirth-ks/response-output && \
    chown -R mirth:mirth /tmp/mirth-ks /app

USER mirth

EXPOSE 8080

ENV PORT=8080 \
    LOG_FORMAT=json \
    NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/health/live || exit 1

STOPSIGNAL SIGTERM

CMD ["node", "--import", "./dist/instrumentation.js", "dist/index.js"]
