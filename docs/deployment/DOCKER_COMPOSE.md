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

* Postgres `127.0.0.1:5432`
* Redis `127.0.0.1:6379`

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
