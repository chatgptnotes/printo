import { BarChart3, TrendingUp, PieChart, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';

export default function AnalyticsPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4">
      {/* Illustration using Lucide icons */}
      <div className="relative mb-8">
        <div className="w-24 h-24 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center">
          <BarChart3 className="h-12 w-12 text-blue-400" />
        </div>
        <div className="absolute -top-2 -right-2 w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center">
          <TrendingUp className="h-4 w-4 text-indigo-400" />
        </div>
        <div className="absolute -bottom-2 -left-2 w-8 h-8 rounded-lg bg-purple-50 border border-purple-100 flex items-center justify-center">
          <PieChart className="h-4 w-4 text-purple-400" />
        </div>
      </div>

      {/* Content */}
      <div className="text-center max-w-md">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 border border-blue-100 rounded-full mb-4">
          <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Coming Soon</span>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-3">Analytics & Reports</h1>

        <p className="text-gray-500 text-sm leading-relaxed mb-6">
          Gain insights into your bid pipeline — win rates, estimation accuracy, revenue trends,
          and service mix breakdown across all your MEP projects.
        </p>

        {/* Feature preview list */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-8 text-left space-y-2.5">
          {[
            { icon: BarChart3, text: 'Monthly bid volume and win/loss rate tracking' },
            { icon: TrendingUp, text: 'Estimation vs. actual cost comparison over time' },
            { icon: PieChart, text: 'Service mix breakdown by building type and region' },
            { icon: ArrowUpRight, text: 'Revenue forecast from active pipeline' },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded bg-white border border-gray-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Icon className="h-3 w-3 text-gray-400" />
              </div>
              <p className="text-xs text-gray-600">{text}</p>
            </div>
          ))}
        </div>

        <Link
          href="/bids"
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
        >
          Back to Bid List
        </Link>
      </div>
    </div>
  );
}
