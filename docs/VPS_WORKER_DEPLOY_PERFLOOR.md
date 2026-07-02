# VPS Worker Deploy — Per-Floor Completeness

Update the `drawtoboq-estimate-worker` container so the new per-floor logic goes
live on real (long) scans. Pushed to GitHub `chatgptnotes/realsoft.example`, branch
`main`, commit `88c842d`.

## What changed in `worker/server.js`
- `validateElectricalScan()` check #5 — flags every floor in `floor_labels` that
  produced no per-floor take-off (`stats.floorsEmpty` + a `FLOORS_EMPTY` warning)
- new `canonFloorKey()` / `floorIsCovered()` — floor-name matching
  (`1F`=`First Floor`, `Upper Roof`=`Roof`, `B1`=`Basement 1`, …)
- new `buildFloorGapFillPrompt()` / `mergeFloorGapFill()` + `FLOOR_WISE_SECTIONS`
- a per-floor gap-fill re-read wired after the section gap-fill (re-reads ONLY
  the empty floors' sheets and appends them)
- `PER-FLOOR COMPLETENESS RULE` added to `buildElectricalProcedurePrompt`

---

## Commands (run on the VPS)

```bash
# 1. Go to the repo the worker builds from, get the new code
cd /path/to/realsoft.example          # adjust to the actual repo path on the box
git pull origin main

# 2. Sanity-check the file parses
node --check worker/server.js

# 3. Rebuild ONLY the worker container
#    - compose project name is `drawtoboq` (NOT vps)
#    - NEVER use --remove-orphans here (it would wipe the pratyaya-* containers)
docker compose -p drawtoboq up -d --force-recreate drawtoboq-estimate-worker

# 4. Recreate often drops the AI-pool network link. If a test scan fails with
#    EAI_AGAIN / "can't resolve drawtoboq-aias-lb", reconnect it:
docker network connect vps_drawtoboq-aias drawtoboq-estimate-worker

# 5. Health check — host port 8781 (NOT 8779; that's container-internal = 000)
curl -s http://127.0.0.1:8781/health
```

---

## ⚠️ Reconciliation (don't lose work)

The VPS-side Claude earlier edited the prompt on the box and **added a 7-point
reconciliation self-check** that is **not** in the GitHub copy. After `git pull`,
re-apply that self-check into `buildElectricalProcedurePrompt` so the worker keeps
**both** the 7-point self-check **and** the new validator / gap-fill code.

(If the pull reports a merge conflict in `worker/server.js`, keep the incoming
validator + gap-fill code AND your self-check block.)

---

## After deploy
Re-run the scan from the project page on realsoft.example. The cache version was
bumped `electrical-v3 → v4`, so it won't reuse the old result — a fresh scan runs
and should now fill **Swimming Pool Deck / Basement / Upper Roof**.
