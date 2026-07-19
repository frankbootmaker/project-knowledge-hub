# Project Knowledge Hub

## Initial Product Requirements and Development Plan

**Document status:** Initial implementation specification
**Version:** 0.1
**Primary development environment:** Strix Halo Ubuntu Server
**Primary deployment target:** Dokploy
**Development method:** AI-assisted development with Cursor
**Working repository name:** `project-knowledge-hub`

---

# 1. Product Summary

Project Knowledge Hub is a self-hosted technical documentation and knowledge-management platform.

It centralizes information from:

* Software project repositories.
* Markdown documentation.
* Infrastructure deployments.
* LLM-assisted implementation sessions.
* Troubleshooting conversations.
* Final working system configurations.
* Architecture decisions.
* Operational runbooks.
* Installation and recovery procedures.
* Project status and progress documentation.

The platform provides:

1. A wiki-style web interface for humans.
2. Full-text and later semantic search.
3. Structured organization by project, system and knowledge record.
4. Source and verification metadata.
5. Read-only MCP access for Cursor and other AI agents.
6. Git synchronization in a later implementation milestone.
7. Deployment through Docker Compose and Dokploy.

The platform should become a central discovery layer for technical knowledge without forcing every document to belong to a Git repository.

---

# 2. Product Problem

Technical knowledge is currently distributed across:

* GitHub repositories.
* `/docs` folders.
* README files.
* ChatGPT conversations.
* Other LLM conversations.
* Personal notes.
* Deployment terminals.
* Support tickets.
* Configuration files.
* Project-management systems.

This creates several problems:

* Valuable implementation knowledge remains trapped in conversations.
* Final working configurations are difficult to identify among failed attempts.
* Users need to remember where documentation is stored.
* AI coding agents often see only the current repository.
* Knowledge from previous projects is not easily reusable.
* Documentation freshness and validity are unclear.
* Obsolete commands may be mistaken for current procedures.
* Infrastructure documentation often has no natural Git repository.
* Multiple projects may solve similar problems without sharing knowledge.

---

# 3. Product Vision

Create a unified technical knowledge platform where humans and authorized AI agents can reliably discover:

* What projects and systems exist.
* How systems are designed.
* How systems were deployed.
* What their current working configuration is.
* Which information has been verified.
* What changed over time.
* Which troubleshooting approaches succeeded or failed.
* How a system can be rebuilt or recovered.
* Where the original information came from.

The platform should preserve provenance and clearly distinguish:

* Current verified knowledge.
* Draft or AI-generated information.
* Historical records.
* Deprecated information.
* Raw conversation material.

---

# 4. Core Product Principles

## 4.1 Multiple sources of truth

The platform must support different content-management modes.

### Git-managed

The document is synchronized from a Git repository. Git remains authoritative.

### Hub-managed

The document is created and maintained directly in the platform.

### Imported snapshot

The document was imported from another system but is not automatically synchronized.

### AI-generated draft

The content was generated from an LLM conversation and requires human review.

### External authoritative source

The platform indexes the content while another system remains authoritative.

Every record must display its source-of-truth mode.

## 4.2 Verification is explicit

AI-generated content must never automatically become authoritative.

Knowledge records use lifecycle statuses such as:

```text
draft
review_required
verified
current
superseded
deprecated
archived
```

## 4.3 Provenance is mandatory

Every knowledge item should identify, where applicable:

* Source type.
* Source provider.
* Source reference.
* Creation date.
* Import date.
* Author.
* AI model used.
* Reviewer.
* Verification date.
* Last validation date.

## 4.4 Human and AI access are equal product priorities

The same knowledge should be available through:

* A human-readable web interface.
* A REST API.
* A controlled MCP interface.

## 4.5 Start with a modular monolith

The first version must not use microservices.

The API, worker and web frontend may run as separate processes, but they belong to one repository and share domain packages.

---

# 5. Primary Entities

## 5.1 Organization

Top-level ownership boundary.

The first deployment may use only one organization, but the database should retain an organization model.

## 5.2 Workspace

Logical grouping of knowledge.

