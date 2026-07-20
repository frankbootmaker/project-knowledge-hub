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
| Primary nav | Desktop: inline `NavLink`s from `md` up (Dashboard, Workspaces, Search, Archive, Admin?). Below `md`: `MobileNav` with the same destinations (never hide nav without a mobile path). Platform Status lives under Admin sidebar |
| Admin sidebar | Stacks above content below `lg` via `lg:grid-cols-[220px_1fr]` in `admin/layout.tsx`. Includes Overview … Audit, then **Status** (`/status`). Compact horizontal rail is a later enhancement |
| Account sidebar | Same grid pattern in `account/layout.tsx` for all signed-in users: **Profile**, **Sign-in identity**, **Change password**, **Email notifications**, **AI connections**, then a **Danger zone** divider with **Close account**. Header avatar still links to Profile |
| Grids | Prefer `grid-cols-1 sm:grid-cols-2 …`. Avoid fixed `grid-cols-[Npx_1fr]` without a mobile fallback |
| Touch targets | Prefer existing control tokens / header control squares; keep interactive chrome ≥ ~40px |
| Overflow | Code/JSON in `overflow-x-auto`; never rely on page-wide horizontal scroll |

### Layout shells

| Shell | Pattern |
|-------|---------|
| App header | Sticky bar; brand + desktop nav (`md+`) + `MobileNav` (`md:hidden` toggle) + theme/locale/session |
| App / status content | `shellContentClassName`. Status page: eyebrow + back link on one row; overall health `Badge` beside title; row values use `Badge` tones (no left accent bars) |
| Admin | Single column until `lg`, then sidebar + main; sidebar uses `NavLink tone="sidebar"` |
| Account | Same as Admin (`account/layout.tsx`) for Profile and AI connections |

## Recipes (`.kh-*`)

| Recipe | Role |
|--------|------|
| `.kh-input` / `.kh-label` | Form controls |
| `.kh-function-header` / `-controls` / `-actions` | List toolbar (search/filters + primary actions) |
| `.kh-panel` / `.kh-panel-solid` / `.kh-panel-inset` | Surfaces |
| `.kh-workspace-tile` + `.kh-workspace-color-*` | Workspace accent tiles (soft wash + hover; no left bar); palette keys from domain |
| `.kh-workspace-swatch` / `.kh-workspace-swatch-btn*` | Color picker swatches |
| `.kh-muted` | Secondary text |
| `.kh-btn` + `.kh-btn-{primary,secondary,ghost,success,danger}` | Buttons / link-buttons |
| `.kh-nav-link` / `.kh-nav-link-active` | Header nav |
| `.kh-sidebar-link` / `.kh-sidebar-link-active` | Admin sidebar / mobile nav links |
| `.kh-step` / `.kh-step-active` / `.kh-step-done` | Wizard step chips |
| `.kh-page-num` / `.kh-page-num-active` | Pagination digits |
| `.kh-text-link` | Inline text links |
| `.kh-toast-viewport` / `.kh-toast` / `.kh-toast-{success,danger,info}` / `.kh-toast-dismiss` | Toasts |
| `.kh-shell` / `.kh-shell-content` | Max-width shell + content vertical padding |
| `.kh-mobile-nav` / `.kh-mobile-nav-backdrop` / `.kh-mobile-nav-panel` / `.kh-mobile-nav-links` | Full-viewport mobile nav dropdown |
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
| `Field`, `Input`, `PasswordInput`, `PasswordStrengthHint`, `Select`, `Textarea`, `ErrorText` | Forms (`PasswordInput` show/hide; strength meter for new passwords) |
| `Badge` | Compact status chips (e.g. health “ok”) |
| `Switch` | On/off toggles |
| `ToastProvider` / `useToast` | Global confirmations (`pushToast(message, tone?)`) |
| `Page`, `PageHeader`, `SectionHeader`, `ListCard` | Page layout |
| `FunctionHeader` | List/admin toolbar: search + filters + primary actions on one row |

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
| Function header | Use `FunctionHeader` (`.kh-function-header*`) when a list needs search/filters on the same row as the primary create/action button |

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

### 2026-07-20

* **AI Connect** — Public `/ai-discover` (login-adjacent) plus authenticated `/account/ai-connections` (Account sidebar) for pairing codes and approve/revoke. Admin → API clients shows a pending AI requests section (same approve mental model as signup).
* **Function header** — `FunctionHeader` + `.kh-function-header*` for list toolbars (search/filters left, primary actions right). Admin → Users uses it for search, status filter, and Create user.
* **User remove / close account** — Admin removes a user from the Edit user modal (two-step inset confirm + acknowledgement). Account sidebar → Danger zone → Close account uses a double confirmation (warning step, then type `CLOSE` + checkbox). Soft-close keeps knowledge authorship; last system admin cannot be removed.
* **Status page** — Platform `/status` lives under Admin sidebar (not primary header nav). Eyebrow row shares space with **Back to Admin** (right). Overall health `Badge` beside the title; row values use colored `Badge`s (no left accent bars).
* **Workspace tiles** — Left accent bar removed from `.kh-workspace-tile`; soft color wash remains, with a stronger wash on hover. Horizontal `.kh-workspace-accent-bar` on workspace detail pages is unchanged.
* **Password strength** — `PasswordStrengthHint` under new-password fields (register, set-password, admin users). Shared policy: 8+ chars, one uppercase, one number/symbol = **Safe**; 12+ with those rules = **Strong**.
* **Password visibility** — Shared `PasswordInput` primitive with show/hide toggle on auth, admin user, mail secrets, and git token fields.
* **Signup approval** — Registration collects password, sends confirm-email, then Admin → Users shows pending queues; Approve requires ≥1 workspace membership. Public `/confirm-email` matches other auth pages.
* **Login branding** — Upper eyebrow shows **IN3 Technology**; product title remains Project Knowledge Hub. Registration sits opposite Forgot password and opens `/register`.
* **Account profile** — `/account/profile` for display name + full name (email read-only), optional photo upload, and `UserAvatar` monogram fallback. **Sign-in identity** and **Change password** are separate Account sidebar pages (`/account/identity`, `/account/password`; `POST /api/v1/me/password`). Account area uses the same left sidebar layout as Admin. Header shows avatar + display name linked to profile; mobile nav includes Profile.
* **Admin overview setup cards** — LLM/MCP and Email promo panels can be hidden per browser (`localStorage`); they remain in the admin sidebar. A small restore strip reappears when either card is hidden.
* **Admin Email** — Sidebar link `/admin/email` for SMTP / Resend / console mail settings, test send, and overview card on Admin home. Product emails use a shared branded HTML layout in `packages/mail` with en/de/hu catalogs; locale comes from `users.preferred_locale` (synced from the language switcher / login / register).
* **Auth pages** — Public `/forgot-password`, `/set-password`, `/register`, and `/confirm-email` match the login `Page narrow` + `Panel` pattern.
* **Admin users** — Create modal toggles invite-vs-password; list rows open Edit (display name, status, optional password, system admin) with Resend invite for `invited` users.

