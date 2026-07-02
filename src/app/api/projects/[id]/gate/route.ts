import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { logActivity } from '@/lib/storage/activity-logger';
import { logCorrection } from '@/lib/storage/corrections-logger';
import { MAIN_PIPELINE_STEPS, PIPELINE_STEPS } from '@/lib/shared/constants';
import { requireAuth } from '@/lib/shared/api-auth';
import { generateElectricalPowerBOQ } from '@/lib/pdf/boq-pdf-generator';
import { tryLoadFixturePdf, tryLoadFixtureXlsx } from '@/lib/ai/test-fixture-replay';
import { generateDubaiIndustryBoqXlsx } from '@/lib/excel/dubai-industry-boq-xlsx';
import { enrichElectricalResult } from '@/lib/electrical/derive-cable-paths';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Binary MAIN gates handled here. Gate 10 (Bid Decision) is 3-way and handled
// by /api/projects/[id]/bid-decision instead.
//   Gate  9 — Documents Sufficient. status: docs_sufficient_pending → bid_decision_pending
//   Gate 12 — Confirm Quantities (MAIN Gate 3, step 12). Cable Schedule Review.
//             status: pricing_pending → boq_generating → boq_ready (approval_gate:14)
//             (auto-chain renders the 12-section Power BOQ PDF)
//   Gate 14 — Confirm Total (MAIN Gate 4, step 14).
//             status: confirm_total_pending | boq_ready → consent_pending
//   Gate 15 — Consent to Send. status: consent_pending → sending
const VALID_GATES = new Set([9, 12, 14, 15]);

const GATE_EXPECTED_STATUS: Record<number, string[]> = {
  // 'scope_pending' is the legacy alias for docs_sufficient_pending — accepted
  // here so projects extracted before the MAIN-pipeline rename keep working.
  9:  ['docs_sufficient_pending', 'scope_pending'],
  // Gate 12: cable-schedule approval on the detailed path.
  12: ['pricing_pending'],
  // Gate 14 (Confirm Total) accepts boq_ready (after BOQ generation),
  // confirm_total_pending (legacy), and yardstick_checked (after the optional
  // yardstick run — updateProjectStatus only changes status, not notes, so
  // approval_gate:14 is preserved and the gate card still renders).
  14: ['confirm_total_pending', 'boq_ready', 'yardstick_checked'],
  // 'send_pending' is the legacy alias for consent_pending — accepted here
  // so projects whose BOQ was orchestrated before the rename keep working.
  15: ['consent_pending', 'send_pending'],
};

const GATE_ROLLBACK_STATUS: Record<number, string> = {
  9:  'docs_sufficient_pending',
  // Gate 12 rollback omitted — falls back to project.status (pricing_pending),
  // which is already captured pre-approve.
  14: 'confirm_total_pending',
  15: 'consent_pending',
};

