# Release Process

## Branching

* `master` — integration / release branch
* `feature/*`, `fix/*` — short-lived work branches

## Flow (current)

```text
feature branch → local validation → PR → CI → merge master
  → version tag (optional)
  → Dokploy Dev/UAT deploy (M7)
  → migrate → smoke validate
  → Prod Dokploy (later; not this slice)
```

## Version tags

```text
v0.1.0
v0.2.0
v1.0.0
```

Prefer immutable tags for Dokploy image builds once registry automation exists. Until then, Dokploy may build from a known commit on `master` or a release tag.

## CI gates

GitHub Actions must pass install, lint, typecheck, test, and build before merge.

## Dokploy Dev/UAT deploy

1. Tag or pin the commit to deploy.
2. Build images from `infrastructure/docker/{api,web,worker}.Dockerfile` (web build arg `API_URL=http://api:3101` unless the API service name differs).
3. Deploy with [`compose.dokploy.yaml`](../../compose.dokploy.yaml) (or Dokploy equivalent).
4. Ensure the **migrate** one-shot completes before api/worker serve traffic.
5. Set runtime secrets (`WEB_URL`, `DATABASE_URL`, `SESSION_SECRET`, …) — see [`DOKPLOY.md`](DOKPLOY.md).
6. Run the smoke checklist in `DOKPLOY.md`.
7. Optional: `seed.sh` for the first bootstrap admin.

## Production

Production Dokploy environment and immutable registry CI are **deferred** after Dev/UAT validation (HTTPS, MCP, persistence, backup/restore drill).
