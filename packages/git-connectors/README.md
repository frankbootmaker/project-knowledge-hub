# @project-knowledge-hub/git-connectors

Git provider adapters and repository → knowledge-record sync (Milestone 8).

* GitHub tree/blob fetch + webhook signature verification
* Include/exclude path globs and default folder → `recordType` / tag mappings
* `syncGitRepositoryConnection` upserts `git_managed` records and archives removed paths
