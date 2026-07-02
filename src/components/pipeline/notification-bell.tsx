'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Bell, AlertTriangle, CheckCircle, XCircle, Clock, Mail } from 'lucide-react';
import { timeAgo } from '@/lib/shared/utils';

interface Notification {
  id: string;
  project_id: string;
  project_name: string;
  step_name: string;
  status: string;
  created_at: string;
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState<string>('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('realsoft-notif-seen') || '';
    setLastSeen(saved);
    fetchNotifications();
    // Poll every 5 min (raised from 2 min — notifications aren't urgent and
    // the previous cadence was contributing measurable Supabase egress).
    // Tab refocus still triggers an immediate refresh below, so the user
    // gets fresh data the moment they switch back.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchNotifications();
    }, 300000);
    // Immediate refresh when the tab comes back into focus.
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchNotifications();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchNotifications = async () => {
    try {
      const res = await fetch('/api/activity?limit=15');
      const data = await res.json();
      setNotifications(data.activities || []);
    } catch { /* silent */ }
  };

  const markSeen = () => {
    if (notifications.length > 0) {
      const latest = notifications[0].created_at;
      setLastSeen(latest);
      localStorage.setItem('realsoft-notif-seen', latest);
    }
  };

  const unreadCount = lastSeen
    ? notifications.filter(n => n.created_at > lastSeen).length
    : notifications.length;

  const getIcon = (stepName: string, status: string) => {
    if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    if (stepName.toLowerCase().includes('email') || stepName.toLowerCase().includes('scan')) return <Mail className="h-3.5 w-3.5 text-blue-500" />;
    if (stepName.toLowerCase().includes('approve') || stepName.toLowerCase().includes('consent')) return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
    if (stepName.toLowerCase().includes('gate') || stepName.toLowerCase().includes('reject')) return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
    return <Clock className="h-3.5 w-3.5 text-gray-400" />;
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(!open); if (!open) markSeen(); }}
        className="relative p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center min-w-[18px] px-1">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] sm:w-80 max-w-sm bg-white rounded-xl border border-gray-200 shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">Notifications</h3>
            <span className="text-[10px] text-gray-400">{notifications.length} recent</span>
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
            {notifications.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-xs">No activity yet</div>
            ) : (
              notifications.map(n => {
                const isUnread = !lastSeen || n.created_at > lastSeen;
                return (
                  <Link
                    key={n.id}
                    href={`/bids/${n.project_id}`}
                    onClick={() => setOpen(false)}
                    className={`flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${isUnread ? 'bg-blue-50/50' : ''}`}
                  >
                    <div className="mt-0.5">{getIcon(n.step_name, n.status)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{n.step_name}</p>
                      <p className="text-[10px] text-gray-400 truncate">{n.project_name}</p>
                    </div>
                    <span className="text-[10px] text-gray-400 flex-shrink-0">{timeAgo(n.created_at)}</span>
                  </Link>
                );
              })
            )}
          </div>
          <Link href="/bids" onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-center text-xs text-blue-600 hover:bg-blue-50 border-t border-gray-100 font-medium">
            View All Projects
          </Link>
        </div>
      )}
    </div>
  );
}
