# Operating Notes

## Report generation policy

Every drawing/file upload must generate a fresh report.

- Do not reuse a previous `reports/<drawing_id>.json` for a new upload.
- Do not deduplicate uploads by filename, file hash, project name, drawing number, or source file contents.
- Each upload must create a new drawing record and run AI extraction again.
- Existing reports are only reused when a user explicitly opens an existing drawing/report ID.
- When extraction logic changes, use the regeneration endpoint to reprocess stored drawings:
  - `POST /drawings/{id}/regenerate`
  - `POST /drawings/regenerate-all`

