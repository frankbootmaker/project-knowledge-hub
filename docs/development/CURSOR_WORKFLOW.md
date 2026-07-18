# Cursor Workflow

## Rules for agents

* Work on **one milestone at a time**.
* Read architecture docs and ADRs before changing structure.
* Present a short plan before large edits.
* Avoid unrelated refactors.
* Use strict TypeScript; never introduce `any`.
* Validate external input with Zod.
* Keep route handlers thin; put logic in packages.
* Never invent fake operational integrations.
* Never expose secrets in logs, commits, or docs examples.
* Use Compose project name `knowledge-hub-dev`.
* Never run `docker compose down -v`, `docker system prune`, or `docker volume prune` unless explicitly instructed.
* Never modify `/home/frankbootmaker/containers` or existing Open WebUI / Ollama / ComfyUI stacks.
* Stop at the end of the requested milestone.
* Update `docs/CHANGELOG.md` and `docs/MILESTONE_TRACKING.md` when delivering milestone work.

## Definition of done

See PRD section 20. A milestone is not complete while lint, typecheck, tests, build, or Docker validation fail.
