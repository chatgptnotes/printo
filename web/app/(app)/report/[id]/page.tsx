"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

export default function ReportPage({ params }: { params: { id: string } }) {
  const isProject = params.id === "project";
  const htmlSrc = isProject ? "/api/report/project" : `/api/report/${params.id}`;
  const pdfSrc = isProject ? "/api/report/project/pdf" : `/api/report/${params.id}/pdf`;
  const pdfName = isProject ? "printo_project_report.pdf" : `printo_report_${params.id}.pdf`;
  const [nonce, setNonce] = useState(0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-lg font-bold">
          {isProject ? "Project Summary Report" : `Drawing Report #${params.id}`}
        </h1>
        <Button variant="secondary" onClick={() => setNonce((n) => n + 1)}>
          🔄 Refresh
        </Button>
        <a href={pdfSrc} download={pdfName} target="_blank" rel="noreferrer">
          <Button variant="primary">⬇️ Download PDF</Button>
        </a>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-white">
        <iframe
          key={nonce}
          src={`${htmlSrc}?v=${nonce}`}
          title="Printo report"
          className="h-[820px] w-full"
        />
      </div>
    </div>
  );
}
