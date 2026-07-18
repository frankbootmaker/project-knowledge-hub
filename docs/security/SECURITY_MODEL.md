# Security Model

## Milestone 0 posture

* No authentication UI yet (arrives in Milestone 1)
* Environment validated with Zod at process start
* Logs redact common secret fields
* Postgres/Redis bound to localhost in development Compose
* Markdown content will be treated as untrusted once records exist (ADR-010)

## Upcoming controls

* Password hashing, HTTP-only sessions, CSRF protection
* Hashed API bearer tokens for MCP
* Authorization checks before returning any record
* Rate limits on auth and MCP endpoints
* Dependency scanning in CI

## Operator guidance

Do not store passwords, private keys, API tokens, session cookies, or recovery codes in knowledge content.
