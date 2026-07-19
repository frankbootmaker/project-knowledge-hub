# Design system

Project Knowledge Hub UI is token-driven. Change a parameter once in tokens; pages and
components pick it up through Tailwind theme utilities and shared CSS recipes.

**Any UI adjustment must be recorded here** (tokens, recipes, primitives, or UX conventions).
Do not ship page-only styling without updating this document.

## Source of truth

| Layer | Location | Role |
|-------|----------|------|
| Tokens | `apps/web/src/styles/tokens.css` | Colors, radii, control sizes, toast timing (light + dark) |
| Theme bridge | `apps/web/src/app/globals.css` `@theme` | Maps `--kh-*` → Tailwind utilities (`bg-brand`, `text-ink`, …) |
| Recipes | `globals.css` `@layer components` | Shared `.kh-*` class recipes |
| Primitives | `apps/web/src/components/ui/*` | React wrappers — use these in pages |
| Agent rule | `.cursor/rules/design-system.mdc` | Enforces tokens/primitives + this doc on UI work |

**Do not** hardcode hex colors (e.g. `#0f161d`) or copy long `inline-flex rounded-md border…`
class strings into pages. Prefer tokens and primitives.

## When you change the UI

Before considering UI work done:

1. Prefer an existing token / recipe / primitive.
2. If none fits: add a `--kh-*` token and/or `.kh-*` recipe, then a `components/ui` primitive.
3. **Update this file** in the same change (tables below + [Changelog](#changelog)).
4. Prefer `pushToast()` for success/failure of create/save/delete flows (see Feedback).

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
| `--kh-focus-ring` | Focus ring color mix |
| `--kh-toast-duration-ms` | Auto-dismiss duration for toasts (JS reads this via constant alignment) |
| `--kh-z-toast` | Toast stacking context |

Dark mode flips the same `--kh-*` variables under `.dark` on `<html>`.

## Recipes (`.kh-*`)

| Recipe | Role |
|--------|------|
| `.kh-input` / `.kh-label` | Form controls |
| `.kh-panel` / `.kh-panel-solid` / `.kh-panel-inset` | Surfaces |
| `.kh-muted` | Secondary text |
| `.kh-btn` + `.kh-btn-{primary,secondary,ghost,success,danger}` | Buttons / link-buttons |
| `.kh-nav-link` / `.kh-nav-link-active` | Header nav |
| `.kh-sidebar-link` / `.kh-sidebar-link-active` | Admin sidebar |
| `.kh-step` / `.kh-step-active` / `.kh-step-done` | Wizard step chips |
| `.kh-page-num` / `.kh-page-num-active` | Pagination digits |
| `.kh-text-link` | Inline text links |
| `.kh-toast-viewport` / `.kh-toast` / `.kh-toast-{success,danger,info}` / `.kh-toast-dismiss` | Toasts |

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
| `ToastProvider` / `useToast` | Global confirmations (`pushToast(message, tone?)`) |
| `Page`, `PageHeader`, `SectionHeader`, `ListCard` | Page layout |

Shared button classes live in `buttonStyles.ts` and `.kh-btn*` recipes so Button and
LinkButton stay identical.

`ToastProvider` is mounted in `apps/web/src/app/layout.tsx`. Call `const { pushToast } = useToast()`
from client components. Tones: `success` (default), `danger`, `info`.

## UX conventions

| Convention | Rule |
|------------|------|
| Newest first | Admin list APIs order by `createdAt` descending so newly created items appear at the top |
| Confirm actions | After create / save / delete / rotate / important wizard steps, call `pushToast` (success or danger) |
| i18n for toasts | Prefer `admin.toast*` message keys; do not hardcode English in components |
| No ad-hoc alerts | Do not invent parallel snackbars; extend `Toast` + recipes |

## Changing a parameter

1. Edit `apps/web/src/styles/tokens.css` (or a `.kh-*` recipe in `globals.css`).
2. Reload the app — no per-page updates needed if callers use utilities/primitives.
3. If you need a new pattern, add a recipe + primitive first, then use it in pages.
4. Record the change in [Changelog](#changelog).

## Anti-patterns

* Duplicating Button styles on `<Link>` → use `LinkButton`
* One-off `rounded-md border border-line bg-panel-solid px-3 py-3` → `Panel variant="inset"`
* Raw hex for dark primary text → `text-on-brand` / `--kh-on-brand`
* New interactive chrome only as Tailwind soup in a page → extend `components/ui`
* Custom success banners / `alert()` for CRUD → `useToast()`
* Shipping UI without updating this document

## Changelog

Record durable UI / design-system changes here (newest first).

### 2026-07-19

* **Toasts** — `ToastProvider` / `useToast`, recipes `.kh-toast*`, tokens `--kh-toast-duration-ms` / `--kh-z-toast`. Used for admin CRUD and LLM wizard confirmations.
* **List ordering** — Organizations, users, memberships, API clients: newest `createdAt` first.
* **Admin Organizations** — `/admin/organizations` for name/slug create, edit, and delete. Delete offers transfer (default; auto-target if only one other org) or permanent destroy of inherited items. Destroy requires a two-step warning plus acknowledgement checkbox before `confirmDestroy`. Last org cannot be deleted.
* **Destructive actions** — Prefer `Button variant="danger"` plus an explicit confirm step (inset panel), not bare `window.confirm` alone. Cascade/wipe paths need a second confirmation gate.
* **LLM client schemas** — Wizard configure step picks target client; schema export uses shared MCP schema builders.
* **Design system foundation** — `tokens.css`, button/nav/panel/step/page-num recipes, `LinkButton` / `NavLink` / `Panel` variants.
