# OIDC sign-in with Authentik — integration guide

**Status:** Staging smoke succeeded (KnowHub Dev ↔ `https://auth-dev.in3.technology`, 2026-08-03).  
**Project:** Project Knowledge Hub  
**Backlog:** NF-017 (OIDC / Authentik first); related NF-012 (Entra reuses same path), NF-007 (Azure Blob — separate).  
**Repo brief:** `docs/product/OIDC_IDP.md`  
**Related hub record:** Authentik Homelab Deployment Blueprint (`authentik-homelab-deployment-blueprint`)

This guide explains how human SSO into KnowHub works, how to configure Authentik, how users are linked, and what is explicitly out of scope.

---

## 1. What this gives you

KnowHub can authenticate users through a standard **OpenID Connect** provider (Authentik first) while keeping **local email/password** login.

After a successful SSO:

* KnowHub creates a normal browser session (`kh_session` cookie) — same as password login.
* The user is mapped via `users.idp_source` + `users.idp_subject`.
* Workspace membership and roles remain KnowHub-managed (no Authentik group → role mapping in v1).

### What this does **not** do

| Topic | Why |
| --- | --- |
| Azure Blob / AWS storage credentials | Cloud object auth is NF-007 / existing S3 keys — not human SSO |
| ChatGPT MCP App OAuth | Separate backlog NF-004 |
| Auto-create users on first SSO | Optional via Admin → SSO JIT toggle or `OIDC_JIT_PROVISIONING=true` (default off = invite/link) |
| Multiple OIDC issuers in one UI | Single configured issuer per deployment |

Authentik *can* broker Entra/AWS IAM Identity Center for **people login**. That still does not wire Azure Blob or S3 by itself.

---

## 2. Login flow (happy path)

```text
User opens /login
  → (optional) SSO button if OIDC is configured (Admin → SSO and/or env)
  → GET /api/v1/auth/oidc/start
  → Redirect to Authentik authorize (PKCE + state in Redis)
  → User signs in at Authentik
  → GET /api/v1/auth/oidc/callback?code&state
  → KnowHub exchanges code, reads claims / userinfo
  → Resolve, link, or (if JIT enabled) create KnowHub user
  → Create session + Set-Cookie
  → Redirect to /dashboard
```

Public API surfaces:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/auth/oidc/status` | `{ enabled, buttonLabel }` for the login page |
| `GET /api/v1/auth/oidc/start` | Begin authorization |
| `GET /api/v1/auth/oidc/callback` | Finish login |

The **redirect URI must use `WEB_URL`** (web origin), e.g. `https://knowhub-dev.in3.technology/api/v1/auth/oidc/callback`, so the session cookie is set on the app host. Next.js rewrites `/api/v1/*` to the API.

---

## 3. User provisioning

SSO succeeds if one of these is true:

1. **Already linked:** a user exists with matching `(idp_source, idp_subject)` and status `active`.
2. **First-time email link:** an **active** user exists with the same email, IdP fields are empty, and the IdP asserts `email_verified=true` → KnowHub writes `idp_source` / `idp_subject` and continues.
3. **JIT (optional):** JIT on (Admin → SSO or `OIDC_JIT_PROVISIONING=true`), verified email, and no KnowHub user yet → create an **active** user with IdP fields set and **no memberships**. On-duty admins get an email; the user sees a waiting banner on the dashboard until assigned.

Otherwise the user is sent back to login with a query flag:

| Query | Meaning |
| --- | --- |
| `?sso=unknown` | No matching / linkable KnowHub account (also when email is present but `email_verified` is false, or JIT is off) |
| `?sso=inactive` | Account exists but is not `active` |
| `?sso=conflict` | Email already linked to a different IdP subject |
| `?sso=error` | OAuth/state/token failure |

### Operator checklist before first SSO

1. **Invite/link mode (default):** create or invite the user in KnowHub (Admin → Users) with the **same email** Authentik will assert; status **active** with workspace membership.
2. **JIT mode:** enable JIT in Admin → SSO (or `OIDC_JIT_PROVISIONING=true`); after first SSO, assign workspace/role in Admin → Users.
3. Optional: pre-fill **IdP source** / **IdP subject** in Admin → Users if you know Authentik’s `sub` (otherwise first successful SSO links by verified email).
4. Prefer setting `OIDC_IDP_SOURCE=authentik` so the stored source is stable and readable.
5. Ensure Authentik issues `email_verified: true` (see §5.1 — required on Authentik ≥ 2025.10).

---

## 4. Claim mapping

| Claim | Use in KnowHub |
| --- | --- |
| `sub` | Required → `idp_subject` |
| `email` | Required for email-link and JIT; stored/matched lower-case |
| `email_verified` | Must be **true** to link or JIT-create by email |
| `name` / `preferred_username` | Used as `displayName` on JIT create (else email local-part) |

Scopes requested: `openid email profile`.

---

## 5. Configure Authentik

1. In Authentik, create an **OIDC Provider** + **Application** for KnowHub.
2. Client type: **confidential**.
3. Grant type: **authorization code** with **PKCE**.
4. Redirect URI (exact):
   * Staging: `https://knowhub-dev.in3.technology/api/v1/auth/oidc/callback`
   * Local: `http://localhost:3100/api/v1/auth/oidc/callback`
5. Scopes: `openid`, `email`, `profile` (with the custom email mapping in §5.1).
6. Copy:
   * **Issuer URL** (e.g. `https://auth-dev.in3.technology/application/o/<slug>/`)
   * **Client ID**
   * **Client secret**