Examples:

* Bootmaker Products.
* Home Infrastructure.
* AI Experiments.
* Customer Projects.
* Archived Systems.

## 5.3 Project

A development, implementation or business initiative.

Examples:

* Visualizer.
* Docs-as-Code.
* FreeResend Fork.
* Project Knowledge Hub.

A project may have:

* Repositories.
* Systems.
* Knowledge records.
* Owners.
* Tags.
* Status.
* Relationships to other projects.

## 5.4 System

A deployed or designed technical solution.

Examples:

* Tailscale–Headscale Bridge.
* Strix Halo AI Server.
* Open WebUI Stack.
* Proxmox Cluster.
* Visualizer DEV Environment.

A system does not have to belong to a formal project.

## 5.5 Repository Document

A document synchronized from a Git repository.

This entity will be implemented after the first MVP.

## 5.6 Knowledge Record

A hub-managed technical document.

Examples:

* Architecture overview.
* Deployment guide.
* Final working configuration.
* Troubleshooting resolution.
* Backup procedure.
* Recovery runbook.
* LLM conversation summary.
* Decision record.
* Migration procedure.

## 5.7 Knowledge Record Version

An immutable historical version of a knowledge record.

## 5.8 Knowledge Source

Describes where a record came from.

Possible source types:

```text
manual
git
llm-conversation
chat-export
command-session
ticket
email
uploaded-document
api
system-discovery
other
```

## 5.9 Relationship

A typed connection between entities.

Examples:

```text
depends_on
integrates_with
deployed_on
replaces
provides_service_to
documented_by
related_to
supersedes
owned_by
```

---

# 6. Knowledge Record Types

Initial supported record types:

```text
overview
architecture
deployment-guide
installation-guide
configuration
configuration-snapshot
runbook
troubleshooting
incident-resolution
migration-guide
decision
lessons-learned
command-reference
inventory
status
roadmap
recovery-guide
backup-guide
security-note
integration-guide
conversation-summary
research-note
proposal
business-idea
vision
plan
initiative
note
other
```

Record types should initially be stored as validated strings but should remain extensible. Planning ledger types (`business-idea`, `vision`, `plan`, `initiative`, `note`) support using the hub across ideas, delivery, operations, and future goals. MCP clients discover the catalog via `list_record_metadata`.

---

# 7. Initial Technology Stack

## Runtime and language

* Node.js 24 LTS.
* TypeScript in strict mode.
* pnpm workspaces.
* Turborepo.

## Frontend

* Next.js.
* React.
* App Router.
* Tailwind CSS.
* Accessible reusable component library.
* `react-markdown`.
* Unified/Remark/Rehype ecosystem.
* Shiki for syntax highlighting.
* Mermaid for diagrams.
* CodeMirror or a Markdown textarea for editing.

## Backend

* Fastify.
* Zod.
* OpenAPI.
* Pino structured logging.
* Typed domain services.
* Central error handling.

## Database

* PostgreSQL.
* pgvector extension available but not initially mandatory.
* Drizzle ORM.
* PostgreSQL full-text search.
* JSONB for flexible metadata.

## Jobs and caching

* Redis.
* BullMQ.
* Separate worker process.

## MCP

* Official stable MCP TypeScript SDK.
* Streamable HTTP.
* Bearer API tokens.
* Read-only tools.

## Testing

* Vitest.
* Testcontainers or isolated Docker test database for integration testing.
* Playwright for browser tests.
* ESLint.
* Prettier.
* TypeScript compiler checks.

## Deployment

* Docker.
* Docker Compose.
* Dokploy.
* Dokploy-managed domains and HTTPS.
* GitHub Actions for continuous integration.

---

# 8. Repository Structure

