# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.12.4 --activate
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/domain/package.json packages/domain/
COPY packages/observability/package.json packages/observability/
COPY packages/auth/package.json packages/auth/
COPY packages/permissions/package.json packages/permissions/
RUN pnpm install --frozen-lockfile || pnpm install

FROM deps AS build
COPY . .
RUN pnpm --filter @project-knowledge-hub/config build \
  && pnpm --filter @project-knowledge-hub/domain build \
  && pnpm --filter @project-knowledge-hub/observability build \
  && pnpm --filter @project-knowledge-hub/auth build \
  && pnpm --filter @project-knowledge-hub/permissions build \
  && pnpm --filter @project-knowledge-hub/database build \
  && pnpm --filter @project-knowledge-hub/api build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN useradd --system --uid 1001 knowledgehub
COPY --from=build /app /app
USER knowledgehub
EXPOSE 3101
CMD ["node", "apps/api/dist/index.js"]
