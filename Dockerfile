# =============================================================================
# Stage 1: Dependencies
# Install all npm dependencies including devDependencies needed for
# native module compilation (better-sqlite3).
# =============================================================================
FROM node:22-alpine AS deps

# Build tools required by better-sqlite3 native addon
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy only package files for dependency caching
COPY package.json package-lock.json* ./

# Install all deps (including devDeps) so native modules compile
RUN npm install

# =============================================================================
# Stage 2: Builder
# Build the Next.js application using the full dependency tree.
# =============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source files (package.json needed so runner can COPY it)
COPY package.json tsconfig.json next.config.ts postcss.config.mjs ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# Build the Next.js application.
# next build eagerly imports @/db which initializes SQLite + runs migrations.
# To prevent race conditions during parallel page-data collection, pre-create
# the DB with __drizzle_migrations fully populated so migrate() is a no-op.
ENV DB_FILE_NAME=/tmp/build-journal.db
RUN rm -f /tmp/build-journal.db /tmp/build-journal.db-wal /tmp/build-journal.db-shm \
    && node scripts/prepopulate-migrations.cjs \
    && npx next build \
    && rm -f /tmp/build-journal.db /tmp/build-journal.db-wal /tmp/build-journal.db-shm

# =============================================================================
# Stage 3: Runner
# Minimal production image with only runtime dependencies.
# =============================================================================
FROM node:22-alpine AS runner

# Create non-root user (UID 1001) as specified in the plan
RUN addgroup --system --gid 1001 nextjs && \
    adduser --system --uid 1001 --ingroup nextjs nextjs

# Install curl for healthcheck and runtime deps for better-sqlite3
RUN apk add --no-cache curl

WORKDIR /app

# Create the runtime data directory with correct ownership
RUN mkdir -p /data && chown nextjs:nextjs /data

# Copy production node_modules from deps stage, then prune dev deps
# and remove non-essential cruft (test fixtures, type defs, etc.). `npm prune`
# creates a platform-reduced lockfile that Next attempts to patch at startup;
# the compiled runner does not need it, so remove it before switching users.
RUN --mount=type=bind,from=deps,source=/app,target=/deps \
    cp -R /deps/node_modules ./node_modules && \
    npm prune --omit=dev && \
    rm -f package-lock.json && \
    rm -rf node_modules/.cache node_modules/.package-lock.json && \
    # Remove TypeScript type definitions bundles (recreated at build time)
    rm -rf node_modules/@types/react node_modules/@types/react-dom && \
    # Remove test/dev-only packages that prune might have missed
    rm -rf node_modules/vitest node_modules/@vitest node_modules/eslint && \
    rm -rf node_modules/typescript node_modules/playwright node_modules/@playwright

# Copy built application from builder stage
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./
# Copy package.json from deps stage (builder may not have it cached)
COPY --from=deps /app/package.json ./

# Copy migration files (needed at runtime by drizzle auto-migration)
COPY --from=builder /app/src/db/migrations ./src/db/migrations

# Copy schema file (needed by drizzle at import time)
COPY --from=builder /app/src/db ./src/db

# Ensure uploads directory exists and is writable by the non-root user
RUN mkdir -p public/uploads/trades && chown -R nextjs:nextjs public/uploads

# Switch to non-root user
USER nextjs

# Expose the application port
EXPOSE 3000

# Healthcheck verifies the app is responding via the /api/health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -fs http://localhost:3000/api/health || exit 1

# Start the Next.js production server
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV DB_FILE_NAME=/data/journal.db

CMD ["node", "node_modules/next/dist/bin/next", "start"]
