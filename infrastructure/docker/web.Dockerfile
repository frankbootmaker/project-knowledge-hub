# syntax=docker/dockerfile:1.7-labs

FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.12.4 --activate
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PNPM_STORE_DIR=/pnpm/store

FROM base AS build
# Dedicated build-arg name so Dokploy/Compose env API_URL=http://localhost:3101 cannot
# poison Next rewrites (that value means "API on this container", which is wrong).
ARG NEXT_REWRITE_API_ORIGIN=http://api:3101
ENV NEXT_REWRITE_API_ORIGIN=$NEXT_REWRITE_API_ORIGIN
ENV API_URL=$NEXT_REWRITE_API_ORIGIN
ENV NODE_ENV=development
# Manifests only — source changes must not bust the install layer.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc ./
COPY --parents apps/*/package.json packages/*/package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=shared \
  pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
COPY turbo.json tsconfig.base.json ./
ENV NODE_ENV=production
RUN --mount=type=cache,id=turbo-cache-web,target=/app/.turbo \
  case "$NEXT_REWRITE_API_ORIGIN" in \
      http://localhost:*|http://127.0.0.1:*) \
        echo "ERROR: NEXT_REWRITE_API_ORIGIN must be the Compose service URL (e.g. http://api:3101), not localhost: $NEXT_REWRITE_API_ORIGIN" >&2; \
        exit 1 ;; \
    esac \
  && pnpm exec turbo run build --filter=@project-knowledge-hub/web... --concurrency=1

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV WEB_PORT=3100
ENV PORT=3100
ENV HOSTNAME=0.0.0.0
# SSR fetches inside the web container should use Compose DNS, not localhost.
ENV API_URL=http://api:3101
RUN useradd --system --uid 1001 knowledgehub \
  && apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
USER knowledgehub
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=5s --start-period=35s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-3100}/" || exit 1
CMD ["node", "apps/web/server.js"]
