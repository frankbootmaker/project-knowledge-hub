# ChatGPT and Codex MCP OAuth setup

**Status:** Implemented. The resource stays off until the signing key is set and an admin enables it.  
**Project:** Project Knowledge Hub  
**Backlog:** NF-004  
**Related:** `docs/architecture/MCP_ARCHITECTURE.md`, `docs/product/CHATGPT_CUSTOM_GPT_FAQ.md`, `docs/deployment/DOKPLOY.md`

This is the operator setup for the OAuth MCP resource. ChatGPT plugins and Codex connect here. Cursor, Claude, Antigravity, Copilot, and OpenWebUI stay on `/mcp` with a `kh_` bearer token.

Human SSO (Authentik or another OpenID Connect provider) only signs the person in for the consent page. It does not issue MCP tokens. There are no OAuth settings on **Admin → Identity → SSO**.

---

## 1. What you get

KnowHub is the OAuth 2.1 authorization server for one resource:

`https://<public-host>/mcp/oauth`

* Authorization code, PKCE S256, no client secret.
* ChatGPT client ids must start with an allowlisted HTTPS prefix. The default is `https://chatgpt.com/oauth/`.
* The default redirects are `https://chatgpt.com/connector_platform_oauth_redirect` and `http://127.0.0.1/callback`.
* Codex is a native client. It publishes `http://127.0.0.1/callback` and then calls back on an ephemeral port such as `http://127.0.0.1:62225/callback`. The port may change. Scheme, host, path, and query must match. Other redirects still match exactly.
* Access tokens are RS256 JWTs, about 15 minutes, with `aud` equal to that resource URL.
* Refresh tokens are opaque, rotated, and last about 30 days.
* A grant is created when a person consents. It is active immediately. There is no approval queue.

Bearer clients, Custom GPT Actions, and `/mcp` are unchanged.

---

## 2. Generate the signing key

On a trusted machine:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out oauth-mcp.pem
```

The file must be a PKCS#8 PEM (`-----BEGIN PRIVATE KEY-----`). Turn it into one line before pasting it into Dokploy or a single-line env store:

```bash
python3 -c 'print(open("oauth-mcp.pem").read().strip().replace("\n", "\\n"))'
```

Do not commit the PEM. Do not paste it into Admin settings. The API reads `OAUTH_JWT_PRIVATE_KEY` only. A value that contains the two characters `\` and `n` is accepted; the process turns those into real line breaks.

Leave the variable unset to keep the resource disabled.

---

## 3. Put the key where the API can see it

### Laptop

Add the PEM to `.env` as `OAUTH_JWT_PRIVATE_KEY`. A quoted multiline value is fine. Restart `pnpm run dev`. Local Compose loads `.env` through `env_file`, so no compose edit is required there.

ChatGPT cannot call `http://localhost:3100/mcp/oauth`. Use a public HTTPS origin for a real plugin.

### Dokploy

1. Deploy a compose file that contains this line in `x-app-env` (`compose.dokploy.yaml` on `feature/new-design` already does):

   ```yaml
   OAUTH_JWT_PRIVATE_KEY: ${OAUTH_JWT_PRIVATE_KEY:-}
   ```

   Dokploy only injects variables the compose file names. Setting the key in the UI before this line is deployed does not reach `nd-api`.

2. On the **Compose service → Environment** tab (not only the project-level Environment), add one line with no quotes and no real line breaks:

   ```text
   OAUTH_JWT_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----
   ```

3. Redeploy. `WEB_URL` must be the public HTTPS origin users type in the browser. Set `MCP_PUBLIC_URL` only when clients must use a different host than `WEB_URL`. The OAuth resource URL is that public MCP URL with `/mcp` replaced by `/mcp/oauth`.

---

## 4. Enable it in KnowHub

Open **Admin → MCP setup → OAuth**.

1. Confirm the card says the signing key is present and shows a fingerprint.
2. Confirm the metadata check succeeds. The published document is `/.well-known/oauth-protected-resource/mcp/oauth`. A JSON 404 on `/.well-known/oauth-protected-resource` is intentional, so bearer clients keep sending `kh_` tokens.
3. Leave the defaults unless you have another client:
   * Redirects: `https://chatgpt.com/connector_platform_oauth_redirect` and `http://127.0.0.1/callback`
   * Client-id prefix: `https://chatgpt.com/oauth/`
4. The scope ceiling starts as the read scopes plus `knowledge:write`, `pm:read`, and `pm:write`. Leave `monitoring:read` unchecked unless that exposure is intended. A trailing slash on a redirect or prefix matches that prefix.
5. Turn **Enabled** on and save.

The badge says **Live** only when the key parses and the switch is on. Copy the resource URL from the card.

---

## 5. Connect ChatGPT or Codex

In the ChatGPT plugin or Codex connector, paste the resource URL. There is no API key.

The person approving access signs in with their normal KnowHub account. They land on `/oauth/consent`, choose workspaces and scopes, and the grant is stored. Read scopes start checked. Write scopes start unchecked and require at least one workspace. A system administrator can include any active workspace in one organization, including workspaces where they have no membership. The grant stays limited to the workspaces and scopes they select. System users cannot consent.

After consent:

* **Admin → MCP setup → OAuth** lists grants. Revoke is the only action there.
* **Account → AI connections** lists that person's own grants.
* Closing the user revokes their grants and refresh tokens.
* Audit events use actor type `oauth_grant`.

---

## 6. Checks when it does not connect

| What you see | What to do |
| --- | --- |
| OAuth card says the signing key is missing | The API process does not have `OAUTH_JWT_PRIVATE_KEY`. On Dokploy, confirm the compose line is deployed, the value is one line on the Compose service Environment tab, and the stack was redeployed. |
| Key fingerprint is shown, badge stays off | Turn **Enabled** on and save. |
| ChatGPT cannot reach the URL | The resource URL must be public HTTPS. `localhost` and an internal `nd-api` hostname will not work. |
| Cursor or Claude drops its bearer token | Point those clients at `/mcp`, not `/mcp/oauth`. |
| A `kh_` token is rejected on `/mcp/oauth` | Expected. That URL accepts only OAuth access tokens. |
| A JWT is rejected on `/mcp` | Expected. `/mcp` stays bearer-only and does not send `WWW-Authenticate`. |
| Consent says the user must belong to a workspace | Write scopes need a non-empty workspace allowlist. Add a membership, or consent to read scopes only. |
