'use client';

import React from 'react';
import {
  Tag, Building2, Wrench, Calculator, Ruler, FileSpreadsheet,
  Send, CheckCircle, ShieldAlert, Trophy, Zap, ArrowRight, X, AlertTriangle,
} from 'lucide-react';
import { ProjectDetail } from '@/lib/shared/types';
import { getNextAction } from './command-bar';
import { formatAED, statusToStep } from '@/lib/shared/utils';
import { GATE_STEPS } from '@/lib/shared/constants';

interface NextActionBannerProps {
  project: ProjectDetail;
  actionLoading: string | null;
  elapsedSeconds: number;
  onRunAction: (action: string) => void | Promise<unknown>;
  onScrollToGate: () => void;
  onGateApprove?: () => void | Promise<void>;
  onGateReject?: (reason: string) => void | Promise<void>;
}

export default function NextActionBanner({
  project, actionLoading, elapsedSeconds,
  onRunAction, onScrollToGate,
}: NextActionBannerProps) {
  const next = getNextAction(project, actionLoading);
  if (!next) return null;

  // Processing state - compact inline banner
  if (next.type === 'processing') {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center gap-3 animate-pulse">
        <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent flex-shrink-0" />
        <p className="text-sm font-medium text-blue-800 flex-1">{next.label}</p>
        <span className="text-xs font-mono text-blue-600">{elapsedSeconds}s</span>
      </div>
    );
  }

  // Gate approval is handled exclusively by the floating ApprovalGateDock
  // (rendered at the bid page root). This banner used to show an inline
  // gate UI here too, which created a duplicate approval box. Returning
  // null leaves the dock as the single source of truth for gate decisions.
  if (next.type === 'gate') {
    return null;
  }

  // Approve quotation
  if (next.type === 'approve') {
    const quote = project.estimation?.final_quote_aed;
    return (
      <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl px-5 py-4 flex items-center gap-4 shadow-sm">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center flex-shrink-0 shadow-md">
          <CheckCircle className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-green-900">Quotation Ready for Approval</p>
          {quote && (
            <p className="text-xs text-green-700 mt-0.5">
              Final quote: <span className="font-bold">{formatAED(quote)}</span>
              {project.estimation?.yardstick_status === 'within_range' && ' — within market range'}
            </p>
          )}
        </div>
        <button
          onClick={() => onRunAction('approve')}
          disabled={actionLoading === 'approve'}
          className="px-5 py-2.5 text-sm font-bold text-white bg-gradient-to-r from-green-600 to-emerald-600 rounded-lg hover:from-green-700 hover:to-emerald-700 transition-all shadow-md disabled:opacity-50 flex-shrink-0"
        >
          {actionLoading === 'approve' ? (
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
          ) : (
            'Approve Quotation'
          )}
        </button>
      </div>
    );
  }

  // Send to client
  if (next.type === 'send') {
    const placeholders = project.estimation?.yardstick_placeholders ?? [];
    return (
      <div className="space-y-2">
        {placeholders.length > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex items-start gap-3 shadow-sm">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-amber-900">
                Yardstick used placeholder rates — verify the total before sending
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                The market comparison substituted standard rates for: <span className="font-mono font-semibold">{placeholders.join(', ')}</span>. Real rates were missing or AED 0 for these services.
              </p>
            </div>
          </div>
        )}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl px-5 py-4 flex items-center gap-4 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-md">
            <Send className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-blue-900">Approved! Ready to send to client</p>
            <p className="text-xs text-blue-700 mt-0.5">
              {project.client_name || project.email_from}
            </p>
          </div>
          <button
            onClick={() => onRunAction('send-quote')}
            disabled={actionLoading === 'send-quote'}
            className="px-5 py-2.5 text-sm font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md disabled:opacity-50 flex-shrink-0"
          >
            {actionLoading === 'send-quote' ? (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
            ) : (
              'Send to Client'
            )}
          </button>
        </div>
      </div>
    );
  }

  // Won/Lost
  if (next.type === 'won_lost') {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-4 flex items-center gap-4 shadow-sm">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-400 to-gray-600 flex items-center justify-center flex-shrink-0 shadow-md">
          <Trophy className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">Quotation sent — awaiting result</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {project.client_name || project.email_from}
          </p>
        </div>
      </div>
    );
  }

  // Next pipeline step
  const Icon = next.icon;
  const step = statusToStep(project.status);
  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl px-5 py-4 flex items-center gap-4 shadow-sm">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-md">
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-blue-900">Next Step — {next.label}</p>
        <p className="text-xs text-blue-600 mt-0.5">Pipeline: step {step} of 23</p>
      </div>
      <button
        onClick={() => onRunAction(next.action)}
        disabled={!!actionLoading}
        className="px-5 py-2.5 text-sm font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md disabled:opacity-50 flex-shrink-0 flex items-center gap-2"
      >
        {next.label}
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}