```text
project-knowledge-hub/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker/
│
├── packages/
│   ├── config/
│   ├── database/
│   ├── domain/
│   ├── auth/
│   ├── permissions/
│   ├── api-contracts/
│   ├── knowledge/
│   ├── markdown/
│   ├── search/
│   ├── mcp/
│   ├── jobs/
│   ├── git-connectors/
│   ├── conversation-import/
│   ├── embeddings/
│   ├── observability/
│   └── ui/
│
├── docs/
│   ├── product/
│   ├── architecture/
│   ├── adr/
│   ├── development/
│   ├── deployment/
│   └── security/
│
├── infrastructure/
│   ├── docker/
│   ├── compose/
│   └── scripts/
│
├── tests/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
│
├── compose.yaml
├── compose.production.yaml
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
├── .env.example
└── README.md
```

---

# 9. Development Environment

## Source location

```text
/home/frankbootmaker/projects/project-knowledge-hub
```

## Compose project name

```text
knowledge-hub-dev
```

All development Compose commands should explicitly use this name:

```bash
docker compose -p knowledge-hub-dev up -d
```

This reduces the chance of container, network and volume collisions with existing Strix Halo services.

## Development execution model

During normal development:

```text
PostgreSQL: Docker
Redis: Docker
Web: pnpm development process
API: pnpm development process
Worker: pnpm development process
```

Command:

```bash
docker compose -p knowledge-hub-dev up -d postgres redis
pnpm install
pnpm dev
```

For production-style validation:

```bash
docker compose \
  -p knowledge-hub-dev \
  -f compose.yaml \
  -f compose.production.yaml \
  up --build
```

## Suggested development ports

```text
Web: 3100
API: 3101
PostgreSQL: bound to localhost only
Redis: bound to localhost only
```

Existing services must not be modified or joined unless explicitly required.

---

# 10. MVP Definition

The initial MVP should allow a user to:

1. Log in with a local administrator account.
2. Create a workspace.
3. Create a project.
4. Create a system.
5. Create a Markdown knowledge record.
6. Associate the record with a project or system.
7. Set its type and lifecycle status.
8. Record its source and provenance.
9. Render the Markdown safely.
10. edit the record while retaining version history.
11. Search record titles, headings and content.
12. Create an MCP API client.
13. Connect Cursor to the MCP endpoint.
14. List accessible projects and systems.
15. Search current and verified knowledge.
16. Retrieve a knowledge record with provenance metadata.

The first MVP does not need GitHub synchronization.

---

# 11. MVP Functional Requirements

## 11.1 Authentication

Initial implementation:

* Local bootstrap administrator.
* Email and password login.
* Secure password hashing.
* Secure HTTP-only session cookie.
* Logout.
* Session expiration.
* API-client bearer tokens for MCP.
* Tokens stored only as hashes.
* Token creation shows the plaintext token once.

Later:

* OIDC.
* Microsoft Entra ID.
* GitHub OAuth.
* Keycloak or Authentik.

## 11.2 Roles

Initial roles:

```text
system_admin
workspace_admin
maintainer
reader
mcp_client
```

## 11.3 Workspaces

Authorized users can:

* Create a workspace.
* View a workspace.
* Edit its name and description.
* Archive it.
* List its projects and systems.

## 11.4 Projects

Project fields:

```text
name
slug
summary
description
status
owner
tags
business_domain
criticality
external_links
created_at
updated_at
archived_at
```

Project statuses:

```text
idea
planned
active
maintenance
paused
completed
archived
```

## 11.5 Systems

System fields:

```text
name
slug
summary
description
system_type
status
owner
environment
version
criticality
last_validated_at
metadata
created_at
updated_at
archived_at
```

System statuses:

```text
proposed
experimental
active
degraded
maintenance
deprecated
retired
archived
```

## 11.6 Knowledge records

Required fields:

```text
title
slug
summary
record_type
lifecycle_status
source_of_truth_mode
content_markdown
workspace_id
project_id optional
system_id optional
created_by
created_at
updated_at
```

Optional fields:

```text
language
tags
source_provider
source_reference
source_title
source_created_at
generated_by_model
reviewed_by
verified_at
last_validated_at
metadata
```

## 11.7 Knowledge editing

The editor should initially provide:

* Title.
* Summary.
* Record type.
* Status.
* Project association.
* System association.
* Markdown source editor.
* Rendered preview.
* Provenance fields.
* Save draft.
* Mark for review.
* Mark verified.
* Mark current.

