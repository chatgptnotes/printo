# ERP Realsoft

ERP Realsoft is an AI-assisted drawing-to-BOQ and estimation workspace.
It preserves the DrawToBOQ feature set for direct project intake, attachment upload,
drawing/spec extraction, BOQ generation, estimator review, approval gates, and
Excel/PDF export.

## Run Locally

```bash
npm ci
npm run dev
```

The app runs on `http://localhost:3001` by default.

## Production Rules

- Users upload drawings, schedules, specifications, and archives directly into a project.
- Every uploaded or regenerated drawing must run a fresh AI extraction.
- Mock/demo BOQs must stay disabled in production.
- Weak BOQs must fail closed instead of being silently accepted.
- Generated BOQ data must go through human review before approval/export.

## UI

The authenticated workspace uses the ERP Realsoft shell and the AI BOQ modal
workflow: upload, extract, resolve, review, and confirm.
