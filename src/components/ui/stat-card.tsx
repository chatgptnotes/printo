'use client';

import { LucideIcon } from 'lucide-react';

function generateSparklinePath(data: number[]): string {
  const max = Math.max(...data, 1);
  const h = 16;
  const w = 56;
  const step = w / (data.length - 1);
  return data
    .map((v, i) => `${4 + i * step},${18 - (v / max) * h}`)
    .join(' ');
}

interface StatCardProps {
  label: string;
  value: number;
  icon: LucideIcon;
  borderColor: string;
  iconBg: string;
  sparklineData?: number[];
  sparklineColor?: string;
  badge?: React.ReactNode;
  actionSlot?: React.ReactNode;
}

export default function StatCard({
  label,
  value,
  icon: Icon,
  borderColor,
  iconBg,
  sparklineData,
  sparklineColor = '#3b82f6',
  badge,
  actionSlot,
}: StatCardProps) {
  return (
    <div
      className={`bg-white/90 rounded-2xl border border-slate-200/80 border-l-4 ${borderColor} p-4 relative shadow-sm shadow-slate-200/70 hover:-translate-y-0.5 hover:shadow-md hover:shadow-slate-200/80 transition-all duration-200`}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className={`${iconBg} p-1.5 rounded-xl shadow-sm`}>
          <Icon className="h-4 w-4 text-white" />
        </div>
        <span className="text-xs font-medium text-slate-500 flex-1">{label}</span>
        {actionSlot}
      </div>
      <p className="text-2xl font-bold text-slate-950 tracking-tight">{value}</p>
      {sparklineData && sparklineData.length > 1 && (
        <svg
          viewBox="0 0 64 22"
          className="w-16 h-5 mt-1"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <polyline
            points={generateSparklinePath(sparklineData)}
            stroke={sparklineColor}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      )}
      {badge && (
        <div className="absolute top-2 right-2">{badge}</div>
      )}
    </div>
  );
}
