# Docker Compose

## Project name

```bash
docker compose -p knowledge-hub-dev ...
```

## Development infrastructure

```bash
docker compose -p knowledge-hub-dev up -d postgres redis
```

Publishes:

* Postgres `127.0.0.1:5432` (`pgvector/pgvector:pg16` — includes the `vector` extension for Milestone 10)
* Redis `127.0.0.1:6379`

### Postgres image (pgvector)

Dev Compose uses `pgvector/pgvector:pg16` instead of stock `postgres:16-alpine`. After pulling the new image, run migrations so `CREATE EXTENSION vector` applies. Existing named volumes for major version 16 usually remain compatible; **do not** run `docker compose down -v` unless you intend to wipe the database.

## Full stack validation

```bash
docker compose \
  -p knowledge-hub-dev \
  -f compose.yaml \
  -f compose.production.yaml \
  --profile full \
  up --build
```

Services: `web`, `api`, `worker`, `postgres`, `redis`.

## Volumes and network

* `knowledge_hub_dev_postgres_data`
* `knowledge_hub_dev_redis_data`
* `knowledge_hub_dev_net`

## Safety

Do not run `docker compose down -v` unless explicitly instructed. Do not prune Docker system resources on this host as part of Knowledge Hub work.
