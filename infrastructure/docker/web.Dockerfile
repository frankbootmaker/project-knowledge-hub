# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.12.4 --activate
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

FROM base AS build
# Internal Docker DNS name for API (bake into Next rewrites). Rebuild if service name changes.
ARG API_URL=http://api:3101
ENV API_URL=$API_URL
ENV NODE_ENV=development
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc ./
COPY apps ./apps
COPY packages ./packages
COPY turbo.json tsconfig.base.json ./
RUN pnpm install --frozen-lockfile || pnpm install
ENV NODE_ENV=production
RUN pnpm exec turbo run build --filter=@project-knowledge-hub/web...

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV WEB_PORT=3100
ENV PORT=3100
ENV HOSTNAME=0.0.0.0
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
