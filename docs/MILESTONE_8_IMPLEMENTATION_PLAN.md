# Milestone 8 — Implementation Plan

**Status:** Complete  

**Date:** 2026-07-19  
**Scope:** GitHub Markdown synchronization into knowledge records  
**PRD reference:** Milestone 8 / ADR-001, ADR-007, ADR-010

## Deliverables

* `git_repository_connections` + `git_sync_runs` tables
* `@project-knowledge-hub/git-connectors` — GitHub tree/blob fetch, path globs, default folder→type mappings, sync upsert
* `@project-knowledge-hub/jobs` — BullMQ `git-sync` queue
* Worker consumer for webhook-triggered sync + daily safety sweep
* API: connection CRUD, Sync now (inline), sync history, GitHub webhook (`/api/v1/git/webhooks/github`)
* Workspace UI: `/workspaces/{slug}/git` + sync-health badges
* Git-managed records are read-only in hub API/UI

## Defaults

* Include: `docs/**/*.md`, `README.md`, `**/ADR-*.md`
* Path map: ADR→decision, deployment→deployment-guide, product→overview/roadmap, etc.
* Synced records: `sourceOfTruthMode=git_managed`, `lifecycleStatus=verified`, provenance `sourceType=git`
* Unchanged blob SHA → skip; removed paths → soft-archive
* Safety re-sync: every 24h while worker is up (`GIT_SYNC_SAFETY_INTERVAL_MS`; `0` disables)

## Operator flow

1. Workspace admin opens **Git sync**
2. Connect `owner/repo` + PAT + optional project + webhook secret
3. **Sync now** (or GitHub push webhook with secret)
4. Records appear under the workspace/project; edit in git and re-sync
5. Keep the **worker** running for webhooks and the daily safety re-sync
