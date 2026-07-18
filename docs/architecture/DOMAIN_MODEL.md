# Domain Model

## Core entities (Milestone 0 schema)

### Organization

Top-level ownership boundary. First deployments may use a single organization row.

### Workspace

Logical grouping of knowledge (for example Home Infrastructure).

### User

Local identity foundation. Password hashing and sessions arrive in Milestone 1.

### Membership

Links a user to a workspace with a role (`system_admin`, `workspace_admin`, `maintainer`, `reader`, `mcp_client`).

### Project

Development or business initiative within a workspace.

### System

Deployed or designed technical solution. May exist independently of a project.

## Later entities (not in Milestone 0 schema)

* Knowledge record / version / source
* Tags / relationships
* API clients
* Audit events
* Repository documents (Git sync)

See `DATA_MODEL.md` and the PRD for field-level detail.
