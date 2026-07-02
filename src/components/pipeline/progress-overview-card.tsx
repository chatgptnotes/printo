'use client';

import { ShieldCheck, CheckCircle, XCircle, Activity } from 'lucide-react';

interface ProgressOverviewProps {
  total: number;
  other: number;
  completedActivities: number;
  failedActivities: number;
  inProgressCount: number;
}

export default function ProgressOverviewCard({
  total,
  other,
  completedActivities,
  failedActivities,
  inProgressCount,
}: ProgressOverviewProps) {
  const healthPercent = total > 0 ? Math.round(((total - other) / total) * 100) : 100;
  const isFullHealth = healthPercent === 100;

  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm ${
        isFullHealth ? 'bg-emerald-50/90 border-emerald-200' : 'bg-sky-50/90 border-sky-200'
      }`}
    >
      <div className="flex items-start gap-3">
        <ShieldCheck
          className={`h-5 w-5 mt-0.5 flex-shrink-0 ${
            isFullHealth ? 'text-green-600' : 'text-blue-600'
          }`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2
              className={`text-sm font-semibold ${
                isFullHealth ? 'text-green-800' : 'text-blue-800'
              }`}
            >
              System Health: {healthPercent}%
            </h2>
          </div>
          <p
            className={`text-xs mt-1 ${
              isFullHealth ? 'text-green-700' : 'text-blue-700'
            }`}
          >
            {isFullHealth
              ? 'All projects tracked across pipeline stages.'
              : `${other} project${other !== 1 ? 's' : ''} in transitional statuses.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            <span className="inline-flex items-center gap-1 text-gray-700">
              <CheckCircle className="h-3 w-3 text-green-600" />
              {completedActivities} steps completed
            </span>
            <span className="inline-flex items-center gap-1 text-gray-700">
              <XCircle className="h-3 w-3 text-red-500" />
              {failedActivities} steps failed
            </span>
            <span className="inline-flex items-center gap-1 text-gray-700">
              <Activity className="h-3 w-3 text-blue-600" />
              {inProgressCount} bids actively processing
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
