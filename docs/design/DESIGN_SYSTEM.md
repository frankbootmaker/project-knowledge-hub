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
| `--kh-bg` | Page/strip background (alias of `--kh-surface`; prototype `--bg`) |
| `--kh-line` / `--kh-line-strong` | Borders |
| `--kh-accent*` / `--kh-warn*` / `--kh-danger*` | Status |
| `--kh-radius-*` | Square Ops Console radii (`3px` / `3px` / `4px`) |
| `--kh-rail` / `--kh-rail-compact` | Authenticated left rail width (`224px` / `64px`) |
| `--kh-z-rail` / `--kh-z-header` | Rail and sticky header stacking |
| `--kh-control-height/width` | Switch and compact controls |
| `--kh-control-pad-x/y` | Button padding |
| `--kh-focus-ring` | Focus ring color mix |
| `--kh-toast-duration-ms` | Auto-dismiss duration for toasts (JS reads this via constant alignment) |
| `--kh-z-toast` | Toast stacking context |
| `--kh-z-modal` | Modal dialogs (below toasts, above mobile nav) |
| `--kh-z-mobile-nav` | Mobile nav overlay (below toasts, above sticky header) |
| `--kh-motion-fast` / `--kh-motion-base` / `--kh-motion-enter` | Interaction + entrance durations (~140 / 220 / 280ms) |
| `--kh-ease-out` / `--kh-ease-standard` | Entrance vs hover/press easing |

Dark mode flips the same `--kh-*` variables under `.dark` on `<html>`.

## Motion

Intentional, short motion for presence — not decoration. Prefer tokens above over ad-hoc `transition` / `duration-*`.

| Moment | Behavior |
|--------|----------|
| Page shell | `.kh-shell-content` fades/slides in (`kh-shell-in`) |
| Modal / mobile nav | Backdrop fades (`kh-backdrop-in`); panel enters with ease-out |
| Toast | Slide + slight scale (`kh-toast-in`) |
| Buttons / file Browse | Color transitions + 1px press (`:active`) |
| Switch | Thumb `translate` over `--kh-motion-base` |

`prefers-reduced-motion: reduce` disables entrance animations and press transforms.

## Responsive

Expand this system for narrow viewports — do **not** invent a parallel mobile design system.
Breakpoints stay Tailwind defaults unless a product need forces a custom set.

