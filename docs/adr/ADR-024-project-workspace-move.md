# ADR-024: Move a project to another workspace

- **Status:** Accepted
- **Date:** 2026-09-30
- **Related:** [ADR-015](ADR-015-project-delivery-mcp.md), [ADR-019](ADR-019-human-readable-issue-keys.md)

## Context

A project is created inside one workspace. Operators need to move that project, including into a workspace owned by another organization, without minting a new project id or renumbering delivery keys.

## Decision

1. **One project row.** `POST /api/v1/projects/:projectId/move` and MCP `move_project` rewrite `workspace_id` on the project and on systems, knowledge records, search chunks, Git connections, and imports that belong to it. Delivery, RAID, change, and stakeholder rows follow `project_id` and are not rewritten.
2. **Maintainer on both workspaces.** The actor must administer the source and the destination. Memberships are not created. Assigned people who are not active members of the destination block the move.
3. **No automatic renames.** A colliding project, system, or knowledge slug, issue-key prefix, or Git repository connection blocks the move.
4. **Shared systems stay put.** A system whose `project_id` is this project but which is still referenced from outside the project blocks the move.
5. **Media.** Bytes live at `media/{workspaceId}/{mediaId}`. Media used only by the moving records moves with them. Media also used by a record that stays is duplicated, and the moving Markdown is rewritten.
6. **Same organization** keeps tag joins. **Another organization** copies tags by slug into the destination organization (reusing a slug that already exists there) and leaves the source tags in place. Historical audit rows are copied, not moved. The caller must send `confirmCrossOrganization` because Git tokens and conversation imports become readable by the destination organization's maintainers.
7. **MCP.** `pm:write` plus an acting user who maintains both workspaces. A same-organization destination must be on the client allowlist. A cross-organization destination cannot be, because allowlists stay inside one organization. After that move the client loses access. `dryRun` writes nothing.

## Consequences

* Project, issue, and document ids stay stable, so links and human keys survive the move.
* API clients are not re-scoped. A client in the source organization must be replaced by one in the destination organization after a cross-organization move.
* Doc Factory style packs stay with their organization. Later exports use the destination organization's packs.