// POST: Approve, reject, or revert a decision gate
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id } = params;
    const body = await request.json();
    const { action, reason, auto_chain: autoChain } = body as {
      action: 'approve' | 'reject' | 'revert';
      reason?: string;
      auto_chain?: boolean;
    };
    // Audit attribution comes from the authenticated identity, not the
    // request body — clients can't spoof who approved a gate. The optional
    // `auto_chain` flag marks the call as part of an INSTANT BOQ run so
    // audit reviewers can distinguish machine-fired transitions from
    // human-deliberated ones (the acting user is the same in both cases).
    const decidedBy = auth.email === 'internal-service@sabi.ae'
      ? 'internal-service'
      : auth.email;
    const autoChainFlag = autoChain === true;

    const { data: project, error } = await supabaseAdmin
      .from('sabi_projects')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Revert: restore project to the gate it was rejected at
    if (action === 'revert') {
      let revertData: { rejected_gate?: number; previous_status?: string } = {};
      if (project.notes) {
        try {
          revertData = JSON.parse(project.notes);
        } catch {
          // notes is not JSON
        }
      }

      const rejectedGate = revertData.rejected_gate;
      const previousStatus = revertData.previous_status;

      if (!rejectedGate || !previousStatus) {
        return NextResponse.json(
          { error: 'No rejection to revert — missing revert data' },
          { status: 400 }
        );
      }

      const stepDef = PIPELINE_STEPS.find((s) => s.step === rejectedGate);
      const stepName = stepDef?.name || `Step ${rejectedGate}`;

      await supabaseAdmin
        .from('sabi_projects')
        .update({
          status: previousStatus,
          notes: JSON.stringify({ approval_gate: rejectedGate }),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      await logActivity(id, rejectedGate, stepName, 'started', {
        decision: 'reverted',
        reverted_by: decidedBy,
        auto_chain: autoChainFlag,
        reason: reason || 'Decision reversed',
      });

      return NextResponse.json({
        decision: 'reverted',
        gate: rejectedGate,
        status: previousStatus,
      });
    }

    // Read the current gate from notes JSON
    let gateStep: number | null = null;
    let notesData: Record<string, unknown> = {};
    if (project.notes) {
      try {
        notesData = JSON.parse(project.notes);
        gateStep = (notesData.approval_gate as number) || null;
      } catch {
        // notes is not JSON
      }
    }

    // Back-compat: translate legacy 33-step gate numbers to MAIN gates so
    // projects extracted before the MAIN-pipeline rename keep working.
    //   11 → 9   (Documents Sufficient)
    //   13 → 10  (Bid Decision — handled by /bid-decision but keep mapping)
    //   23 → 12  (Confirm Quantities — legacy mapping kept for old projects)
    //   29 → 14  (Confirm Total)
    //   33 → 15  (Consent → Send)
    const LEGACY_GATE_MAP: Record<number, number> = { 11: 9, 13: 10, 23: 12, 29: 14, 33: 15 };
    if (gateStep != null && LEGACY_GATE_MAP[gateStep] != null) {
      gateStep = LEGACY_GATE_MAP[gateStep];
    }

    if (!gateStep) {
      return NextResponse.json(
        { error: 'No pending approval gate for this project' },
        { status: 400 }
      );
    }

    if (!VALID_GATES.has(gateStep)) {
      return NextResponse.json(
        { error: `Gate ${gateStep} is not valid. Binary gates: ${Array.from(VALID_GATES).sort((a,b)=>a-b).join(', ')}. Gate 10 (Bid Decision) is handled by /bid-decision.` },
        { status: 400 }
      );
    }

    // Idempotency guard: reject the request if the project isn't in the
    // expected status for this gate. Prevents double-approve from re-running
    // the auto-chain.
    const expectedStatuses = GATE_EXPECTED_STATUS[gateStep] || [];
    if (expectedStatuses.length > 0 && !expectedStatuses.includes(project.status)) {
      return NextResponse.json(
        {
          error: `Gate ${gateStep} already processed — project is in status '${project.status}'`,
          current_status: project.status,
        },
        { status: 409 }
      );
    }

    // Step-name lookup falls back through MAIN_PIPELINE_STEPS so gates 9/12/15
    // get their MAIN names (Documents Sufficient / Confirm Quantities / Consent
    // Received & Send) while gate 14 keeps its electrical SUB name (Prepare
    // Cable Schedule).
    const stepDef =
      PIPELINE_STEPS.find((s) => s.step === gateStep) ||
      MAIN_PIPELINE_STEPS.find((s) => s.step === gateStep);
    const stepName = stepDef?.name || `Step ${gateStep}`;

    // === REJECT HANDLING ===
    // v6 spec rejection routing — each gate gets its own status so the UI can
    // distinguish a resumable hold from a loop-back from a terminal decline.
    //   Gate 9  (Documents Sufficient) NO  → awaiting_documents (PAUSE · REQUEST)
    //   Gate 12 (Confirm Quantities)   NO  → revise_quantities  (REVERT · loop)
    //   Gate 14 (Confirm Total)        NO  → revise_pricing     (REVERT · loop)
    //   Gate 15 (Consent → Send)       NO  → quote_held         (PAUSE · do not send)
    // Gate 12 rejecting pricing_pending (cable-schedule) loops back to revise_quantities.
    // Gate 2 No-Bid is the only TERMINAL decline and is handled by /bid-decision.
    const REJECT_STATUS: Record<number, string> = {
      9:  'awaiting_documents',
      12: 'revise_quantities',
      14: 'revise_pricing',
      15: 'quote_held',
    };

    if (action === 'reject') {
      await logActivity(id, gateStep, stepName, 'failed', {
        decision: 'rejected',
        reason: reason || 'No reason provided',
        decided_by: decidedBy,
        auto_chain: autoChainFlag,
      });

      // Gates 12 (quantities) and 14 (total) reject when AI produced something
      // human disagrees with — log the disagreement so future heuristics can
      // see what AI got wrong. Gates 9 and 15 are not AI-output gates so they
      // don't yield a useful correction signal.
      if (gateStep === 12 || gateStep === 14) {
        const fieldPath = gateStep === 12 ? 'quantities.cable_schedule' : 'pricing.final_quote_aed';
        const aiValue = gateStep === 14
          ? { final_quote_aed: project.final_quote_aed }
          : { ai_extraction: project.ai_extraction };
        await logCorrection({
          projectId: id,
          fieldPath,
          aiValue,
          humanValue: { rejected: true, reason: reason || null, gate: gateStep },
          metadata: {
            building_type: project.building_type,
            total_area_sqft: project.total_area_sqft,
            floors: project.floors,
          },
          createdBy: decidedBy,
        });
      }

      // Store revert data so the decision can be reversed
      const revertNotes = JSON.stringify({
        rejected_gate: gateStep,
        previous_status: project.status,
        rejected_at: new Date().toISOString(),
        rejection_reason: reason || 'No reason provided',
      });

      await supabaseAdmin
        .from('sabi_projects')
        .update({
          status: REJECT_STATUS[gateStep] || 'declined',
          notes: revertNotes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      return NextResponse.json({ decision: 'rejected', gate: gateStep });
    }

    // === APPROVE HANDLING ===
    await logActivity(id, gateStep, stepName, 'completed', {
      decision: 'approved',
      decided_by: decidedBy,
      auto_chain: autoChainFlag,
      approval_note: reason || null,
    });

    // Gate 12 cable-schedule approval kicks the BOQ render via the auto-chain.
    const previousStatus = project.status;
    const isCableScheduleApproval = gateStep === 12 && previousStatus === 'pricing_pending';

    // Per-gate intermediate status. Gate 12 (cable schedule) uses
    // 'boq_generating' as a distinct in-flight state so a duplicate request
    // arriving while the PDF renders gets blocked by the GATE_EXPECTED_STATUS
    // 409 above. Other transitions are direct.
    let intermediateStatus: string;
    let nextGate: number | null;

    if (gateStep === 9) {
      intermediateStatus = 'bid_decision_pending';     // opens Gate 10 (bid-decision)
      nextGate = 10;
    } else if (isCableScheduleApproval) {
      intermediateStatus = 'boq_generating';           // cable schedule ✓ → BOQ render
      nextGate = null;                                 // becomes boq_ready in auto-chain
    } else if (gateStep === 14) {
      intermediateStatus = 'consent_pending';          // MAIN Confirm Total ✓
      nextGate = 15;
    } else if (gateStep === 15) {
      intermediateStatus = 'sending';                  // Consent ✓ → dispatch
      nextGate = null;
    } else {
      intermediateStatus = previousStatus;
      nextGate = null;
    }

    const intermediateNotes = nextGate != null
      ? JSON.stringify({ approval_gate: nextGate })
      : null;

    await supabaseAdmin
      .from('sabi_projects')
      .update({
        status: intermediateStatus,
        notes: intermediateNotes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    // === AUTO-CHAIN ===
    // Cable schedule approval renders and stores the 12-section Power BOQ PDF.
    // Other approvals are pure status transitions — the UI / next-step routes
    // handle their side effects (bid-decision form, yardstick run, send-quote).
    let autoTriggerError: string | null = null;

    try {
      if (isCableScheduleApproval) {
        // Fixture replay: if estimate ran from a captured fixture, the same
        // captured PDF is served instead of re-rendering. Stamped into
        // notes.fixture_key by the estimate route. ~50ms vs ~3-5s.
        let fixtureKey: string | null = null;
        try {
          const n = project.notes ? JSON.parse(project.notes) : {};
          fixtureKey = typeof n.fixture_key === 'string' ? n.fixture_key : null;
        } catch { /* notes not JSON */ }
        const fixturePdf = fixtureKey ? await tryLoadFixturePdf(fixtureKey) : null;
        const boqBuffer = fixturePdf ?? await generateElectricalPowerBOQ(project, id);
        if (fixturePdf) {
          console.log(`[gate] FIXTURE PDF replay key=${fixtureKey!.slice(0, 12)}… — skipping PDF render`);
        }
        const pdfPath = `boq/${id}/power-boq.pdf`;
        const { error: uploadErr } = await supabaseAdmin.storage
          .from('sabi-attachments')
          .upload(pdfPath, boqBuffer, { contentType: 'application/pdf', upsert: true });

        if (uploadErr) {
          autoTriggerError = `PDF upload failed: ${uploadErr.message}`;
        } else {
          await logActivity(id, 12, 'Confirm Quantities', 'completed', {
            message: 'Power BOQ PDF generated and stored.',
            pdf_path: pdfPath,
          });

          // ── Also generate the Dubai industry-standard 13-bill XLSX. ────────
          // Best-effort: failures here don't block the PDF deliverable. The XLSX
          // gives the consultant a fully-priced, AVL-tagged tender document
          // alongside the PDF.
          let xlsxPath: string | null = null;
          try {
            const { data: svc } = await supabaseAdmin
              .from('sabi_services')
              .select('ai_extraction')
              .eq('project_id', id)
              .eq('service_type', 'electrical')
              .single();
            const electricalRaw = (svc?.ai_extraction as Record<string, unknown> | null)?.['raw_electrical_procedure'] || null;
            // Enrich on read so old bids — extracted before this enrichment
            // landed — produce the improved itemized Bill 4 / Step 13 BOQ
            // when Gate 14 is approved (or re-approved) without needing a
            // fresh re-extraction.
            const electrical = electricalRaw ? enrichElectricalResult(electricalRaw as Parameters<typeof enrichElectricalResult>[0]) : null;

            const fixtureXlsx = fixtureKey ? await tryLoadFixtureXlsx(fixtureKey) : null;
            const xlsxBuffer = fixtureXlsx ?? await generateDubaiIndustryBoqXlsx({
              project,
              electrical,
              overrides: {},
              options: {
                contingency_pct: 0.10,
                vat_pct: 0.05,
                currency: 'AED',
                status: 'PRICED (INDICATIVE) — Dubai 2026 market rates · review before submission',
              },
            });
            if (fixtureXlsx) {
              console.log(`[gate] FIXTURE XLSX replay key=${fixtureKey!.slice(0, 12)}… — skipping XLSX render`);
            }
            xlsxPath = `boq/${id}/power-boq-industry.xlsx`;
            const { error: xlsxUploadErr } = await supabaseAdmin.storage
              .from('sabi-attachments')
              .upload(xlsxPath, xlsxBuffer, {
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                upsert: true,
              });

            if (xlsxUploadErr) {
              console.error(`Industry XLSX upload failed for ${id}:`, xlsxUploadErr.message);
              xlsxPath = null;
            } else {
              // Activate the existing "Download BOQ (Excel)" button by writing
              // the storage path into sabi_estimations.generated_boq_url.
              await supabaseAdmin
                .from('sabi_estimations')
                .upsert(
                  { project_id: id, generated_boq_url: xlsxPath, updated_at: new Date().toISOString() },
                  { onConflict: 'project_id' }
                );
              await logActivity(id, 12, 'Confirm Quantities', 'completed', {
                message: 'Dubai industry-standard 13-bill BOQ XLSX generated and stored.',
                xlsx_path: xlsxPath,
              });
            }
          } catch (xlsxErr) {
            const message = xlsxErr instanceof Error ? xlsxErr.message : 'Unknown error';
            console.error(`Industry XLSX generation failed for ${id} (PDF still available):`, message);
            xlsxPath = null;
          }

          // Guarantee a sabi_estimations row exists before reaching boq_ready.
          // Otherwise the only writer is the best-effort XLSX block above, so an
          // XLSX failure left no row and the auto-run aborted at the yardstick
          // step (13) with "No estimation found. Run estimation first." Compute
          // cost figures from the priced required services (same source the PDF
          // uses); the yardstick's own placeholder logic fills any unpriced gaps.
          try {
            const { data: reqSvc } = await supabaseAdmin
              .from('sabi_services')
              .select('total_aed')
              .eq('project_id', id)
              .eq('is_required', true);
            const totalAed = (reqSvc || []).reduce((s: number, x: { total_aed: number | null }) => s + (x.total_aed || 0), 0);
            const area = (project as { total_area_sqft?: number | null }).total_area_sqft || 0;
            const costPerSqft = area > 0 ? Math.round((totalAed / area) * 100) / 100 : 0;
            await supabaseAdmin
              .from('sabi_estimations')
              .upsert(
                {
                  project_id: id,
                  total_aed: totalAed,
                  cost_per_sqft_aed: costPerSqft,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: 'project_id' }
              );
          } catch (estErr) {
            // Non-fatal: yardstick is advisory and degrades gracefully without it.
            console.error(`[gate] estimation-row guarantee failed for ${id}:`, estErr instanceof Error ? estErr.message : estErr);
          }

          // Set boq_ready and open Gate 14 (Confirm Total) so Phase 4 can proceed.
          await supabaseAdmin
            .from('sabi_projects')
            .update({
              status: 'boq_ready',
              notes: JSON.stringify({
                approval_gate: 14,
                boq_pdf_path: pdfPath,
                ...(xlsxPath ? { boq_xlsx_path: xlsxPath } : {}),
                ...(fixtureKey ? { fixture_key: fixtureKey } : {}),
              }),
              updated_at: new Date().toISOString(),
            })
            .eq('id', id);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      autoTriggerError = message;
      console.error(`Auto-trigger after gate ${gateStep} threw:`, message);
    }

    // Rollback on failure — restore the gate so George can retry.
    if (autoTriggerError) {
      console.error(`Auto-trigger after gate ${gateStep} failed:`, autoTriggerError);
      const rollbackStatus = GATE_ROLLBACK_STATUS[gateStep] || project.status;
      await supabaseAdmin
        .from('sabi_projects')
        .update({
          status: rollbackStatus,
          notes: JSON.stringify({
            approval_gate: gateStep,
            last_error: autoTriggerError,
            last_error_at: new Date().toISOString(),
          }),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      return NextResponse.json(
        {
          decision: 'approved',
          gate: gateStep,
          auto_trigger_error: autoTriggerError,
          rolled_back_to: rollbackStatus,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      decision: 'approved',
      gate: gateStep,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Gate decision failed', details: message },
      { status: 500 }
    );
  }
}
