# @project-knowledge-hub/search

Full-text search ranking helpers and snippet extraction for Milestone 5.

PostgreSQL provides `tsvector` / `ts_rank`; this package applies lifecycle and title boosts and builds result excerpts.

## API

```ts
import { combineSearchScore, buildSnippet } from '@project-knowledge-hub/search';
```
