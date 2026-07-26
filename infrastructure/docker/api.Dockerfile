# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.12.4 --activate
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

FROM base AS build
# Keep install in non-production so TypeScript/tsx/dev tooling remain available.
ENV NODE_ENV=development
# Use system Chromium in the runtime image — skip Puppeteer's download during build.
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc ./
COPY apps ./apps
COPY packages ./packages
COPY turbo.json tsconfig.base.json ./
RUN pnpm install --frozen-lockfile || pnpm install
ENV NODE_ENV=production
# Limit parallel package compiles — three images (api/web/worker) already build at once.
RUN pnpm exec turbo run build --filter=@project-knowledge-hub/api... --concurrency=1

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# Postgres is pg16 (pgvector image). Debian bookworm's default client is 15 and
# pg_dump refuses a major-version mismatch — install matching client from PGDG.
RUN useradd --system --uid 1001 knowledgehub \
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