| Concern | Convention |
|---------|------------|
| Breakpoints | `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px |
| Viewport | Root layout exports `viewport: { width: 'device-width', initialScale: 1, viewportFit: 'cover' }` |
| Shell padding / width | Authenticated Ops Console: `.kh-ops-view` padding (`24px 28px`, `14px` below `md`). Legacy `.kh-shell` still used on public/auth pages (`max-w-6xl` + `px-4 sm:px-6`) |
| Shell content | Ops Console `.kh-ops-view`. Legacy `.kh-shell` + `.kh-shell-content` / `shellContentClassName` — adds `py-8` |
| Primary nav | Left **section-filter rail** (Personal, Delivery & finance, Control, Knowledge, Ops, Admin). Only one section’s items are visible. Compact rail + hover expand from `md`. Below `md`: mobile bar hamburger opens the rail drawer. Account lives in the rail user menu, not the rail list |
| Admin sidebar | Admin destinations live in the Ops rail Admin section. `admin/layout.tsx` no longer renders a second sidebar |
| Account sidebar | Same grid pattern in `account/layout.tsx` for signed-in users. Rail user menu also links to the same destinations |
| Grids | Prefer `grid-cols-1 sm:grid-cols-2 …`. Avoid fixed `grid-cols-[Npx_1fr]` without a mobile fallback |
| Touch targets | Prefer existing control tokens / header control squares; keep interactive chrome ≥ ~40px |
| Overflow | Code/JSON in `overflow-x-auto`; never rely on page-wide horizontal scroll |
| Modals | Below `sm`: bottom sheet (`items-end`, rounded top, `max-h` ≈ 92–96dvh), body scrolls, header/footer fixed; footer actions stack full-width (`flex-col-reverse`). From `sm`: centered card. Respect `safe-area-inset-*`; root `viewportFit: 'cover'` |
| Toasts | Below `sm`: full-bleed bottom strip with safe-area padding; from `sm`: bottom-right stack (`max-w-sm`). Stay above modals (`--kh-z-toast` > `--kh-z-modal`) |
| Section header actions | `SectionHeader` keeps title + actions on one row. Delivery view modes are a full-width `.kh-ops-delivery-modes` strip (text labels, overflow-x). Stakeholders view switchers still use icons below `md` via `ViewModeIcon` |
| Function header | `.kh-function-header*` stacks controls above actions below `sm`; controls may wrap; from `sm` keep search/filters left and primary actions right |

### Layout shells

| Shell | Pattern |
|-------|---------|
| App chrome | Ops Console grid: sticky left rail + sticky header. Page bodies use view-intro, count strips, square panels, and data tables. Mobile bar below `md` |
| App / status content | `.kh-ops-view` inside the authenticated shell. Status/monitoring live under Admin rail |
| Admin | Rail Admin section; no second admin sidebar |
| Account | Account sidebar on account routes; also reachable from the rail user menu |

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
| `.kh-ops-shell` / `.kh-ops-rail` / `.kh-ops-subhead` / `.kh-ops-view` | Authenticated Ops Console chrome (rail + header + content) |
| `.kh-ops-view-intro` / `.kh-ops-eyebrow` / `.kh-ops-page-title` / `.kh-ops-subtitle` | Page intro (used by `PageHeader`) |
| `.kh-ops-count-strip` / `.kh-ops-count-item` | Horizontal count strip |
| `.kh-ops-stats` / `.kh-ops-stat` / `.kh-ops-stat-label` / `.kh-ops-stat-value` / `.kh-ops-progress` | KPI / insight stat cards |
| `.kh-ops-panel` / `.kh-ops-panel-head` / `.kh-ops-panel-title` / `.kh-ops-panel-meta` | Square panel with 13px display header |
| `.kh-ops-toolbar` | List/admin search+filter chrome (also on `FunctionHeader`) |
| `.kh-ops-data-table` / `.kh-ops-table-wrap` / `.kh-ops-data-item` / `.kh-ops-stack` | Dense tables and catalogue rows |
| `.kh-ops-delivery-modes` / `.kh-ops-board` / `.kh-ops-lane` / `.kh-ops-task-card` | Delivery view strip, kanban lanes, and task cards |
| `.kh-ops-delivery-list` / `.kh-ops-delivery-tree-*` / `.kh-ops-tree-*` | Sortable delivery table and work-breakdown tree |
| `.kh-ops-sprint-head` / `.kh-ops-scrum-board` | Scrum sprint metrics + board density |
| `.kh-ops-calendar-layout` / `.kh-ops-month` / `.kh-ops-day` / `.kh-ops-event-dot` | Delivery calendar month + day list |
| `.kh-ops-timeline-scroll` / `.kh-ops-time-bar` | Timeline chart chrome and epic/story bars |
| `.kh-ops-empty-state` / `.kh-ops-empty-mark` | Empty delivery panes |
| `.kh-ops-capacity-row` / `.kh-ops-capacity-track` | Utilization planned (ink) + burn (accent) bars |
| `.kh-ops-budget-layout` / `.kh-ops-cost-split` / `.kh-ops-cost-part` | Budget burndown + people/AI/systems split |
| `.kh-ops-baseline-grid` / `.kh-ops-field-cell` / `.kh-ops-pinned` | Baseline field cells and pinned records |
| `.kh-ops-project-grid` / `.kh-ops-project-card` | Workspace / org / style-pack / dashboard workspace / account brand cards; `button.kh-ops-project-card` for report launchers and brand schemes. Workspace colour is a 3px inset stripe (`kh-workspace-tile`), not a wash. Selected brand uses `.selected` (ink border + 3px accent inset). |
| `.kh-ops-media-grid` / `.kh-ops-media-card` / `.kh-ops-media-preview` / `.kh-ops-media-info` | Workspace media catalogue (4 / 3 / 1 columns) |
| `.kh-ops-form-grid` / `.kh-ops-field-span` | Dense two-column modal and admin forms |
| `.kh-ops-card-body` / `.kh-ops-card-foot` / `.kh-ops-action-line` | Panel interior padding, card footer, save/test action row |
| `.kh-ops-setup-grid` / `.kh-ops-setup-card` / `.kh-ops-setup-step` | MCP / AI client setup cards |
| `.kh-ops-admin-link-grid` / `.kh-ops-admin-link-card` | Admin overview setup shortcuts and dashboard search/admin jump tiles (`a.kh-ops-admin-link-card`) |
| `.kh-ops-danger-zone` / `.kh-ops-danger-copy` | Close-account irreversible panel |
| `.kh-ops-dropzone` / `.kh-ops-paste-area` / `.kh-ops-narrow-form` | Document dropzone, conversation paste, 840px create forms |
| `.kh-ops-scope-list` / `.kh-ops-scope-checks` / `.kh-ops-scope-check` | Scope tags and checkbox chips |
| `.kh-ops-code` / `.kh-ops-status-row` | Token/schema blocks and MCP preflight rows |
| `.kh-ops-modal-tabs` / `.kh-ops-modal-pane` | Manage-dialog tab strip (existing product tabs only) |
| `.kh-ops-activity-item` / `.kh-ops-linked-row` / `.kh-ops-text-btn` | Task activity thread, linked rows, quiet actions |
| `.kh-ops-storage-choice` / `.kh-ops-provider` | Admin storage provider picker |
| `.kh-ops-stage-strip` / `.kh-ops-stage-card` | Import progress stages and MCP wizard steps |
| `.kh-ops-history-list` / `.kh-ops-history-item` | Knowledge version history rows |
| `.kh-ops-editor-shell` / `.kh-ops-editor-toolbar` / `.kh-ops-markdown-editor` | Knowledge create/edit editor + markdown toolbar |
| `.kh-ops-manage-strip` / `.kh-ops-keyvals` / `.kh-ops-tag-list` / `.kh-ops-tag` | Record action strip, definition lists, tag chips |
| `.kh-ops-markdown-view` / `.kh-ops-toc` / `.kh-ops-preview-pane` | Markdown document density, TOC panel, live preview |
| `.kh-ops-roster-person` | Stakeholder roster avatar + name cell |
| `.kh-ops-org-tree` / `.kh-ops-org-card` / `.kh-ops-org-ungrouped-grid` | Stakeholder org chart (tree connectors, 200px cards, ungrouped grid) |
| `.kh-ops-help-btn` / `.kh-ops-popover` | Compact `?` help control and square legend/tooltip panel |
| `.kh-ops-choice` / `.kh-ops-check-list` / `.kh-ops-plan-row` | Manage/import/git pickers, attendee check lists, scrum plan rows |
| `.kh-ops-health-grid` / `.kh-ops-health-card` | Admin / monitoring health cards |
| `.kh-ops-detail-grid` / `.kh-ops-record-head` | Knowledge/system read two-column layout + record title block |
| `.kh-ops-leader-strip` / `.kh-ops-leader` | Monitoring client leaderboard cells |
| `.kh-ops-connection-row` | Compact on-duty / connection rows |
| `.kh-ops-stamp-grid` / `.kh-ops-stamp` | Monitoring archived-count stamps |
| `.kh-ops-profile-photo` | Account profile avatar row |
| `.kh-ops-lang-chip` | Knowledge translation language chips |
| `.kh-ops-confirm` / `.kh-ops-inset` | Archive/purge confirms and nested pickers |
| `.kh-ops-cal-day` | Compact admin audit calendar cells |
| `.kh-ops-auth-page` / `.kh-ops-auth-card` / `.kh-ops-auth-brand` / `.kh-ops-auth-body` | Public auth screens |
| `.kh-ops-empty` / `.kh-ops-type-chip` / `.kh-ops-setting-row` | Empty states, type chips (`aria-pressed` for filters; also style-pack token insert), account setting rows |
| `.kh-ops-color-swatch` / `.kh-ops-color-input` | Square colour chips and native colour input (style-pack picker) |
| `.kh-shell` / `.kh-shell-content` | Max-width shell + content vertical padding (public/auth pages) |
| `.kh-mobile-nav` / `.kh-mobile-nav-backdrop` / `.kh-mobile-nav-panel` / `.kh-mobile-nav-links` | Full-viewport mobile nav dropdown |
| `.kh-modal` / `.kh-modal-backdrop` / `.kh-modal-panel` (+ `-lg`) / `.kh-modal-header` / `.kh-modal-title` / `.kh-modal-description` / `.kh-modal-body` / `.kh-modal-footer` | Modal dialogs |

## Primitives

| Component | Use when |
|-----------|----------|
| `Button` | Native `<button>` actions |
| `LinkButton` | Navigation that should look like a button |
| `NavLink` | Header or admin sidebar links (active state included) |
| `MobileNav` | Primary nav below `sm` (sheet + backdrop; Esc / route change closes) |
| `Modal` | Focused create/edit flows; Esc + backdrop close; optional `footer`; `size` `md`/`lg`/`xl`/`full`. Mobile bottom sheet / desktop card via `.kh-modal*` (sticky 13px/11px header, 3px radii) |
| `Panel` | `default` / `solid` / `inset` surfaces |
| `Field`, `Input`, `PasswordInput`, `PasswordStrengthHint`, `Select`, `Textarea`, `ErrorText` | Forms (`PasswordInput` show/hide; strength meter for new passwords) |
| `FilePicker` | File choose control — secondary **Browse** / **Tallózás** button + filename (hides native file chrome) |
| `Badge` | Compact status chips (e.g. health “ok”) |
| `Switch` | On/off toggles |
| `ToastProvider` / `useToast` | Global confirmations (`pushToast(message, tone?)`); mobile full-width bottom, desktop corner |
| `Page`, `PageHeader`, `SectionHeader`, `ListCard` | Page layout. `PageHeader` is the Ops Console view-intro (eyebrow + condensed title + subtitle + actions). `ListCard` is a dense catalogue row inside `.kh-ops-panel` |
| `FunctionHeader` | List/admin toolbar: search + filters + primary actions (`.kh-ops-toolbar`; stacks below `sm`) |
| `OpsCountStrip` | Horizontal count strip for live totals (dashboard, workspace, git, imports, stakeholders) |
| `AuthCard` | Bordered login/register/reset/confirm card with KH mark |

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

### 2026-08-21

* **Ops Console leftover dashboard/brand chrome** — Dashboard workspace tiles use `.kh-ops-project-grid` / `.kh-ops-project-card` (colour stripe unchanged). Search/admin jump tiles use `.kh-ops-admin-link-grid` / `.kh-ops-admin-link-card`. Account brand schemes use project cards with `.selected`. Style-pack token insert uses type chips; colour picker swatches/native input are square (`.kh-ops-color-swatch` / `.kh-ops-color-input`).
* **Ops Console leftover polish** — Org chart uses org-tree / org-card / ungrouped-grid. Manage, Git provider, and import-type pickers use `.kh-ops-choice`. Scrum attendee lists, plan rows, DoD inset, guest chips, and delivery `?` legends/popovers use Ops recipes. Workspace colour is a 3px inset stripe instead of a soft wash.
* **Ops Console media + reports** — Workspace media catalogue (`/workspaces/{slug}/media`) lists existing image assets (jpeg/png/webp/gif) from `GET/POST /api/v1/workspaces/:workspaceId/media` with optional PATCH link and DELETE. Ops rail **Media library** points there (document import stays `/imports`). Project **Reports** rail and section `#project-reports` open the existing status / delivery / stakeholder markdown preview (no insight widgets). Viewer loading/footer use Ops empty + action-line recipes.
* **Ops Console leftover chrome** — Knowledge read, system detail, and project overview use detail-grid, record-head, keyvals, and tags. Monitoring uses health cards, client leader-strip, on-duty connection rows, and archived-count stamps for live data only (no restore-drill UI). Audit uses a compact calendar, form-grid filters, and a Created/Actor/Action/Entity table (IP stays on the actor cell; no invented outcome column). Import details, manage interiors, archive/purge confirms, translation chips, RAID/change/baseline pickers, search/memberships wrappers, account sidebar (restyled, not removed), AI discover, and remaining admin confirm/editor panels match Ops density. No media library, reports studio, MCP agent portal, owner, or generated-key reservation.
* **Ops Console knowledge editor** — Create/edit record chrome uses editor-shell, markdown toolbar, manage-strip/action-line, and live preview aside. Existing fields and save/lifecycle actions stay; no owner, generated-key reservation, or version diff is invented. Record detail more-details, tags, markdown viewer, and version snapshot warnings use the same Ops density.
* **Ops Console leftover forms** — Mail settings, MCP setup wizard (stage strip + client setup cards + schema copy cards), admin overview shortcuts, close-account danger zone, conversation/document import, create workspace/project/system, AI connection tables, change password, and display/notification prefs now use Ops form-grid, action-line, setup-card, dropzone, and danger-zone recipes. Drivers stay console/SMTP/Resend; confirm phrase stays `CLOSE`; no invented SES, FTE, or Azure fields.
* **Ops Console leftover catalogues** — Project-linked systems/records, workspace picker, account memberships, import details, version history, Git connections, and remaining admin lists (organizations, AI providers, storage picker, style packs) now use Ops data tables, project cards, or provider/stage strips. Task manage dialogs use prototype modal tabs and form grid for existing Details / RACI / Handoff / Activity / Documents sections. No invented FTE, retention, or Azure storage columns.
* **Ops Console catalogues (slices 1–8)** — Stakeholders (list/org/utilization inline; `?stakeholders=org` / `?utilization=1` unchanged), RAID, change, budget body, baseline, workspace project grid + knowledge/system tables, search groups, archive tables, manage-modal density, and admin/account lists now use `.kh-ops-data-table`, capacity bars, budget layout, baseline grid, and project cards. No invented FTE/cycle-time/budget-impact columns.
* **Ops Console delivery** — Project delivery matches the prototype board/list/tree/scrum/calendar/timeline chrome in place (`?delivery=` hash routes unchanged). Mode strip, live open-work / hours / cost stats, sortable list table, lane task cards, work-breakdown tree, sprint-head, month+day calendar, and timeline bars use `.kh-ops-delivery-*` recipes. Board statuses stay `todo|in_progress|blocked|done|cancelled`; cycle time is not invented.
* **Ops Console views** — Remaining high-traffic surfaces match the prototype density: `PageHeader` is `.kh-ops-view-intro`; catalogues sit in square panels with row items; dashboards/admin/git/imports use count strips and data tables; auth uses the bordered `AuthCard`. Shared recipes live in `styles/ops-shell.css` (`OpsCountStrip`, `.kh-ops-stats`, `.kh-ops-health-grid`, `.kh-ops-data-table`).

