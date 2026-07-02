'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import Link from 'next/link';

type ToastType = 'success' | 'error' | 'info';

interface ToastAction {
  label: string;
  href: string;
}

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

interface ToastContextValue {
  toasts: Toast[];
  toast: (message: string, type?: ToastType, action?: ToastAction) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  toast: () => {},
  dismiss: () => {},
});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'info', action?: ToastAction) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev, { id, message, type, action }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, action ? 8000 : 4000);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
      {/* Toast container */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
          {toasts.map(t => (
            <div
              key={t.id}
              onClick={() => dismiss(t.id)}
              className={`px-4 py-3 rounded-xl shadow-lg text-sm font-medium cursor-pointer animate-in slide-in-from-right transition-all ${
                t.type === 'success' ? 'bg-green-600 text-white' :
                t.type === 'error' ? 'bg-red-600 text-white' :
                'bg-gray-800 text-white'
              }`}
            >
              {t.type === 'success' && '✓ '}
              {t.type === 'error' && '✗ '}
              {t.message}
              {t.action && (
                <Link
                  href={t.action.href}
                  className="ml-2 underline font-semibold opacity-90 hover:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  {t.action.label}
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
