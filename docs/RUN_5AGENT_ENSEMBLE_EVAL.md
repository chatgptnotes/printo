# Run the 5-Agent Ensemble Eval — Command Runbook

Validates whether the 5-agent ensemble scan reduces run-to-run wobble enough to ship.
Harness: `scripts/ensemble-eval.mjs` · Merge logic: `scripts/lib/ensemble-merge.mjs`

> **Use the REAL drawing** `test-files/p379-power.pdf` (9.7 MB). Do **NOT** use
> `tests/fixtures/p379-power-boq.pdf` or `docs/p379-power-boq.pdf` — those are tiny
> synthetic BOQ-output PDFs and won't reproduce vision variance.

---

## Option A — Local (quick, but only good for SHORT scans)

The public gateway `drawtoboq-aias.nexaproc.in` is capped at **~310s** by its nginx
vhost. A single vision scan takes **5–25 min**, so long scans get a 504 cut-off and
the harness throws. Local runs are only reliable if scans finish under ~5 min.

Run from the `realsoft.example` folder so the script and `.env` resolve.

```powershell
# 1. Dry run — costs nothing, confirms gateway URL + key load from .env
cd "D:\office\draw to boq\realsoft.example"; node scripts/ensemble-eval.mjs --file "test-files/p379-power.pdf" --mode both --reps 5

# 2. Real run — ~30 gateway calls, real money, runs SERIALLY (single-flight bridge)
cd "D:\office\draw to boq\realsoft.example"; node scripts/ensemble-eval.mjs --file "test-files/p379-power.pdf" --mode both --reps 5 --yes --out ensemble-eval-p379.json
```

---

## Option B — VPS (correct path for LONG 5–25 min scans)

Run on the box, inside the AI-pool docker network, pointed at the **internal LB**
(`drawtoboq-aias-lb`, nginx raised to 1810s) — this bypasses the 310s public cap.

```bash
ssh root@76.13.244.21      # adjust user if not root

# on the VPS — repo with scripts/ + test-files/ must be checked out here:
cd /path/to/drawtoboq-repo     # <-- set the real path

docker run --rm \
  --network vps_drawtoboq-aias \
  -v "$PWD":/app -w /app \
  -e NEXAPROC_GATEWAY_URL="http://drawtoboq-aias-lb:80" \
  -e DRAWTOBOQ_AIAS_KEY="$(grep '^CLIENT_KEY_DRAWTOBOQ=' /opt/nexaproc-ai-gateway/.env | cut -d= -f2)" \
  node:24 \
  node scripts/ensemble-eval.mjs --file "test-files/p379-power.pdf" --mode both --reps 5 --yes --out ensemble-eval-p379.json
```

Why each flag:
- `--network vps_drawtoboq-aias` — so the docker service name `drawtoboq-aias-lb` resolves (dead on the host otherwise).
- internal LB URL — gets the 1810s window instead of the 310s public cap.
- key pulled straight from the gateway `.env` — no pasted secrets.
- serial by default (`--concurrency 1`) — the bridge is single-flight; parallel calls just 429 each other.

### If the repo is NOT on the VPS

Copy the two things the harness needs up first, then run the same `docker run`:

```bash
# from your laptop
scp -r "D:\office\draw to boq\realsoft.example\scripts" root@76.13.244.21:/root/ens-eval/scripts
scp "D:\office\draw to boq\realsoft.example\test-files\p379-power.pdf" root@76.13.244.21:/root/ens-eval/test-files/p379-power.pdf
# then on the VPS: cd /root/ens-eval  (before the docker run above)
```

---

## What to read in the output

1. **Truncation check FIRST.** In the per-run log, look at `tokensOut` on single-mode
   runs that DROP a section:
   - near **32000** → wobble is **truncation, not sampling**. STOP — ensemble won't fix it;
     segment the scan or raise the cap instead.
   - well under 32000 but sections still flip → genuine sampling noise; ensemble is the right tool.

2. **Acceptance gate** (prints `PASS ✅ / FAIL ❌`):
   - CoV (run-to-run wobble) cut **≥50%** on every numeric (cable count, outlet qty, lighting qty, cable length)
   - Jaccard **≥0.9** structured sections, **≥0.8** free-text
   - **zero** section presence-flips

3. Full raw results + metrics saved to `ensemble-eval-p379.json` (`--out`).

---

## Flags reference

| Flag | Default | Meaning |
|---|---|---|
| `--file <path>` | (required) | drawing PDF/PNG/JPG — use the REAL one |
| `--mode single\|ensemble\|both` | `both` | what to run |
| `--reps <R>` | 5 | repetitions per mode |
| `--ensemble-size <N>` | 5 | agents per ensemble rep |
| `--temperature <t>` | 0.3 | ensemble per-agent temp (decorrelates) |
| `--single-temperature <t>` | 0 | single-mode temp (matches prod today) |
| `--concurrency <c>` | 1 | keep at 1 — bridge is single-flight |
| `--max-tokens <n>` | 32000 | match prod; raise to test truncation |
| `--retry-minutes <m>` | 30 | per-call retry budget on 429/503/transient |
| `--out <file.json>` | — | write full raw results + metrics |
| `--yes` | — | actually spend (without it: dry run only) |
