# Database Migrations

## Stack

* Drizzle ORM
* Drizzle Kit
* SQL migrations under `packages/database/src/migrations`

## Commands

From repository root:

```bash
pnpm db:generate   # create SQL from schema changes
pnpm db:migrate    # apply migrations using DATABASE_URL
pnpm db:studio     # optional Drizzle Studio
```

## Rules

* Prefer additive migrations.
* Do not edit applied migration files; create a new migration instead.
* Keep timestamps in UTC.
* Milestone 0 includes organization, workspace, user, membership, project, and system only.
