'use client';

import { statusColor, statusLabel, priorityColor } from '@/lib/shared/utils';
import { PRIORITY_LABELS } from '@/lib/shared/constants';

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor(status)}`}>
      {statusLabel(status)}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${priorityColor(priority)}`}>
      {PRIORITY_LABELS[priority] || priority}
    </span>
  );
}
