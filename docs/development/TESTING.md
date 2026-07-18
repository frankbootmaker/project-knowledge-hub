# Testing

## Tools

* Vitest for unit and API integration tests
* Playwright reserved for later browser e2e (`tests/e2e`)

## Running tests

```bash
pnpm test
```

Integration tests for `/health` and `/ready` live in `apps/api` and require:

```text
DATABASE_URL
REDIS_URL
```

If those variables are absent, integration cases are skipped; the unit `/health` test still runs.

## CI

GitHub Actions workflow `.github/workflows/ci.yml` starts Postgres and Redis service containers and runs:

1. install
2. lint
3. typecheck
4. test
5. build
