// Shared FAQ content — consumed by the visible FAQ section (page.tsx)
// and the FAQPage structured data (layout.tsx) so the two never drift.
export const faqs = [
  {
    question: 'What is ERP Realsoft?',
    answer:
      'ERP Realsoft is an automated MEP estimation pipeline built for contractors and consultants in Dubai and the wider UAE. It turns an incoming RFQ (Request for Quotation) email and its attached drawings into a priced Excel Bill of Quantities (BOQ) — covering electrical, HVAC, plumbing and fire-fighting works — without the weeks of manual take-off that traditional estimating requires.',
  },
  {
    question: 'How does the RFQ-to-BOQ pipeline work?',
    answer:
      'The pipeline runs in 23 automated steps. It monitors your estimation inbox, classifies each email as an RFQ and assigns a bid priority, then extracts the project profile — number of floors, built-up area, ceiling heights and location. It inventories the drawing set, scopes the MEP services to price, calculates loads and quantities with engineering formulas, validates the result against UAE market rates, and finally generates a formatted Excel BOQ ready for your one-click approval and dispatch.',
  },
  {
    question: 'Which MEP disciplines can ERP Realsoft estimate?',
    answer:
      'ERP Realsoft prices every major MEP discipline in a single run: HVAC and mechanical, electrical (load schedules, cable sizing and MDB/SMDB counts), plumbing and drainage, fire-fighting systems, BMS integration and ELV systems. Each discipline is estimated with discipline-specific formulas rather than generic averages, so the quantities reflect the actual building parameters in the drawings.',
  },
  {
    question: 'How accurate are the automated estimates?',
    answer:
      'Estimates are produced with deterministic engineering formulas — ASHRAE-based thermal loads, fixture and pipe schedules, cable sizing and equipment counts — not opaque AI guesses, so every number is traceable back to its inputs. Across benchmark projects, ERP Realsoft reaches roughly 95% accuracy against the final issued BOQ, and each estimate is cross-checked against current Dubai and UAE market rates (AED per square foot) to flag outliers before submission.',
  },
  {
    question: 'How long does it take to produce a BOQ?',
    answer:
      'A manual MEP estimate typically takes one to two weeks of engineer time. ERP Realsoft compresses that to hours: inbox monitoring is real-time, RFQ data is extracted instantly, drawing review takes under five minutes, and load calculations that would consume two to three days of engineering effort complete in under an hour. Most projects move from RFQ email to a client-ready BOQ in about two days, including human review.',
  },
  {
    question: 'Is ERP Realsoft built specifically for the Dubai and UAE market?',
    answer:
      'Yes. ERP Realsoft is engineered for MEP contracting in the UAE, not adapted from a generic global tool. HVAC loads are calculated for the Dubai climate, pricing is benchmarked against a yardstick database of current UAE market rates, and all quantities and totals are expressed in AED so quotations are submission-ready for local consultants and clients.',
  },
  {
    question: 'What drawings and file formats can it read?',
    answer:
      'The pipeline ingests the attachments that arrive with a typical RFQ — compressed archives are unzipped automatically, and the drawing set is inventoried and classified into architectural, structural and MEP categories. From there it identifies the relevant MEP sheets and reads the geometry and schedules needed to calculate quantities, so estimators no longer spend hours sorting and interpreting files by hand.',
  },
  {
    question: 'Can I review and adjust the estimate before it is sent?',
    answer:
      'Always. ERP Realsoft is built around confirmation gates: the automated pipeline prepares the full estimate and BOQ, but nothing is sent to a client until a human approves it. You can review extracted data, calculated quantities and yardstick comparisons, make adjustments where your judgement differs, and only then release the formatted Excel BOQ for dispatch.',
  },
]
