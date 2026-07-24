# Milestone 1 — Implementation Plan

**Status:** Complete (validated)  
**Date:** 2026-07-19  
**Scope:** Identity and workspace foundation only  
**PRD reference:** Milestone 1 in `docs/product/PRD.md`

---

## Objective

Allow secure local administration and workspace organization.

## Deliverables

1. Bootstrap administrator (seeded from env; password hashed).
2. Email/password login and logout.
3. HTTP-only session cookies with expiration.
4. Role authorization (`system_admin`, `workspace_admin`, `maintainer`, `reader`, `mcp_client`).
5. Default organization seed.
6. Workspace CRUD API + basic web UI.
7. Application shell and protected routes.
8. Audit events for login/logout and workspace mutations.

## Out of scope

* Projects/systems product APIs (Milestone 2)
* Knowledge records, search, MCP, OIDC/OAuth
* Git sync, embeddings

## Technical approach

* Extend schema with `sessions` and `audit_events`; add `users.is_system_admin`.
* Implement `@project-knowledge-hub/auth` (scrypt password hashing, session tokens).
* Implement `@project-knowledge-hub/permissions` (role capability checks).
* Fastify routes under `/api/v1` with cookie sessions + Origin CSRF checks.
* Next.js login + dashboard/workspaces UI; middleware protects app routes.
* Seed via `pnpm db:seed`.

## Completion criteria

* Unauthenticated users cannot access protected pages.
* Administrator can create a workspace.
* Reader cannot administer a workspace.
* Sessions expire correctly.
* Passwords are not stored in plaintext.
* lint / typecheck / test / build pass.
