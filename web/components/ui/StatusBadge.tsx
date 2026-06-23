const STATUS: Record<string, { label: string; cls: string }> = {
  done: { label: "✅ Done", cls: "bg-result-pass/15 text-[#6ee7b7]" },
  error: { label: "❌ Error", cls: "bg-result-fail/15 text-[#fca5a5]" },
  blurred: { label: "🌫️ Too Blurry", cls: "bg-result-fail/15 text-[#fca5a5]" },
  processing: { label: "⏳ Processing", cls: "bg-accent-blue/15 text-[#93c5fd]" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] || { label: status, cls: "bg-white/10 text-muted" };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>
      {s.label}
    </span>
  );
}
