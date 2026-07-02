'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { StatusBadge } from '@/components/ui/status-badge';

interface ProjectDeadline {
  id: string;
  project_name: string | null;
  email_subject: string;
  client_name: string | null;
  deadline: string;
  status: string;
  priority: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function CalendarPage() {
  const [projects, setProjects] = useState<ProjectDeadline[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(d => {
        const withDeadlines = (d.projects || []).filter((p: any) => p.deadline);
        setProjects(withDeadlines);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1); }
    else setCurrentMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1); }
    else setCurrentMonth(m => m + 1);
  };

  // Build calendar grid
  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // Group deadlines by date
  const deadlineMap = new Map<string, ProjectDeadline[]>();
  projects.forEach(p => {
    const d = p.deadline.slice(0, 10);
    if (!deadlineMap.has(d)) deadlineMap.set(d, []);
    deadlineMap.get(d)!.push(p);
  });

  const cells: { day: number; dateStr: string; isToday: boolean; isCurrentMonth: boolean; deadlines: ProjectDeadline[] }[] = [];

  // Previous month padding
  const prevMonthDays = new Date(currentYear, currentMonth, 0).getDate();
  for (let i = firstDay - 1; i >= 0; i--) {
    const day = prevMonthDays - i;
    const m = currentMonth === 0 ? 12 : currentMonth;
    const y = currentMonth === 0 ? currentYear - 1 : currentYear;
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({ day, dateStr, isToday: false, isCurrentMonth: false, deadlines: deadlineMap.get(dateStr) || [] });
  }

  // Current month days
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({ day, dateStr, isToday: dateStr === todayStr, isCurrentMonth: true, deadlines: deadlineMap.get(dateStr) || [] });
  }

  // Next month padding to fill 6 rows
  const remaining = 42 - cells.length;
  for (let day = 1; day <= remaining; day++) {
    const m = currentMonth === 11 ? 1 : currentMonth + 2;
    const y = currentMonth === 11 ? currentYear + 1 : currentYear;
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({ day, dateStr, isToday: false, isCurrentMonth: false, deadlines: deadlineMap.get(dateStr) || [] });
  }

  const deadlineColor = (dateStr: string) => {
    const diff = (new Date(dateStr).getTime() - Date.now()) / 864e5;
    if (diff < 0) return 'bg-red-500';
    if (diff <= 7) return 'bg-amber-500';
    return 'bg-green-500';
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Deadline Calendar</h1>
          <p className="text-sm text-gray-500 mt-1">{projects.length} projects with deadlines</p>
        </div>
        <div className="flex items-center gap-1">
          <span className="flex items-center gap-1 text-xs text-gray-400 mr-3">
            <span className="w-2 h-2 rounded-full bg-red-500" /> Overdue
            <span className="w-2 h-2 rounded-full bg-amber-500 ml-2" /> This week
            <span className="w-2 h-2 rounded-full bg-green-500 ml-2" /> Future
          </span>
        </div>
      </div>

      {/* Month navigation */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <button onClick={prevMonth} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <ChevronLeft className="h-5 w-5 text-gray-600" />
          </button>
          <h2 className="text-lg font-bold text-gray-800">{MONTHS[currentMonth]} {currentYear}</h2>
          <button onClick={nextMonth} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <ChevronRight className="h-5 w-5 text-gray-600" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-gray-100">
          {DAYS.map(d => (
            <div key={d} className="px-2 py-2 text-center text-[10px] font-semibold text-gray-400 uppercase">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7">
          {cells.map((cell, i) => (
            <div key={i} className={`min-h-[56px] sm:min-h-[80px] border-b border-r border-gray-50 p-1 sm:p-1.5 ${
              cell.isToday ? 'bg-blue-50' : cell.isCurrentMonth ? 'bg-white' : 'bg-gray-50/50'
            }`}>
              <div className={`text-[10px] sm:text-xs font-medium mb-0.5 sm:mb-1 ${
                cell.isToday ? 'text-blue-600 font-bold' : cell.isCurrentMonth ? 'text-gray-700' : 'text-gray-300'
              }`}>
                {cell.day}
              </div>
              {cell.deadlines.slice(0, 3).map(p => (
                <Link key={p.id} href={`/bids/${p.id}`}
                  className={`block mb-0.5 px-1 sm:px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-medium truncate text-white ${deadlineColor(cell.dateStr)} hover:opacity-80 transition-opacity`}>
                  {p.project_name || p.email_subject}
                </Link>
              ))}
              {cell.deadlines.length > 3 && (
                <span className="text-[8px] sm:text-[9px] text-gray-400 px-1">+{cell.deadlines.length - 3}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