### 5.1 Required: custom `email` scope (`email_verified`)

From Authentik **2025.10** onward, the default OpenID `email` scope sets **`email_verified` to `false`** (Authentik no longer asserts verification by default).

KnowHub **refuses first-time email linking** unless `email_verified` is true. Symptom:

* Login returns `?sso=unknown`
* Audit `auth.oidc_rejected` with `reason: "unknown"` and a **non-null** `email`

**Fix (staging, verified 2026-08-03):**

1. **Customization → Property Mappings → Create → Scope Mapping**
   * Name: e.g. `KnowHub email (verified)`
   * **Scope name:** `email`
   * Expression:

```python
return {
    "email": request.user.email,
    "email_verified": True,
}
```

2. **Applications → Providers → (KnowHub)** → Advanced protocol settings  
   * **Remove** `authentik default OAuth Mapping: OpenID 'email'`  
   * **Add** `KnowHub email (verified)`  
   * Keep `openid` + `profile`

3. Sign out of Authentik, retry KnowHub SSO.

For stricter setups later, store verification in a user attribute and return that instead of hard-coding `True` (see Authentik docs: *Email scope verification*).

---

## 6. Configure KnowHub (Admin UI or env)

Prefer **Admin → SSO**: paste issuer, client id, and secret, optionally enable JIT, then Save. Changes apply on the next login without a rebuild or restart. “Reset to .env” removes the stored override.

`OIDC_*` env remains bootstrap/fallback (and is still required in `compose.dokploy.yaml` **and** the Dokploy **Compose service Environment** tab if you rely on env rather than the Admin page).

Set all three of issuer + client id + secret together (in Admin and/or env); otherwise SSO stays disabled.

```bash
OIDC_ISSUER=https://auth-dev.in3.technology/application/o/<slug>/
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
OIDC_BUTTON_LABEL=Sign in with Authentik
OIDC_IDP_SOURCE=authentik
# Optional: create active users on first verified-email SSO (default false)
# OIDC_JIT_PROVISIONING=true
# Optional override (default is {WEB_URL}/api/v1/auth/oidc/callback)
# OIDC_REDIRECT_URI=https://knowhub-dev.in3.technology/api/v1/auth/oidc/callback
```

Also ensure:

* `WEB_URL` is the public browser origin users use.
* Redis is available (PKCE `state` is stored with a short TTL).
* Redeploy after env / compose change if you are not using Admin → SSO.

References in repo: `.env.example`, `.env.dokploy.example`, `compose.dokploy.yaml`.

When configured, `GET /api/v1/auth/oidc/status` returns `"enabled": true` and `/login` shows the SSO button. Password login remains.

---

## 7. Smoke test

1. Confirm `GET /api/v1/auth/oidc/status` returns `{ "enabled": true, ... }`.
2. Open `/login` — SSO button visible.
3. Click SSO → Authentik login → return to KnowHub dashboard.
4. Confirm Admin → Users shows IdP source/subject on that account (after first link).
5. Sign out and SSO again — should match by subject without re-linking.
6. Negative checks:
   * Unknown email → `sso=unknown`
   * Pending/inactive user → `sso=inactive`
   * `email_verified` false → `sso=unknown` + audit email present (§5.1)

Audit actions: `auth.oidc_login`, `auth.oidc_link`, `auth.oidc_rejected`.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| No SSO button / `enabled: false` | Incomplete Admin SSO settings and/or `OIDC_*` not in container env | Save issuer + client id + secret in Admin → SSO, or add vars to Compose Environment and redeploy |
| Redirect URI mismatch | Authentik URI ≠ KnowHub callback | Align to `{WEB_URL}/api/v1/auth/oidc/callback` |
| Cookie missing / bounce to login | Callback hit API host instead of web | Use WEB_URL redirect; do not register API_URL-only callback |
| `sso=unknown`, audit **email null** | User not invited / email claim missing | Invite matching email; ensure `email` scope mapping |
| `sso=unknown`, audit **email present** | `email_verified` false (Authentik ≥ 2025.10 default) | Custom email scope mapping (§5.1) |
| `sso=inactive` | User not approved / wrong status | Approve + workspace membership |
| `sso=conflict` | Email already linked to another `sub` | Clear/correct IdP fields in Admin, or use the original IdP identity |
| `sso=error` | State expired, discovery/token failure | Retry quickly; check issuer URL, secrets, Redis, API logs |

---

## 9. Relation to Entra and cloud storage

* **NF-017 (this guide):** generic OIDC for human login; Authentik is the first issuer.
* **NF-012:** point the same env at Microsoft Entra, or federate Entra *through* Authentik for people SSO.
* **NF-007:** Azure Blob app credentials remain a separate workstream; Authentik login does not grant Blob access.

---

## 10. Follow-ups (not in v1)

* Authentik group → workspace role mapping.
* Multiple concurrent issuers in one deployment UI.
* Attribute-based `email_verified` instead of hard-coded `True` in the scope mapping.

---

## Related hub / repo docs

* Hub: Authentik Homelab Deployment Blueprint (`authentik-homelab-deployment-blueprint`).
* Feature Request List (Authentik IdP — staging smoke done).
* Repo: `docs/product/OIDC_IDP.md`, `docs/security/SECURITY_MODEL.md`, `docs/product/NEXT_FEATURES.md` (NF-017), `docs/deployment/DOKPLOY.md`.
