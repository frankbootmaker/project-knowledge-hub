# Dokploy Deployment

**Status:** Planned (Milestone 7)

## Intent

Deploy Project Knowledge Hub to Dokploy using Docker images built from:

* `infrastructure/docker/web.Dockerfile`
* `infrastructure/docker/api.Dockerfile`
* `infrastructure/docker/worker.Dockerfile`

## Requirements (when implemented)

* Explicit release tag or immutable image tag
* Managed HTTPS domains
* Persistent volumes for PostgreSQL
* Health checks for API and web
* Secrets provided via Dokploy environment configuration (never committed)
* Redis and PostgreSQL not publicly exposed

Milestone 0 only prepares Dockerfiles and Compose overlays; production Dokploy cutover is deferred.
