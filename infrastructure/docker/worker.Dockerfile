# syntax=docker/dockerfile:1.7-labs

FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.12.4 --activate
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PNPM_STORE_DIR=/pnpm/store

FROM base AS build
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
RUN --mount=type=cache,id=turbo-cache-worker,target=/app/.turbo \
  pnpm exec turbo run build --filter=@project-knowledge-hub/worker... --concurrency=1

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN useradd --system --uid 1001 knowledgehub
COPY --from=build /app /app
COPY infrastructure/docker/worker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
# Entrypoint chowns BACKUP_DIR then drops to knowledgehub (offsite stamp writes).
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "apps/worker/dist/index.js"]
