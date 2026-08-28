# OIDC sign-in (Authentik / generic IdP)

**Status:** v1 implemented — OIDC alongside local passwords; optional JIT provisioning. Env is bootstrap/fallback; **Admin → SSO** stores overrides in `platform_settings` (`oidc_config`) and they apply on the next login (no rebuild or restart).  
**Backlog:** **NF-017** (Authentik first); **NF-012** (Entra) reuses the same provider abstraction.  
**Operator guide:** [`OIDC_AUTHENTIK_INTEGRATION_GUIDE.md`](OIDC_AUTHENTIK_INTEGRATION_GUIDE.md)  
**Related:** [`SECURITY_MODEL.md`](../security/SECURITY_MODEL.md), Feature Request List (Authentik IdP).

## Goals

* Users can sign in through an external OIDC provider (Authentik first) and receive a normal KnowHub `kh_session` cookie.
* Map IdP identity to `users.idp_source` + `users.idp_subject`.
* Keep local email/password login available.
* Optional JIT: create an active user on first verified-email SSO (no memberships until an admin assigns workspace/role).

## Non-goals (v1)

* Multiple simultaneous OIDC issuers in one UI.
* Authentik group → workspace role mapping.
* Azure Blob / AWS IAM cloud credentials (NF-007) — human SSO is separate from storage auth.
* ChatGPT MCP OAuth (NF-004).

## Provisioning

SSO succeeds when:

1. An existing user matches `(idp_source, idp_subject)`, **or**
2. An **active** user exists with the same email, IdP fields are empty, and the IdP asserts `email_verified` → fields are linked on first login, **or**
3. **JIT on** (`OIDC_JIT_PROVISIONING=true` or Admin → SSO toggle), verified email, and no user yet → create an **active** user (no password, IdP fields set, zero memberships). On-duty admins (`signupPendingApproval` pref, else all system admins) get an email to assign workspace/role. The user lands on the dashboard waiting banner until assigned.

Default remains invite/link only (JIT off). Unknown emails (JIT off) and inactive users are rejected (`/login?sso=unknown` or `sso=inactive`).

Admins can still pre-set IdP fields on a user (Admin → Users) before first SSO.

## Claim mapping

| Claim | Use |
| --- | --- |
| `sub` | Required — stored as `idp_subject` |
| `email` | Required for email-link and JIT; normalized lower-case |
| `email_verified` | Must be true to link or JIT-create by email |
| `name` / `preferred_username` | Used as `displayName` on JIT create (else email local-part) |

`idp_source` defaults to env `OIDC_IDP_SOURCE` (`oidc`). Use a stable value per issuer (e.g. `authentik`, `entra`) if you run more than one over time.

## Config (Admin UI + env)

**Admin → SSO** writes JSON to `platform_settings` key `oidc_config` (issuer, client id, client secret, button label, IdP source, optional redirect URI, JIT toggle, enabled). The API **resolves config per request**: stored values override env; missing secret/fields fall back to `OIDC_*`. Delete / “Reset to .env” removes the override.

SSO is on when **enabled** and issuer + client id + secret are all present (from store and/or env).

| Variable | Required | Notes |
| --- | --- | --- |
| `OIDC_ISSUER` | yes* | Issuer URL (Authentik application issuer / well-known base) |
| `OIDC_CLIENT_ID` | yes* | Confidential client id |
| `OIDC_CLIENT_SECRET` | yes* | Client secret |
| `OIDC_BUTTON_LABEL` | no | Login button label (default `Sign in with SSO`) |
| `OIDC_IDP_SOURCE` | no | Stored in `users.idp_source` (default `oidc`) |
| `OIDC_REDIRECT_URI` | no | Defaults to `{WEB_URL}/api/v1/auth/oidc/callback` |
| `OIDC_JIT_PROVISIONING` | no | `true` / `false` (default `false`) — create active users on first verified-email SSO |

\* All three of issuer / client id / secret must be set together (in Admin and/or env); otherwise OIDC is disabled and the login button is hidden. Env remains valid bootstrap when the Admin override is absent.

## Endpoints

* `GET /api/v1/auth/oidc/status` — `{ enabled, buttonLabel }` (resolved from Admin override + env)
* `GET /api/v1/auth/oidc/start` — PKCE + state (Redis), redirect to IdP
* `GET /api/v1/auth/oidc/callback` — code exchange, resolve/link/JIT user, set session, redirect to dashboard
* `GET/PUT/DELETE /api/v1/admin/oidc-settings` — system admin; GET never returns the client secret (`hasClientSecret` + `source`)

Redirect URI must be registered on the IdP and must go through the **web** origin (`WEB_URL`) so the session cookie is set on the app host (Next.js rewrites `/api/v1/*` to the API).

## Authentik setup (checklist)

1. Create an OIDC provider + application in Authentik.
2. Client type: confidential; grant: authorization code + PKCE.
3. Redirect URI: `https://<knowhub-host>/api/v1/auth/oidc/callback` (or local `http://localhost:3100/api/v1/auth/oidc/callback`).
4. Scopes: `openid`, `email`, `profile`.
5. Paste issuer URL, client id, and secret into **Admin → SSO** (applies immediately) or into KnowHub `OIDC_*` env as fallback.
6. Either invite/create the KnowHub user first (invite/link), **or** enable JIT in Admin → SSO / `OIDC_JIT_PROVISIONING=true` and assign workspace/role after first SSO.

## Relation to Entra (NF-012) and Azure Blob (NF-007)

* **NF-017 / this brief** — generic OIDC for human login; Authentik can also *broker* Entra for people SSO.
* **NF-012** — may point the same env at Entra’s issuer, or add a second issuer later; same resolve/link + session path.
* **NF-007** — Azure Blob app credentials stay a separate workstream; signing in via Authentik does not grant Blob access.
