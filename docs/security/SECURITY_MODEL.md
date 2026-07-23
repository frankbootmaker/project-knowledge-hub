# Security Model

## Milestone 0 posture

* No authentication UI yet (arrives in Milestone 1)
* Environment validated with Zod at process start
* Logs redact common secret fields
* Postgres/Redis bound to localhost in development Compose
* Markdown content will be treated as untrusted once records exist (ADR-010)

## Identity providers (stub)

* `users.idp_source` and `users.idp_subject` are reserved for future OIDC / Entra / GitHub / Keycloak login
* Local accounts keep both null and continue to use password / invite / reset flows
* No IdP login or token exchange is implemented in this phase
* **Planned:** Microsoft Entra ID as IdP (**NF-012**) unlocks Entra-auth **Azure Blob** on Admin → Storage (**NF-007**), not a separate storage product

## Auth email flows

* Password reset and invite links use one-time tokens stored as SHA-256 hashes (`auth_tokens`); raw tokens appear only in email URLs
* Reset TTL defaults to 1 hour; invite TTL defaults to 7 days (`AUTH_PASSWORD_RESET_TTL_SECONDS`, `AUTH_INVITE_TTL_SECONDS`)
* `POST /api/v1/auth/forgot-password` always returns a generic success response (no email enumeration); rate-limited per IP+email in-process
* `POST /api/v1/auth/register` creates `pending_email` (password set, no session), sends `email_confirm` link; rate-limited per IP+email
* `POST /api/v1/auth/confirm-email` moves `pending_email` → `pending_approval`
* `POST /api/v1/users/:id/approve` (system admin) requires ≥1 workspace membership, sets `active`, optional approval email
* `POST /api/v1/users/:id/reject` disables `pending_email` / `pending_approval` signups
* Passwords must be at least 8 characters with one uppercase letter and one non-letter character (digit or symbol); 12+ with those rules is treated as strong in the UI
* Admin invite flows remain available for provisioning without a password (`invited` → set-password → `active`)
* Outbound mail is pluggable (`MAIL_DRIVER=console|smtp|resend`); secrets (`SMTP_PASS`, `RESEND_API_KEY`) are redacted from logs

## Upcoming controls

* Password hashing, HTTP-only sessions, CSRF protection
* Hashed API bearer tokens for MCP
* Authorization checks before returning any record
* Shared/distributed rate limits on auth and MCP endpoints
* Dependency scanning in CI

## Operator guidance

Do not store passwords, private keys, API tokens, session cookies, or recovery codes in knowledge content.
