# Design system

Project Knowledge Hub UI is token-driven. Change a parameter once in tokens; pages and
components pick it up through Tailwind theme utilities and shared CSS recipes.

## Source of truth

| Layer | Location | Role |
|-------|----------|------|
| Tokens | `apps/web/src/styles/tokens.css` | Colors, radii, control sizes (light + dark) |
| Theme bridge | `apps/web/src/app/globals.css` `@theme` | Maps `--kh-*` → Tailwind utilities (`bg-brand`, `text-ink`, …) |
| Recipes | `globals.css` `@layer components` | `.kh-btn*`, `.kh-panel*`, `.kh-nav-link*`, `.kh-step*`, `.kh-page-num*`, `.kh-text-link`, forms |
| Primitives | `apps/web/src/components/ui/*` | React wrappers — use these in pages |

**Do not** hardcode hex colors (e.g. `#0f161d`) or copy long `inline-flex rounded-md border…`
class strings into pages. Prefer tokens and primitives.

## Tokens (selected)

| Token | Tailwind / usage |
|-------|------------------|
| `--kh-brand` | `bg-brand`, `text-brand` |
| `--kh-on-brand` | `text-on-brand` (text on primary buttons) |
| `--kh-ink` / `--kh-ink-muted` | Body and secondary text |
| `--kh-panel` / `--kh-panel-solid` | Surfaces |
| `--kh-line` / `--kh-line-strong` | Borders |
| `--kh-accent*` / `--kh-warn*` / `--kh-danger*` | Status |
| `--kh-radius-*` | `rounded-sm/md/lg` |
| `--kh-control-height/width` | Switch and compact controls |
| `--kh-control-pad-x/y` | Button padding |

Dark mode flips the same `--kh-*` variables under `.dark` on `<html>`.

## Primitives

| Component | Use when |
|-----------|----------|
| `Button` | Native `<button>` actions |
| `LinkButton` | Navigation that should look like a button |
| `NavLink` | Header or admin sidebar links (active state included) |
| `Panel` | `default` / `solid` / `inset` surfaces |
| `Field`, `Input`, `Select`, `Textarea`, `ErrorText` | Forms |
| `Badge` | Compact status chips (e.g. health “ok”) |
| `Switch` | On/off toggles |
| `Page`, `PageHeader`, `SectionHeader`, `ListCard` | Page layout |

Shared button classes live in `buttonStyles.ts` and `.kh-btn*` recipes so Button and
LinkButton stay identical.

## Changing a parameter

1. Edit `apps/web/src/styles/tokens.css` (or a `.kh-*` recipe in `globals.css`).
2. Reload the app — no per-page updates needed if callers use utilities/primitives.
3. If you need a new pattern, add a recipe + primitive first, then use it in pages.

## Anti-patterns

* Duplicating Button styles on `<Link>` → use `LinkButton`
* One-off `rounded-md border border-line bg-panel-solid px-3 py-3` → `Panel variant="inset"`
* Raw hex for dark primary text → `text-on-brand` / `--kh-on-brand`
* New interactive chrome only as Tailwind soup in a page → extend `components/ui`
