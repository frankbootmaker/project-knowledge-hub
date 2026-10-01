-- PRO-T-25: MCP project creation with AI provenance and lifecycle stage
-- PRO-T-23: Better workspace denial errors

-- Add fields to track AI-created projects (via MCP, API client, model)
ALTER TABLE projects
  ADD COLUMN created_by_type text,
  ADD COLUMN created_by_id text,
  ADD COLUMN created_by_model text,
  ADD COLUMN lifecycle_stage text NOT NULL DEFAULT 'active';

-- Add index for lifecycle stage filtering
CREATE INDEX projects_lifecycle_stage_idx ON projects (lifecycle_stage);

-- Comment: lifecycle_stage values: 'idea', 'draft', 'proposal', 'active', 'completed', 'archived'
-- idea/draft/proposal = MCP-created, awaiting human promotion
-- active = human-approved or human-created
-- created_by_type: 'user', 'api_client', 'mcp', etc.
-- created_by_id: user UUID or API client UUID
-- created_by_model: optional LLM identifier (e.g., 'gpt-4', 'claude-sonnet-3.5')
