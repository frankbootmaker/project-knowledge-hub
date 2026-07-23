# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.12.4 --activate
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

FROM base AS build
# Keep install in non-production so TypeScript/tsx/dev tooling remain available.
ENV NODE_ENV=development
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
RUN useradd --system --uid 1001 knowledgehub \
  && apt-get update \
  && apt-get install -y --no-install-recommends curl postgresql-client \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
COPY infrastructure/docker/api-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
# Entrypoint runs as root briefly to chown BACKUP_DIR, then drops to knowledgehub.
EXPOSE 3101
HEALTHCHECK --interval=15s --timeout=5s --start-period=25s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${API_PORT:-3101}/health" || exit 1
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "apps/api/dist/index.js"]
