# Release Process

## Branching

* `master` — **stable** integration / release branch (promote only when Dev-proven)
* `feature/m7-dokploy` — **Dokploy Dev** integration branch for Milestone 7 work
* `feature/*`, `fix/*` — short-lived work branches (usually cut from `feature/m7-dokploy` during M7)

## Flow (current — M7)

```text
work on feature/m7-dokploy (or PR into it)
  → Dokploy Dev deploys from feature/m7-dokploy
  → migrate → smoke validate on Dev
  → when a slice is stable: PR feature/m7-dokploy → master
  → version tag (optional)
  → Prod Dokploy (later; not this slice)
```

Keep Dev pinned to `feature/m7-dokploy`. Do not point the Dev app at `master` while M7 is active unless you intentionally want only the last promoted stable slice.

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
