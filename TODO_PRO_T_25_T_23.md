# Remaining Work for PRO-T-25 and PRO-T-23

This document lists items from the PR review that need follow-up work.

## #6: Project Move Audit Trail (PRO-T-23)

**Status**: Not implemented (out of scope)

**Context**: Currently there is NO `move_project` MCP tool or UI/API endpoint to move projects between workspaces. Ferenc likely moved FurniTender via direct database update (`UPDATE projects SET workspace_id = ...`).

**What needs to be implemented**:

1. **Move Project Endpoint**: `POST /api/v1/projects/:projectId/move`
   ```json
   {
     "targetWorkspaceId": "<uuid>",
     "reason": "optional move reason"
   }
   ```

2. **Audit Event**: Write `project.moved` audit entry:
   ```typescript
   await writeAuditEvent(app.database, {
     organizationId: client.organizationId,
     actorType: 'user',
     actorId: principal.userId,
     action: 'project.moved',
     entityType: 'project',
     entityId: projectId,
     metadata: {
       fromWorkspaceId: oldWorkspaceId,
       toWorkspaceId: newWorkspaceId,
       reason: input.reason,
     },
     ipAddress: request.ip,
   });
   ```

3. **API Client Access Warning**: Before move, check all API clients:
   ```typescript
   const affectedClients = await app.database.db
     .select()
     .from(apiClients)
     .where(
       and(
         isNull(apiClients.revokedAt),
         // Has access to source workspace but not target
       )
     );
   
   if (affectedClients.length > 0) {
     return {
       project: ...,
       warnings: {
         apiClientAccessLoss: affectedClients.map(c => ({
           clientId: c.id,
           clientName: c.name,
           message: 'Will lose access after move',
         })),
       },
     };
   }
   ```

4. **Related Records**: Consider whether to:
   - Update knowledge records' workspaceId
   - Update tasks, epics, RAID items, etc.
   - Or leave them and handle cross-workspace refs

**Recommendation**: Implement in separate PR as it's a substantial feature with many edge cases.

## #8: Lifecycle Stage UI Visibility (PRO-T-25)

**Status**: Partially implemented (backend ready, UI pending)

**What exists**:
- ✅ Backend returns `lifecycleStage` in project responses
- ✅ Database has the field
- ✅ MCP tools expose it

**What needs to be added**:

### Project List View
`apps/web/src/app/(app)/workspaces/[slug]/projects/page.tsx` (or similar):

```tsx
// Add badge component
import { Badge } from '@/components/ui/badge';

// In project list item:
<div className="flex items-center gap-2">
  <h3>{project.name}</h3>
  {project.lifecycleStage === 'idea' && (
    <Badge variant="outline">Idea</Badge>
  )}
  {project.lifecycleStage === 'draft' && (
    <Badge variant="outline">Draft</Badge>
  )}
  {project.lifecycleStage === 'proposal' && (
    <Badge variant="secondary">Proposal</Badge>
  )}
  {project.createdByType === 'api_client' && (
    <Badge variant="outline" className="text-xs">
      🤖 AI-created
    </Badge>
  )}
</div>
```

### Project Detail View
`apps/web/src/app/(app)/workspaces/[slug]/projects/[projectSlug]/page.tsx`:

```tsx
// Add promote button for idea/draft/proposal stages
{project.lifecycleStage !== 'active' && canManage && (
  <Button
    onClick={handlePromoteToActive}
    variant="default"
  >
    Promote to Active
  </Button>
)}

// Show AI provenance
{project.createdByType === 'api_client' && (
  <div className="text-sm text-muted-foreground">
    Created by AI agent
    {project.createdByModel && ` (${project.createdByModel})`}
  </div>
)}
```

### Promote to Active Handler
```typescript
async function handlePromoteToActive() {
  await fetch(`/api/v1/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lifecycleStage: 'active',
    }),
  });
  // Refresh project data
}
```

**Recommendation**: Quick UI update, should take ~30-60 minutes to implement and test.

## Testing Checklist

When implementing the above:

- [ ] Move project between workspaces
- [ ] Verify audit event written with from/to workspace
- [ ] Verify API client access warning shown
- [ ] Verify UI shows lifecycle stage badges
- [ ] Verify "Promote to Active" button appears for idea/draft/proposal
- [ ] Verify promotion works and updates badge
- [ ] Verify AI provenance shown in UI
