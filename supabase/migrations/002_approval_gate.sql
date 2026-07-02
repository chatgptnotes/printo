-- Add approval_gate column to track which pipeline step is awaiting approval
ALTER TABLE sabi_projects ADD COLUMN IF NOT EXISTS approval_gate INTEGER DEFAULT NULL;

-- Add comment
COMMENT ON COLUMN sabi_projects.approval_gate IS 'Pipeline step number currently awaiting human approval. NULL when no gate is active.';
