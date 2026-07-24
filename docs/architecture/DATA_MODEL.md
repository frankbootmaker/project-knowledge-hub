# Data Model

## Conventions

* UUID primary keys
* Timestamps stored in UTC (`timestamptz`)
* `created_at` / `updated_at` on mutable entities
* Validated text fields for statuses/roles (Zod in application layer)
* JSONB for flexible metadata where needed

## Milestone 0 tables

### `organizations`

`id`, `name`, `slug`, `created_at`, `updated_at`  
Unique: `slug`

### `workspaces`

`id`, `organization_id`, `name`, `slug`, `description`, `archived_at`, `created_at`, `updated_at`  
Unique: (`organization_id`, `slug`)

### `users`

`id`, `email`, `display_name`, `full_name`, `password_hash`, `status`, `is_system_admin`, `idp_source`, `idp_subject`, `avatar_content_type`, `created_at`, `updated_at`

* `full_name` — optional formal name; UI may fall back to `display_name`
* `idp_source` / `idp_subject` — reserved for future SSO (null for local password accounts); unique together when set
* `avatar_content_type` — set when a profile image exists in BlobStore (`avatars/{userId}`) or on disk (`AVATAR_UPLOAD_DIR/{userId}` when blobs disabled); UI uses a monogram when null
* `status` — `active` | `disabled` | `invited` | `pending_email` | `pending_approval` (self-signup: email confirm then admin approve)  
Unique: `email`

### `workspace_media`

`id`, `workspace_id`, `knowledge_record_id` (nullable), `content_type`, `byte_size`, `original_filename`, `alt_text`, `created_by`, `archived_at`, `created_at`

* Workspace image library (JPEG/PNG/WebP) for Markdown embeds; bytes in BlobStore `media/{workspaceId}/{mediaId}` or `MEDIA_UPLOAD_DIR`
* Optional `knowledge_record_id` link; embed URL `/api/v1/media/{id}` (workspace view required)

### `memberships`

`id`, `user_id`, `workspace_id`, `role`, `created_at`  
Unique: (`user_id`, `workspace_id`)

### `projects`

`id`, `workspace_id`, `name`, `slug`, `summary`, `description`, `status`, `owner_user_id`, `business_domain`, `criticality`, `metadata_json`, `archived_at`, `created_at`, `updated_at`  
Unique: (`workspace_id`, `slug`)

### `systems`

`id`, `workspace_id`, `project_id`, `name`, `slug`, `summary`, `description`, `system_type`, `status`, `owner_user_id`, `environment`, `version`, `criticality`, `metadata_json`, `last_validated_at`, `archived_at`, `created_at`, `updated_at`  
Unique: (`workspace_id`, `slug`)

## Migrations

Managed with Drizzle Kit under `packages/database`. See `docs/development/DATABASE_MIGRATIONS.md`.
