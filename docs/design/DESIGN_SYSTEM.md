# Design system

Project Knowledge Hub UI is token-driven. Change a parameter once in tokens; pages and
components pick it up through Tailwind theme utilities and shared CSS recipes.

**Any UI adjustment must be recorded here** (tokens, recipes, primitives, or UX conventions).
Do not ship page-only styling without updating this document.

## Source of truth

| Layer | Location | Role |
|-------|----------|------|
| Tokens | `apps/web/src/styles/tokens.css` | Colors, radii, control sizes, toast timing, z-index (light + dark) |
| Theme bridge | `apps/web/src/app/globals.css` `@theme` | Maps `--kh-*` → Tailwind utilities (`bg-brand`, `text-ink`, …) |
| Recipes | `globals.css` `@layer components` | Shared `.kh-*` class recipes |
| Primitives | `apps/web/src/components/ui/*` | React wrappers — use these in pages |
| Shell helpers | `apps/web/src/components/shell.ts` | Shared shell class constants |
| Agent rule | `.cursor/rules/design-system.mdc` | Enforces tokens/primitives + this doc on UI work |

**Do not** hardcode hex colors (e.g. `#0f161d`) or copy long `inline-flex rounded-md border…`
class strings into pages. Prefer tokens and primitives.

## When you change the UI

Before considering UI work done:

1. Prefer an existing token / recipe / primitive.
2. If none fits: add a `--kh-*` token and/or `.kh-*` recipe, then a `components/ui` primitive.
3. **Update this file** in the same change (tables below + [Changelog](#changelog)).
4. Prefer `pushToast()` for success/failure of create/save/delete flows (see Feedback).
5. Prefer shell/layout primitives for responsive structure (see [Responsive](#responsive)).

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
| `--kh-z-modal` | Modal dialogs (below toasts, above mobile nav) |
| `--kh-z-mobile-nav` | Mobile nav overlay (below toasts, above sticky header) |

Dark mode flips the same `--kh-*` variables under `.dark` on `<html>`.

## Responsive

Expand this system for narrow viewports — do **not** invent a parallel mobile design system.
Breakpoints stay Tailwind defaults unless a product need forces a custom set.

| Concern | Convention |
|---------|------------|
| Breakpoints | `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px |
| Viewport | Root layout exports `viewport: { width: 'device-width', initialScale: 1 }` |
| Shell padding / width | `.kh-shell` / `shellClassName` — `max-w-6xl` + `px-4 sm:px-6` |
| Shell content | `.kh-shell` + `.kh-shell-content` / `shellContentClassName` — adds `py-8` |
| Primary nav | Desktop: inline `NavLink`s from `sm` up. Below `sm`: `MobileNav` disclosure (never hide nav without a mobile path) |
| Admin sidebar | Stacks above content below `lg` via `lg:grid-cols-[220px_1fr]` in `admin/layout.tsx`. Compact horizontal rail is a later enhancement |
| Grids | Prefer `grid-cols-1 sm:grid-cols-2 …`. Avoid fixed `grid-cols-[Npx_1fr]` without a mobile fallback |
| Touch targets | Prefer existing control tokens / header control squares; keep interactive chrome ≥ ~40px |
| Overflow | Code/JSON in `overflow-x-auto`; never rely on page-wide horizontal scroll |

### Layout shells

| Shell | Pattern |
|-------|---------|
| App header | Sticky bar; brand + desktop nav + `MobileNav` (`sm:hidden` toggle) + theme/locale/session |
| App / status content | `shellContentClassName` |
| Admin | Single column until `lg`, then sidebar + main; sidebar uses `NavLink tone="sidebar"` |

## Recipes (`.kh-*`)

| Recipe | Role |
|--------|------|
| `.kh-input` / `.kh-label` | Form controls |
| `.kh-panel` / `.kh-panel-solid` / `.kh-panel-inset` | Surfaces |
| `.kh-muted` | Secondary text |
| `.kh-btn` + `.kh-btn-{primary,secondary,ghost,success,danger}` | Buttons / link-buttons |
| `.kh-nav-link` / `.kh-nav-link-active` | Header nav |
| `.kh-sidebar-link` / `.kh-sidebar-link-active` | Admin sidebar / mobile nav links |
| `.kh-step` / `.kh-step-active` / `.kh-step-done` | Wizard step chips |
| `.kh-page-num` / `.kh-page-num-active` | Pagination digits |
| `.kh-text-link` | Inline text links |
| `.kh-toast-viewport` / `.kh-toast` / `.kh-toast-{success,danger,info}` / `.kh-toast-dismiss` | Toasts |
| `.kh-shell` / `.kh-shell-content` | Max-width shell + content vertical padding |
| `.kh-mobile-nav` / `.kh-mobile-nav-backdrop` / `.kh-mobile-nav-panel` | Mobile primary nav overlay |
| `.kh-modal` / `.kh-modal-backdrop` / `.kh-modal-panel` (+ `-lg`) / `.kh-modal-header` / `.kh-modal-title` / `.kh-modal-description` / `.kh-modal-body` / `.kh-modal-footer` | Modal dialogs |

## Primitives

| Component | Use when |
|-----------|----------|
| `Button` | Native `<button>` actions |
| `LinkButton` | Navigation that should look like a button |
| `NavLink` | Header or admin sidebar links (active state included) |
| `MobileNav` | Primary nav below `sm` (sheet + backdrop; Esc / route change closes) |
| `Modal` | Focused create/edit flows; Esc + backdrop close; optional `footer` actions; `size="lg"` for denser forms |
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
| Reachable nav | Primary destinations must be available at phone widths via `MobileNav` or equivalent |
| Admin create | Prefer `Modal` for adding users, organizations, memberships, API clients — list stays primary; open via a top-right create button |

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
* Hiding primary nav with `hidden sm:flex` (or similar) **without** a `MobileNav` / disclosed equivalent
* Page-only breakpoint one-offs that belong in `Page`, shell helpers, or layout primitives
* Relying on page-wide horizontal scroll instead of stacking / `overflow-x-auto` on code blocks
* Always-visible admin create forms that crowd the list — prefer `Modal` + create CTA

## Changelog

Record durable UI / design-system changes here (newest first).

### 2026-07-19

* **Admin create modals** — `Modal` primitive (`.kh-modal*`, `--kh-z-modal`). Organizations, users, memberships, and API clients open create flows in dialogs; lists are the default view. Branch exploration: `function/modals`.
* **Responsive** — Documented breakpoints, shell recipes (`.kh-shell*`), admin stack-at-`lg`, and anti-patterns. Explicit root `viewport`. `MobileNav` + `--kh-z-mobile-nav` for primary nav below `sm`. Shell helpers in `shell.ts` used by app/status layouts and header.
* **Header theme icons** — Sun/moon glyph size reduced ~5% (`themeIconClassName` → `1.556rem`).
* **Toasts** — `ToastProvider` / `useToast`, recipes `.kh-toast*`, tokens `--kh-toast-duration-ms` / `--kh-z-toast`. Used for admin CRUD and LLM wizard confirmations.
* **List ordering** — Organizations, users, memberships, API clients: newest `createdAt` first.
* **Admin Organizations** — `/admin/organizations` for name/slug create, edit, and delete. Delete offers transfer (default; auto-target if only one other org) or permanent destroy of inherited items. Destroy requires a two-step warning plus acknowledgement checkbox before `confirmDestroy`. Last org cannot be deleted.
* **Destructive actions** — Prefer `Button variant="danger"` plus an explicit confirm step (inset panel), not bare `window.confirm` alone. Cascade/wipe paths need a second confirmation gate.
* **LLM client schemas** — Wizard configure step picks target client; schema export uses shared MCP schema builders.
* **Design system foundation** — `tokens.css`, button/nav/panel/step/page-num recipes, `LinkButton` / `NavLink` / `Panel` variants.