Only authorized maintainers may mark a record as verified or current.

## 11.8 Version history

Every successful content update creates a version containing:

```text
version_number
content_markdown
title
summary
record_type
status
metadata_snapshot
created_by
created_at
change_message optional
```

Previous versions should be viewable but not editable.

Restoring a historical version should create a new current version rather than deleting history.

## 11.9 Current and superseded records

Where a record represents a current system configuration:

* Only one record in the same logical configuration series should be current.
* Marking a replacement as current should mark the previous record as superseded.
* The old record must remain searchable only when historical records are included.
* MCP should prefer the current record.

## 11.10 Markdown rendering

Support:

* Headings.
* Paragraphs.
* Lists.
* Task lists.
* Tables.
* Code blocks.
* Syntax highlighting.
* Blockquotes.
* Internal links.
* External links.
* Mermaid diagrams.
* YAML front matter display where appropriate.
* Table of contents.

Requirements:

* Raw HTML must be sanitized.
* JavaScript must never execute from imported Markdown.
* Dangerous URLs must be rejected.
* Mermaid rendering must use a safe configuration.

## 11.11 Search

Initial search uses PostgreSQL full-text search.

Search fields:

* Project name.
* System name.
* Record title.
* Summary.
* Headings.
* Markdown content.
* Tags.
* Record type.
* Source provider.

Filters:

* Workspace.
* Project.
* System.
* Record type.
* Lifecycle status.
* Source type.
* Updated date.
* Verified only.
* Current only.

Default AI retrieval should prefer:

1. Current records.
2. Verified records.
3. Review-required records.
4. Draft records only when explicitly requested.

Deprecated, superseded and archived records should be excluded by default.

## 11.12 MCP

Initial endpoint:

```text
POST /mcp
```

Initial tools:

```text
list_projects
list_systems
get_project
get_system
list_knowledge_records
search_knowledge
get_knowledge_record
get_record_provenance
```

### `search_knowledge`

Example input:

```json
{
  "query": "final Tailscale Headscale bridge configuration",
  "projectIds": [],
  "systemIds": [],
  "recordTypes": [
    "configuration",
    "deployment-guide"
  ],
  "statuses": [
    "current",
    "verified"
  ],
  "limit": 10
}
```

Every result must contain:

```text
record ID
title
summary
record type
lifecycle status
verification status
project
system
matching excerpt
source type
source provider
last updated date
last validation date
```

### `get_knowledge_record`

Must return:

* Record content.
* Status.
* Verification warning where applicable.
* Project and system context.
* Provenance.
* Current version.
* Last validation date.
* Superseded-by reference, if applicable.

MCP must be read-only in the MVP.

---

# 12. Initial Database Model

## organizations

```text
id
name
slug
created_at
updated_at
```

## workspaces

```text
id
organization_id
name
slug
description
created_at
updated_at
archived_at
```

## users

```text
id
email
display_name
password_hash
status
created_at
updated_at
```

## memberships

```text
id
user_id
workspace_id
role
created_at
```

## projects

```text
id
workspace_id
name
slug
summary
description
status
owner_user_id
business_domain
criticality
metadata_json
created_at
updated_at
archived_at
```

## systems

```text
id
workspace_id
project_id nullable
name
slug
summary
description
system_type
status
owner_user_id
environment
version
criticality
metadata_json
last_validated_at
created_at
updated_at
archived_at
```

## knowledge_records

```text
id
workspace_id
project_id nullable
system_id nullable
title
slug
summary
record_type
lifecycle_status
source_of_truth_mode
content_markdown
content_html_cache
language
metadata_json
current_version_number
supersedes_record_id nullable
created_by
reviewed_by nullable
verified_at nullable
last_validated_at nullable
created_at
updated_at
archived_at
```

## knowledge_record_versions

```text
id
knowledge_record_id
version_number
title
summary
record_type
lifecycle_status
content_markdown
metadata_json
change_message
created_by
created_at
```

## knowledge_sources

