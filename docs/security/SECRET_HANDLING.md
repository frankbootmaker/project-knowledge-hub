# Secret Handling

## Rules

* Never commit real credentials.
* `.env` is gitignored; commit only `.env.example` with safe local placeholders.
* Do not log `DATABASE_URL`, `REDIS_URL`, passwords, tokens, or cookies.
* Rotate any credential that appears in chat logs or screenshots.

## Local defaults

Development Compose uses local-only credentials (`knowledge_hub` / `knowledge_hub`). These are **not** production secrets and must be replaced for any shared or internet-facing environment.

## Production

Provide secrets through Dokploy (or equivalent) environment configuration. Prefer distinct credentials per environment.
