// Gauge buckets + live cost computation. Pure — called on every rate-input change.
// GaugeBucket is defined here (buckets live here) and re-exported by ./types.
export type GaugeBucket = 'heavy' | 'submain' | 'final';

// Minimal structural shape computeCost needs — satisfied by SvgPlanModel.
interface CostableModel {
  cables: Array<{ bucket: GaugeBucket; lengthM: number }>;
}

export interface BucketMeta {
  bucket: GaugeBucket;
  label: string;
  hint: string;
  color: string;          // hex, shared with the 3D scene for colour-coding
  defaultRate: number;    // AED per metre
}

// Ordered heavy → final so the cost panel and legend read top-down by gauge.
export const BUCKETS: BucketMeta[] = [
  { bucket: 'heavy', label: 'Heavy Power Lines', hint: '≥ 50 mm² · LV → SMDB feeders', color: '#ef4444', defaultRate: 180 },
  { bucket: 'submain', label: 'Sub-Main Cables', hint: '16–50 mm² · SMDB → DB', color: '#f59e0b', defaultRate: 70 },
  { bucket: 'final', label: 'Final / Outlet Circuits', hint: '< 16 mm² · DB → outlets', color: '#22d3ee', defaultRate: 22 },
];

export const BUCKET_META: Record<GaugeBucket, BucketMeta> =
  BUCKETS.reduce((acc, b) => { acc[b.bucket] = b; return acc; }, {} as Record<GaugeBucket, BucketMeta>);

export type RateMap = Record<GaugeBucket, number>;

export const DEFAULT_RATES: RateMap = {
  heavy: BUCKET_META.heavy.defaultRate,
  submain: BUCKET_META.submain.defaultRate,
  final: BUCKET_META.final.defaultRate,
};

export function bucketFor(sizeMm2: number): GaugeBucket {
  if (sizeMm2 >= 50) return 'heavy';
  if (sizeMm2 >= 16) return 'submain';
  return 'final';
}

export interface BucketCost {
  bucket: GaugeBucket;
  label: string;
  color: string;
  runs: number;
  lengthM: number;
  ratePerM: number;
  amount: number;
}

export interface CostBreakdown {
  byBucket: BucketCost[];
  totalLengthM: number;
  totalCost: number;
}

export function computeCost(model: CostableModel, rates: RateMap): CostBreakdown {
  const agg: Record<GaugeBucket, { runs: number; lengthM: number }> = {
    heavy: { runs: 0, lengthM: 0 },
    submain: { runs: 0, lengthM: 0 },
    final: { runs: 0, lengthM: 0 },
  };

  for (const c of model.cables) {
    agg[c.bucket].runs += 1;
    agg[c.bucket].lengthM += c.lengthM;
  }

  const byBucket: BucketCost[] = BUCKETS.map((b) => {
    const ratePerM = rates[b.bucket] ?? b.defaultRate;
    const lengthM = agg[b.bucket].lengthM;
    return {
      bucket: b.bucket,
      label: b.label,
      color: b.color,
      runs: agg[b.bucket].runs,
      lengthM,
      ratePerM,
      amount: lengthM * ratePerM,
    };
  });

  return {
    byBucket,
    totalLengthM: byBucket.reduce((s, b) => s + b.lengthM, 0),
    totalCost: byBucket.reduce((s, b) => s + b.amount, 0),
  };
}
