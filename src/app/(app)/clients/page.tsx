'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatAED, timeAgo } from '@/lib/shared/utils';
import { Users, Search, Mail, TrendingUp, ChevronDown, ChevronRight } from 'lucide-react';

interface ClientData {
  email: string;
  name: string;
  projectCount: number;
  totalQuoted: number;
  wonCount: number;
  sentCount: number;
  lastActivity: string;
  projects: { id: string; project_name: string | null; email_subject: string; status: string; final_quote_aed: number | null; created_at: string }[];
}

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedClient, setExpandedClient] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/clients')
      .then(r => r.json())
      .then(d => { setClients(d.clients || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = search
    ? clients.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.email.toLowerCase().includes(search.toLowerCase())
      )
    : clients;

  const totalClients = filtered.length;
  const totalProjects = filtered.reduce((s, c) => s + c.projectCount, 0);
  const totalQuoted = filtered.reduce((s, c) => s + c.totalQuoted, 0);
  const totalWon = filtered.reduce((s, c) => s + c.wonCount, 0);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500 mt-1">{totalClients} clients, {totalProjects} projects</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-3">
          <div className="flex items-center gap-2"><Users className="h-4 w-4 text-blue-600" /><span className="text-[10px] text-gray-500 uppercase">Clients</span></div>
          <p className="text-lg font-bold text-gray-900 mt-1">{totalClients}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3">
          <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-indigo-600" /><span className="text-[10px] text-gray-500 uppercase">Total RFQs</span></div>
          <p className="text-lg font-bold text-gray-900 mt-1">{totalProjects}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3">
          <div className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-green-600" /><span className="text-[10px] text-gray-500 uppercase">Won</span></div>
          <p className="text-lg font-bold text-gray-900 mt-1">{totalWon}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3">
          <div className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-amber-600" /><span className="text-[10px] text-gray-500 uppercase">Total Quoted</span></div>
          <p className="text-lg font-bold text-amber-600 mt-1">{formatAED(totalQuoted)}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input type="text" placeholder="Search clients..." value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {/* Client list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left font-medium text-gray-600 w-8"></th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Client</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">Projects</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600 hidden sm:table-cell">Won</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Total Quoted</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600 hidden md:table-cell">Last Activity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(client => {
              const isExpanded = expandedClient === client.email;
              const winRate = client.sentCount + client.wonCount > 0
                ? Math.round((client.wonCount / (client.sentCount + client.wonCount)) * 100)
                : null;
              return (
                <React.Fragment key={client.email}>
                  <tr className={`hover:bg-gray-50 cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50/30' : ''}`}
                    onClick={() => setExpandedClient(isExpanded ? null : client.email)}>
                    <td className="px-4 py-3">
                      {isExpanded ? <ChevronDown className="h-4 w-4 text-blue-500" /> : <ChevronRight className="h-4 w-4 text-gray-300" />}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{client.name}</p>
                      <p className="text-xs text-gray-400">{client.email}</p>
                    </td>
                    <td className="px-4 py-3 text-center font-medium">{client.projectCount}</td>
                    <td className="px-4 py-3 text-center hidden sm:table-cell">
                      <span className="text-green-600 font-medium">{client.wonCount}</span>
                      {winRate !== null && <span className="text-[10px] text-gray-400 ml-1">({winRate}%)</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-700 tabular-nums">
                      {client.totalQuoted > 0 ? formatAED(client.totalQuoted) : '-'}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-gray-500 hidden md:table-cell">{timeAgo(client.lastActivity)}</td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={6} className="px-8 py-3 bg-gray-50/50">
                        <div className="space-y-1.5">
                          {client.projects.map(p => (
                            <Link key={p.id} href={`/bids/${p.id}`}
                              className="flex items-center justify-between px-3 py-2 bg-white rounded-lg border border-gray-100 hover:border-blue-200 transition-colors">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-gray-800 truncate">{p.project_name || p.email_subject}</p>
                                <p className="text-[10px] text-gray-400">{timeAgo(p.created_at)}</p>
                              </div>
                              <div className="flex items-center gap-3 ml-3">
                                {p.final_quote_aed && <span className="text-xs text-gray-600 tabular-nums">{formatAED(p.final_quote_aed)}</span>}
                                <StatusBadge status={p.status} />
                              </div>
                            </Link>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        </div>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-gray-400 text-sm">No clients found</div>
        )}
      </div>
    </div>
  );
}