```text
id
knowledge_record_id
source_type
source_provider
source_reference
source_title
source_uri
source_created_at
generated_by_model
metadata_json
created_at
```

## tags

```text
id
organization_id
name
slug
created_at
```

## knowledge_record_tags

```text
knowledge_record_id
tag_id
```

## api_clients

```text
id
organization_id
name
description
token_hash
token_prefix
scopes
allowed_workspace_ids
allowed_project_ids
expires_at
last_used_at
revoked_at
created_at
```

## audit_events

```text
id
organization_id
actor_type
actor_id
action
entity_type
entity_id
metadata_json
ip_address
created_at
```

---

# 13. API Requirements

Base path:

```text
/api/v1
```

## Authentication

```text
POST /auth/login
POST /auth/logout
GET  /auth/session
```

## Workspaces

```text
GET    /workspaces
POST   /workspaces
GET    /workspaces/{workspaceId}
PATCH  /workspaces/{workspaceId}
DELETE /workspaces/{workspaceId}
```

## Projects

```text
GET    /projects
POST   /projects
GET    /projects/{projectId}
PATCH  /projects/{projectId}
DELETE /projects/{projectId}
```

## Systems

```text
GET    /systems
POST   /systems
GET    /systems/{systemId}
PATCH  /systems/{systemId}
DELETE /systems/{systemId}
```

## Knowledge records

```text
GET    /knowledge-records
POST   /knowledge-records
GET    /knowledge-records/{recordId}
PATCH  /knowledge-records/{recordId}
DELETE /knowledge-records/{recordId}

GET    /knowledge-records/{recordId}/versions
GET    /knowledge-records/{recordId}/versions/{versionNumber}
POST   /knowledge-records/{recordId}/restore/{versionNumber}
POST   /knowledge-records/{recordId}/verify
POST   /knowledge-records/{recordId}/mark-current
```

## Search

```text
POST /search
```

## API clients

```text
GET    /api-clients
POST   /api-clients
PATCH  /api-clients/{clientId}
DELETE /api-clients/{clientId}
POST   /api-clients/{clientId}/rotate
```

## Health

```text
GET /health
GET /ready
```

The readiness endpoint must verify PostgreSQL and Redis connectivity.

---

# 14. UI Sitemap

```text
/
├── login
├── dashboard
├── workspaces
│   └── [workspaceSlug]
├── projects
│   ├── new
│   └── [projectSlug]
│       ├── overview
│       ├── systems
│       ├── knowledge
│       ├── activity
│       └── settings
├── systems
│   ├── new
│   └── [systemSlug]
│       ├── overview
│       ├── configuration
│       ├── deployment
│       ├── troubleshooting
│       ├── recovery
│       ├── all-records
│       └── settings
├── knowledge
│   ├── new
│   └── [recordId]
│       ├── view
│       ├── edit
│       ├── history
│       └── provenance
├── search
├── account
│   ├── profile
│   └── api-clients
└── admin
    ├── users
    ├── workspaces
    ├── jobs
    └── audit
```

---

# 15. Security Requirements

The implementation must:

* Treat all Markdown as untrusted.
* Sanitize rendered HTML.
* Hash passwords using an appropriate modern password hashing algorithm.
* Hash API tokens.
* Show plaintext API tokens only once.
* Validate every request with Zod.
* Apply authorization before database content is returned.
* Prevent search from leaking inaccessible records.
* Validate pagination and result limits.
* Limit MCP response size.
* Rate-limit authentication and MCP endpoints.
* Use secure, HTTP-only cookies.
* Protect state-changing browser requests against CSRF.
* Avoid logging passwords, tokens or record contents unnecessarily.
* Store timestamps in UTC.
* Avoid exposing PostgreSQL or Redis publicly.
* Provide a secret-free `.env.example`.
* Add dependency scanning to CI.

The system should also warn users not to store:

* Passwords.
* Private keys.
* API tokens.
* Session cookies.
* Recovery codes.
* Unredacted credentials.

Automated secret detection will be implemented later, but the data model should support content warnings.

---

