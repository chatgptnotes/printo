export function fmtVal(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "boolean") return val ? "✅ Yes" : "✗ No";
  if (Array.isArray(val)) return val.length ? val.map(String).join(", ") : "—";
  if (typeof val === "object") return JSON.stringify(val);
  const s = String(val).trim();
  return s === "" ? "—" : s;
}

export interface HeatColor {
  bg: string;
  border: string;
  text: string;
}

export function heatColor(c: number | null | undefined): HeatColor {
  if (c === null || c === undefined)
    return { bg: "rgba(148,163,184,.10)", border: "#1e2d4a", text: "#94a3b8" };
  if (c >= 0.85)
    return { bg: "rgba(16,185,129,.14)", border: "rgba(16,185,129,.45)", text: "#6ee7b7" };
  if (c >= 0.6)
    return { bg: "rgba(245,158,11,.14)", border: "rgba(245,158,11,.45)", text: "#fcd34d" };
  return { bg: "rgba(220,38,38,.14)", border: "rgba(220,38,38,.45)", text: "#fca5a5" };
}

export function confPct(c: number | null | undefined): string {
  if (c === null || c === undefined) return "N/A";
  return `${Math.round(c * 100)}%`;
}

export function roomRow(r: { name?: string; area?: string } | string): [string, string] {
  if (typeof r === "string") return [r, "—"];
  if (r && typeof r === "object") return [r.name || "—", r.area || "—"];
  return [String(r), "—"];
}
