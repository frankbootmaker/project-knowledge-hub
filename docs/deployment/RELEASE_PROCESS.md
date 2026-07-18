# Release Process

## Branching

* `main` — release branch
* `feature/*`, `fix/*` — short-lived work branches

## Flow

```text
feature branch → local validation → PR → CI → merge main → version tag → Dokploy staging → production
```

## Version tags

```text
v0.1.0
v0.2.0
v1.0.0
```

## CI gates

GitHub Actions must pass install, lint, typecheck, test, and build before merge.

Production deploy (Milestone 7+) should use an immutable tag, not a floating branch tip.