### 2026-08-20

* **Ops Console shell** — Authenticated app uses a left section-filter rail + sticky header (`OpsAppShell`, `.kh-ops-*` in `styles/ops-shell.css`). Sections: Personal, Delivery & finance, Control, Knowledge, Ops, Admin. Account is under the user menu. Compact rail and a mobile drawer match the prototype. Theme controls are `data-theme-choice` buttons (light / dark / system); `data-theme` / `data-brand` live on `<html>` only.
* **Option A tokens** — `--kh-*` retuned to Ops Console oklch (IBM Plex, green accent, 24px background grid, square `3px` panels). Department palettes (`knowhub`, `bootmaker`, `nethorizon`, `in3`) change accent only via `html[data-brand]`. Primary buttons use ink-on-surface like the prototype.
* **Brand colours** — Account → Display (`#brand`) maps the prototype Admin brand schemes onto the existing cookie + `data-brand` accent without a new product surface.
* **Org chart emails** — Stakeholder org-chart addresses wrap only at `.` and `@` so dotted segments stay whole inside the card.

### 2026-08-11

* **Responsive modals & toasts** — Modals are bottom sheets below `sm` (scrollable body, sticky header/footer, full-width stacked actions, safe-area padding); centered cards from `sm`. Toasts are full-bleed at the bottom on small screens and corner-stacked from `sm`. Root `viewportFit: 'cover'` for insets.
* **Icon view switchers** — Delivery / Stakeholders view controls use `ViewModeIcon` below `md` so they stay on the section title row; text labels from `md` up.
* **Compact mobile header** — Below `md`, brand is the KnowHub mark only (`BrandMark`); wordmark from `md` up. Login/logout are icon controls (same square size as theme). `MobileNav` hamburger sits at the far right after session controls.
* **Section header actions** — Delivery / Stakeholders view switchers live in `CollapsibleSection` → `SectionHeader` `action` (not in `FunctionHeader`). Title + actions stay one row; `FunctionHeader` stacks controls above actions on small screens so open filters do not collide with create chrome.
* **Budgeting mobile** — Burndown chart is on-demand (wide modal) below `md`; epic cost rollups use stacked metric cards on small screens and denser short-header tables from `md`.

