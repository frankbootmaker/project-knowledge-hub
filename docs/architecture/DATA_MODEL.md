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

`id`, `email`, `display_name`, `password_hash`, `status`, `created_at`, `updated_at`  
Unique: `email`

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
