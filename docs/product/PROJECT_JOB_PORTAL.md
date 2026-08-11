# Job portal (future staffing)

**Status:** Backlog idea (not scheduled)  
**Builds on:** open job roles + competencies on `project_stakeholders` ([`PROJECT_DELIVERY.md`](PROJECT_DELIVERY.md)); backlog id **NF-022**.

## Intent

Advertise project open roles as hireable listings (internal talent pool and/or public careers surface), collect applications, and hire into the **same** roster seat (fill-in-place), rather than inventing a parallel “vacancy” entity.

## Foundation already shipped

* Open role = `project_stakeholders` row with `user_id` null, required job title, optional `roleDescription` + competency tags `{ name, skillId }`.
* Assign / unassign attach or reopen a workspace member on that row.
* `skillId` is reserved for a future shared skill catalog (matching, HR sync).

## Suggested phases

1. **Publish** — visibility on an open role (`internal` | `public`); listing snapshot from title, description, competencies, project/org context; optional close/reopen of the listing without deleting the seat.
2. **Apply** — applications linked to `rosterId` (applicant identity, notes/CV refs, pipeline status). No workspace membership until hire.
3. **Hire** — invite → workspace member → existing assign endpoint (same row). Reject/withdraw leaves the seat open.
4. **Catalog** — populate `skillId` on competencies; optional matching UI and external HR/CMDB sync.

## Non-goals (v1)

* Full ATS (interview kits, scorecards, offer letters, payroll).
* Inviting users to the workspace via MCP without a human gate.
* RACI on open roles (still person/`user_id` only).
* Replacing the project stakeholders UI — portal is an advertising + pipeline layer on top.

## Open product questions

* Org-wide portal vs per-workspace careers page vs both.
* Whether public listings need a separate unauthenticated surface or stay behind SSO.
* Who may publish/hire (workspace maintainer vs dedicated recruiter role — may need NF-010-style ACLs).
