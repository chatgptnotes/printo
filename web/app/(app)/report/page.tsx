import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function ReportIndex() {
  return (
    <div className="space-y-4">
      <p className="text-muted">No drawing selected to report on.</p>
      <div className="flex gap-3">
        <Link href="/history">
          <Button variant="primary">Open History</Button>
        </Link>
        <Link href="/report/project">
          <Button variant="secondary">📊 Project Summary Report</Button>
        </Link>
      </div>
    </div>
  );
}
