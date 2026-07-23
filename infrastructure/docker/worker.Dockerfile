# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.12.4 --activate
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

FROM base AS build
ENV NODE_ENV=development
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc ./
COPY apps ./apps
COPY packages ./packages
COPY turbo.json tsconfig.base.json ./
RUN pnpm install --frozen-lockfile || pnpm install
ENV NODE_ENV=production
RUN pnpm exec turbo run build --filter=@project-knowledge-hub/worker... --concurrency=1

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