### 2026-07-31

* **Light atmosphere** — Page background nearly white (`--kh-bg-*` / `--kh-surface`); cool wash kept very subtle.
* **Motion** — Tokenized durations/easing (`--kh-motion-*`, `--kh-ease-*`). Stronger modal/toast/mobile-nav entrances + backdrop fade; shell content enter; button press; Switch thumb timing. `prefers-reduced-motion` disables entrances/press. `FilePicker` for Browse/Tallózás as secondary buttons.

### 2026-07-22

* **Markdown TOC + editor width** — Contents starts collapsed (Show/Hide); section branches expand on click; TOC uses `scrollIntoView` with heading `scroll-margin-top`. Knowledge editor uses `Page viewport` / Modal `xl` (~90vw). Project detail lists linked knowledge records beside linked systems.
* **User MCP setup wizard** — Account → AI connections leads with a guided setup (`UserMcpSetupWizard`): preflight → configure → create → test → schema → **done**. Shared pieces live under `components/mcp-setup/` (schemas, LLM picker, status rows, finish panel, connection troubleshooting). Agent pairing requests stay as a secondary section on the same page. Admin wizard shares Finish + troubleshooting (with extra diagnostics).

### 2026-07-21

* **Import type picker** — “New import” opens a modal (paste chat available; documents and images marked coming soon), shared on the workspace catalogue and imports list.
* **Workspace catalogue sections** — Projects, systems, and knowledge records each use `FunctionHeader` with search/filters collapsed behind a toggle icon (left of the create `LinkButton`); status/lifecycle filter, page size, and client pagination stay available when expanded.

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
* **Account profile** — `/account/profile` for display name + full name (email read-only), optional photo upload, and `UserAvatar` monogram fallback. **Workspace roles** (`/account/memberships`) lists memberships read-only. **Sign-in identity** and **Change password** are separate Account sidebar pages (`/account/identity`, `/account/password`; `POST /api/v1/me/password`). Account area uses the same left sidebar layout as Admin. Header shows avatar + display name linked to profile; mobile nav includes Profile.
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
* **Archive UX** — Soft-archive via `ArchiveEntityButton` (confirm + restore). Catalogue entities (project, system, knowledge record, import) and workspaces use a **Manage** modal (Details / Edit where applicable / Archive / Delete). Header + mobile nav link to `/archived` (user restore hub); per-workspace `/workspaces/{slug}/archived`; Admin → Archive for platform ops. Inline header nav starts at `md` so Archive fits without crowding phones/small tablets.
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