# 16. Development Milestones

Milestone **IDs** (M0–M10) stay stable for cross-references. **Execution order** after the localhost MVP (M0–M6) is intentionally: **M8 → M9 → M7 → M10**, so Dokploy packaging is last and staged Dev/UAT → Prod. See `docs/MILESTONE_TRACKING.md` and `docs/product/ROADMAP.md`.

# Milestone 0: Repository and platform foundation

## Objective

Create a stable, testable and containerized development foundation.

## Deliverables

* Monorepo.
* pnpm workspaces.
* Turborepo.
* Next.js application.
* Fastify application.
* Worker application.
* Shared configuration package.
* Shared database package.
* PostgreSQL.
* Redis.
* Docker Compose.
* Drizzle migrations.
* Pino logging.
* Central error handling.
* Health and readiness endpoints.
* ESLint.
* Prettier.
* Vitest.
* GitHub Actions.
* Root documentation.

## Completion criteria

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config
```

All commands complete successfully.

---

# Milestone 1: Identity and workspace foundation

## Objective

Allow secure local administration and workspace organization.

## Deliverables

* Bootstrap administrator.
* Login and logout.
* Session management.
* User entity.
* Membership entity.
* Role authorization.
* Organization seed.
* Workspace CRUD.
* Basic application shell.
* Protected routes.
* Audit events for login and workspace changes.

## Completion criteria

* Unauthenticated users cannot access protected pages.
* Administrator can create a workspace.
* Reader cannot administer a workspace.
* Sessions expire correctly.
* Passwords are not stored in plaintext.

---

# Milestone 2: Project and system catalogue

## Objective

Create the organizational foundation for knowledge.

## Deliverables

* Project CRUD.
* System CRUD.
* Project-to-system association.
* Status fields.
* Ownership.
* Tags.
* Archive behaviour.
* Project list.
* System list.
* Project page.
* System page.
* Permission tests.

## Completion criteria

* Systems may exist independently or belong to a project.
* Archived entities are excluded by default.
* Project and system slugs are unique within the correct scope.
* Unauthorized users cannot view restricted entities.

---

# Milestone 3: Knowledge records

## Objective

Create and maintain structured Markdown knowledge.

## Deliverables

* Knowledge-record CRUD.
* Record types.
* Lifecycle statuses.
* Source-of-truth modes.
* Project and system association.
* Provenance fields.
* Markdown editor.
* Safe Markdown preview.
* Document page.
* Table of contents.
* Code highlighting.
* Mermaid support.
* Audit events.

## Completion criteria

* A user can create a deployment guide.
* Markdown renders safely.
* Scripts embedded in Markdown cannot execute.
* A record can be linked to a system.
* Draft and verified statuses are visibly different.
* Source and verification metadata are displayed.

---

# Milestone 4: Versioning and lifecycle

## Objective

Make records maintainable and historically traceable.

## Deliverables

* Immutable version records.
* Version history page.
* Change message.
* Restore historical version.
* Verify record operation.
* Mark-current operation.
* Automatic superseding of previous current configuration.
* Historical status warnings.

## Completion criteria

* Updating a record creates a new version.
* Historical versions remain unchanged.
* Restoring creates a new version.
* Only authorized maintainers can verify records.
* Only one record in a configuration series can be current.
* Superseded records are clearly marked.

---

# Milestone 5: Search

## Objective

Make knowledge discoverable across projects and systems.

## Deliverables

* PostgreSQL full-text index.
* Search API.
* Search UI.
* Search snippets.
* Status filtering.
* Project filtering.
* System filtering.
* Record-type filtering.
* Verification filtering.
* Authorization-aware queries.
* Search relevance tests.

## Completion criteria

* Exact title matches rank highly.
* Current and verified content ranks above drafts.
* Deprecated content is excluded by default.
* Search never reveals unauthorized records.
* Search works without embeddings.

---

# Milestone 6: Read-only MCP

## Objective

Allow Cursor and other AI clients to retrieve verified technical knowledge.

## Deliverables

* API-client management.
* Hashed bearer tokens.
* MCP endpoint.
* Project and system discovery tools.
* Knowledge search.
* Knowledge retrieval.
* Provenance retrieval.
* Access scopes.
* Rate limiting.
* Response-size limits.
* MCP audit logging.
* Cursor configuration example.

## Completion criteria

Cursor can:

* Connect to the MCP endpoint.
* List accessible projects.
* List accessible systems.
* Search knowledge.
* Retrieve a current configuration.
* See verification and provenance metadata.

Cursor cannot:

* Create records.
* Modify records.
* Retrieve unauthorized records.
* Request unbounded content.

---

# Milestone 7: Production packaging and Dokploy deployment

> **Execution note:** Deferred until after M8 (and preferably M9). Localhost/dev remains the primary environment. Dokploy is introduced first as Dev/UAT, then Prod after testing — not as a gate before git sync.

## Objective

Deploy a stable release on Dokploy.

## Deliverables

* Production Dockerfiles.
* Production Compose configuration.
* Database migration command.
* Persistent volumes.
* Health checks.
* Dokploy environment documentation.
* Deployment variables.
* Backup script.
* Restore script.
* Release workflow.
* Staging deployment.
* Production deployment documentation.

## Completion criteria

* Clean Dokploy deployment succeeds.
* Application survives container restart.
* PostgreSQL data persists.
* Database backup and restore are tested.
* MCP works over HTTPS.
* Redis and PostgreSQL are not publicly exposed.
* A tagged release can be reproduced.

---

# Milestone 8: GitHub synchronization

## Objective

Import existing Markdown documentation from GitHub repositories.

## Deliverables

* Git-provider interface.
* GitHub implementation.
* Repository connection.
* Branch selection.
* Include and exclude paths.
* Initial synchronization.
* Incremental synchronization.
* Webhook validation.
* Sync job queue.
* Sync history.
* Git-managed document UI.
* Source commit and file metadata.

## Completion criteria

* Repository Markdown becomes searchable.
* Unchanged documents are not reprocessed.
* Modified documents are updated.
* Deleted documents leave active search.
* Source URL and commit are visible.
* Git-managed documents cannot be edited directly in the hub.

---

# Milestone 9: Conversation import

## Objective

Convert LLM outputs into structured draft knowledge records.

## First implementation

* Paste conversation text.
* Paste generated Markdown.
* Create conversation-import entity.
* Store raw import separately.
* Select text for conversion.
* Create one or more draft records manually.
* Preserve source reference.
* Exclude raw conversations from default MCP retrieval.

## Later implementation

* Automatic classification.
* LLM-assisted document splitting.
* Secret detection.
* Automatic metadata extraction.
* ChatGPT export importer.
* Open WebUI conversation importer.
* Generic JSON importer.

---

# Milestone 10: Semantic and hybrid search

## Objective

Improve retrieval across differently worded documentation.

## Deliverables

* pgvector.
* Embedding-provider interface.
* Disabled provider.
* Ollama provider.
* OpenAI-compatible provider.
* Chunk generation.
* Reindex jobs.
* Hybrid ranking.
* Embedding-model metadata.
* Controlled model migration.

Semantic search must remain optional.

---

# 17. Initial Architecture Decision Records

Create these before implementing product functionality:

```text
ADR-001 Git and hub-managed content sources
ADR-002 Modular monolith architecture
ADR-003 Separate API and worker processes
ADR-004 PostgreSQL as initial search platform
ADR-005 Read-only MCP for the MVP
ADR-006 Explicit verification lifecycle
ADR-007 Provenance required for knowledge records
ADR-008 Markdown as canonical record format
ADR-009 Authorization applied during retrieval
ADR-010 Synchronized and imported content is untrusted
ADR-011 Dokploy as initial deployment target
ADR-012 Strix Halo as development environment
```

Each ADR must contain:

```text
Title
Status
Context
Decision
Consequences
Alternatives considered
Date
```

---

# 18. Documentation Required in the Repository

```text
README.md