### 2026-07-19

* **Synchronizations hub** — `/workspaces/{slug}/git` lists configured sync connections (provider, health, last sync) with **Manage** per row and header **Add**. Add opens a provider catalog (GitHub, GitLab, Azure DevOps, Bitbucket, Forgejo) with per-provider owner/repo/token labels, optional or required instance **base URL**, and webhook path hint. Manage edits the same fields plus sync/history.
* **Synchronizations hub (earlier)** — List / Add / Manage shell; non-GitHub providers were previously “Coming soon” until sync backends shipped.
* **Modal focus** — `Modal` only runs initial focus / body-scroll lock when `open` flips true (not when `onClose` identity changes), so typing in modal fields does not steal focus each keystroke.
* **Workspace manage + status** — Workspace header shows a status `Badge` (Active / Archived / Needs attention) and a **Manage** button. A brief description (max 280 chars) can sit above the `.kh-workspace-accent-bar` overview line; edit it via Manage → Details. Needs attention links to Git sync. Manage modal also covers synchronizations, archived items, color, archive/restore.
* **Workspace colors** — Curated accent palette (`ocean`…`ink`) on workspace tiles (dashboard + list) via `.kh-workspace-tile` / `.kh-workspace-color-*` (soft wash + hover). Unset color uses a stable hash. Create form + Manage → color use `WorkspaceColorPicker`.
* **Git sync** — Workspace page link to `/workspaces/{slug}/git` for GitHub connections and Sync now. Connection cards show a sync-health `Badge` (healthy / sync needed / error, etc.) after a lightweight remote commit check. Git-managed records hide Edit / lifecycle actions; show View on GitHub when provenance URI exists.
* **Record type labels** — Knowledge editor select uses i18n `records.typeLabels.*` driven by the shared domain catalog (incl. planning ledger types).
* **Audit PDF export** — Admin Audit adds Export PDF beside CSV/JSON; same filter scope. PDF pages carry organization, project, filter details, and export timestamp in header/footer.
* **Archive UX** — Soft-archive via `ArchiveEntityButton` (confirm + restore). Header + mobile nav link to `/archived` (user restore hub); per-workspace `/workspaces/{slug}/archived`; Admin → Archive for platform ops. Inline header nav starts at `md` so Archive fits without crowding phones/small tablets.
* **Responsive nav** — Primary inline nav breakpoint raised `sm` → `md` after Archive was added; `MobileNav` (`<md`) is a frosted top sheet portaled to `document.body` (page remains faintly visible underneath).
* **User dashboard** — Workspace tiles (role + counts), search/admin jump tiles, and a recently-updated list. Interactive `kh-panel` links; `Page wide` for the grid.
* **Admin create modals** — `Modal` primitive (`.kh-modal*`, `--kh-z-modal`). Organizations, users, memberships, and API clients open create flows in dialogs; lists are the default view. Branch exploration: `function/modals`.
* **Responsive** — Documented breakpoints, shell recipes (`.kh-shell*`), admin stack-at-`lg`, and anti-patterns. Explicit root `viewport`. `MobileNav` + `--kh-z-mobile-nav` for primary nav below `sm`. Shell helpers in `shell.ts` used by app/status layouts and header.
* **Header theme icons** — Sun/moon glyph size reduced ~5% (`themeIconClassName` → `1.556rem`).
* **Toasts** — `ToastProvider` / `useToast`, recipes `.kh-toast*`, tokens `--kh-toast-duration-ms` / `--kh-z-toast`. Used for admin CRUD and LLM wizard confirmations.
* **List ordering** — Organizations, users, memberships, API clients: newest `createdAt` first.
* **Admin Organizations** — `/admin/organizations` for name/slug create, edit, and delete. Delete offers transfer (default; auto-target if only one other org) or permanent destroy of inherited items. Destroy requires a two-step warning plus acknowledgement checkbox before `confirmDestroy`. Last org cannot be deleted.
* **Destructive actions** — Prefer `Button variant="danger"` plus an explicit confirm step (inset panel), not bare `window.confirm` alone. Cascade/wipe paths need a second confirmation gate.
* **LLM client schemas** — Wizard configure step picks target client; schema export uses shared MCP schema builders.
* **Design system foundation** — `tokens.css`, button/nav/panel/step/page-num recipes, `LinkButton` / `NavLink` / `Panel` variants.
