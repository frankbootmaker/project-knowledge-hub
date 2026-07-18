# Local Development

## Prerequisites

* Node.js 24 LTS
* pnpm 10.x (Corepack recommended)
* Docker + Docker Compose

On Strix Halo, Node may be installed via nvm:

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
node -v
pnpm -v
```

## Setup

```bash
cd /home/frankbootmaker/projects/project-knowledge-hub
cp .env.example .env
docker compose -p knowledge-hub-dev up -d postgres redis
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

After seeding, sign in at http://localhost:3100/login with the bootstrap admin credentials from `.env`.

## Ports

| Service | Binding |
| --- | --- |
| Web | `3100` |
| API | `3101` |
| PostgreSQL | `127.0.0.1:5432` |
| Redis | `127.0.0.1:6379` |

Browser calls to `/api/v1/*` are rewritten by Next.js to the API, so session cookies stay on the web origin.

## Compose project name

Always use:

```bash
docker compose -p knowledge-hub-dev ...
```

Never run destructive global Docker cleanup against this host. Do not modify `/home/frankbootmaker/containers`.

## Useful scripts

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:seed
./infrastructure/scripts/dev-up-infra.sh
```