docs/product/
  PRODUCT_OVERVIEW.md
  PRD.md
  ROADMAP.md

docs/architecture/
  SYSTEM_ARCHITECTURE.md
  DOMAIN_MODEL.md
  DATA_MODEL.md
  AUTHORIZATION_MODEL.md
  MCP_ARCHITECTURE.md

docs/development/
  LOCAL_DEVELOPMENT.md
  TESTING.md
  DATABASE_MIGRATIONS.md
  CURSOR_WORKFLOW.md

docs/deployment/
  DOCKER_COMPOSE.md
  DOKPLOY.md
  RELEASE_PROCESS.md
  BACKUP_AND_RESTORE.md

docs/security/
  SECURITY_MODEL.md
  THREAT_MODEL.md
  SECRET_HANDLING.md

docs/adr/
  ADR-*.md
```

---

# 19. Branch and Release Strategy

Recommended branches:

```text
main
feature/*
fix/*
```

A permanent `develop` branch is optional and should not be introduced unless staging requires it.

Recommended workflow:

```text
feature branch
    ↓
local validation on Strix Halo
    ↓
pull request
    ↓
CI checks
    ↓
merge to main
    ↓
version tag
    ↓
Dokploy staging
    ↓
validation
    ↓
Dokploy production
```

Release tags:

```text
v0.1.0
v0.2.0
v1.0.0
```

Dokploy production should deploy an explicit release tag or immutable container-image tag.

---

# 20. Definition of Done

A task is complete only when:

* Implementation is finished.
* TypeScript compiles without errors.
* Relevant unit tests exist.
* Relevant integration tests exist.
* Authorization behaviour is tested.
* Linting passes.
* Production build passes.
* Database migration is included where required.
* Documentation is updated.
* No credentials are committed.
* Existing functionality is not broken.
* Docker validation passes where infrastructure changed.
* The AI agent reports commands it could not execute.
* No unfinished feature is presented as complete.

---

# 21. Cursor Development Rules

Cursor must:

* Work on only one milestone at a time.
* Review existing architecture documentation before changes.
* Create a plan before editing files.
* Avoid unrelated refactoring.
* Use strict TypeScript.
* Avoid `any`.
* Validate external input with Zod.
* Add authorization checks to every protected use case.
* Keep controllers thin.
* Keep domain logic outside route handlers.
* Use database transactions for multi-step state changes.
* Write tests before considering a feature complete.
* Never create fake placeholder integrations that appear operational.
* Never expose secrets.
* Never run global Docker cleanup commands.
* Use the Compose project name `knowledge-hub-dev`.
* Never run `docker compose down -v` unless specifically instructed.
* Never modify existing Open WebUI, Ollama or ComfyUI files.
* Never use ports already occupied by existing services.
* Update ADRs when architecture decisions change.
* Stop at the end of the requested milestone.

---

# 22. MVP Success Scenario

The MVP is successful when the following workflow works:

1. The administrator logs in.
2. A workspace named `Home Infrastructure` is created.
3. A system named `Tailscale–Headscale Bridge` is created.
4. A `Final Working Configuration` knowledge record is created.
5. The record contains sanitized Markdown documentation.
6. Its source is recorded as an LLM conversation.
7. Its status is initially `review_required`.
8. The user validates the content and marks it `current`.
9. A previous version remains visible in history.
10. A Cursor MCP client searches for the bridge configuration.
11. MCP returns the current verified record.
12. The response includes provenance and last-validation information.
13. Draft, superseded and deprecated records are not returned by default.

---

# 23. Features Explicitly Deferred

Do not implement these before the MVP works:

* Kubernetes.
* Microservices.
* OpenSearch.
* Elasticsearch.
* Neo4j.
* GraphQL.
* Dedicated vector database.
* Automatic ChatGPT account synchronization.
* Autonomous LLM-generated documentation.
* Write-capable MCP.
* OCR.
* PDF, DOCX or PPTX extraction.
* Browser extension.
* Collaborative editing.
* Real-time WebSockets.
* Automated production-system discovery.
* AI-generated compliance conclusions.
* Complex multitenancy.
* Billing.
* High availability.
