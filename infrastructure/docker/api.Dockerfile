# syntax=docker/dockerfile:1.7-labs

FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.12.4 --activate
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PNPM_STORE_DIR=/pnpm/store

FROM base AS build
# Keep install in non-production so TypeScript/tsx/dev tooling remain available.
ENV NODE_ENV=development
# Use system Chromium in the runtime image — skip Puppeteer's download during build.
ENV PUPPETEER_SKIP_DOWNLOAD=true
# Manifests only — source changes must not bust the install layer.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc ./
COPY --parents apps/*/package.json packages/*/package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=shared \
  pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
COPY turbo.json tsconfig.base.json ./
ENV NODE_ENV=production
# Limit parallel package compiles — three images (api/web/worker) already build at once.
# Turbo local cache persists across rebuilds when the BuildKit cache volume is kept.
RUN --mount=type=cache,id=turbo-cache-api,target=/app/.turbo \
  pnpm exec turbo run build --filter=@project-knowledge-hub/api... --concurrency=1

# Heavy apt packages (Chromium + pg client) change rarely — keep ahead of app COPY.
FROM node:24-bookworm-slim AS runtime-apt
WORKDIR /app
RUN useradd --system --uid 1001 --create-home --home-dir /home/knowledgehub knowledgehub \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/keyrings/postgresql-archive-keyring.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/postgresql-archive-keyring.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    curl \
    postgresql-client-16 \
    # Chromium runtime libs for Puppeteer (knowledge record PDF export)
    chromium \
    fonts-liberation \
    fonts-noto-core \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/* \
  && ln -sf /usr/bin/chromium /usr/bin/chromium-browser || true

FROM runtime-apt AS runtime
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# Writable paths for Chromium when the process runs as knowledgehub (not root).
ENV HOME=/home/knowledgehub
ENV XDG_CONFIG_HOME=/tmp/.chromium
ENV XDG_CACHE_HOME=/tmp/.chromium
COPY --from=build /app /app
COPY infrastructure/docker/api-entrypoint.sh /entrypoint.sh
COPY infrastructure/docker/migrate-and-seed.sh /migrate-and-seed.sh
RUN chmod +x /entrypoint.sh /migrate-and-seed.sh
# Entrypoint runs as root briefly to chown BACKUP_DIR, then drops to knowledgehub.
# Migrate one-shot overrides entrypoint to /migrate-and-seed.sh (see compose.dokploy.yaml).
EXPOSE 3101
HEALTHCHECK --interval=15s --timeout=5s --start-period=25s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${API_PORT:-3101}/health" || exit 1
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "apps/api/dist/index.js"]
