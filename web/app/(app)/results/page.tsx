import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function ResultsIndex() {
  return (
    <div className="space-y-4">
      <p className="text-muted">No drawing selected. Process one first, or pick from History.</p>
      <div className="flex gap-3">
        <Link href="/">
          <Button variant="primary">Upload a drawing</Button>
        </Link>
        <Link href="/history">
          <Button variant="secondary">Open History</Button>
        </Link>
      </div>
    </div>
  );
}
