"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Segment-level error boundary for the authenticated app. Catches client-side
 * render errors in any (app) page and shows a recoverable UI inside the shell,
 * instead of React's bare full-page "client-side exception" screen.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/error] ", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <h2 className="text-xl font-bold">Something went wrong</h2>
      <p className="max-w-md text-sm text-muted">
        {error?.message || "An unexpected error occurred while rendering this page."}
      </p>
      <Button variant="primary" onClick={() => reset()}>
        Try again
      </Button>
    </div>
  );
}
