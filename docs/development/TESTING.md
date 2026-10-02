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

GitHub Actions workflow `.github/workflows/ci.yml` runs on every pull request and on pushes to `master` and `feature/new-design`. There is no `main` branch. Concurrency is grouped by ref; a new commit on an open pull request cancels the previous run for that ref. Pushes to `master` and `feature/new-design` are left to finish.

The job installs Node.js 24 and pnpm, starts Postgres (`pgvector/pgvector:pg16`) and Redis (`redis:7-alpine`) service containers, then runs:

1. install
2. lint
3. typecheck
4. test
5. build

Service containers publish to `localhost:5432` and `localhost:6379`. The workflow does not use host `psql`, `jq`, Postgres, or Redis.

### Where jobs run

Each job sets:

```yaml
runs-on: ${{ fromJSON(vars.CI_RUNS_ON || '"ubuntu-latest"') }}
```

`CI_RUNS_ON` is a repository **variable** (Settings → Secrets and variables → Actions → Variables), not a secret. Its value must be JSON that `fromJSON` can turn into a `runs-on` value.

Self-hosted Strix Halo runner:

```json
["self-hosted","linux","x64","strix-halo","knowhub"]
```

That runner is an ephemeral `myoung34/github-runner` (ubuntu-noble) container with its own Docker daemon. Docker and Actions service containers are available and reachable on localhost. Node, pnpm, Postgres, and Redis are **not** preinstalled; the workflow installs Node and pnpm and uses the service containers above.

If `CI_RUNS_ON` is unset or empty, jobs fall back to the GitHub-hosted runner `ubuntu-latest`.

`SESSION_SECRET` in the workflow is a dummy test value (at least 32 characters), not a production secret. Turborepo strict mode only passes environment variables listed on the `test` task in `turbo.json`, including `SESSION_SECRET`, `DATABASE_URL`, and `REDIS_URL`.
