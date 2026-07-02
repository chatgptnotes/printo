'use client';

/**
 * Swallows the @supabase/realtime-js stack-overflow rejection that fires
 * during channel teardown. The SDK builds a leave message whose payload
 * contains a circular reference; JSON.stringify throws RangeError. The
 * rejection happens inside the SDK's internal Promise (not the one returned
 * by removeChannel), so per-call .catch() handlers can't intercept it.
 *
 * We filter on the exact message + stack-frame signature so unrelated
 * RangeErrors (genuine app bugs) still surface.
 */
import { useEffect } from 'react';

const SDK_STACK_HINT = '/realtime-js/';

export default function RealtimeErrorSwallow() {
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      if (!(reason instanceof RangeError)) return;
      if (!/Maximum call stack size exceeded/i.test(reason.message)) return;
      const stack = reason.stack || '';
      // Only swallow if the stack mentions a realtime-js frame OR the bundled
      // chunk markers we know come from the SDK (unsubscribe/removeChannel).
      if (stack.includes(SDK_STACK_HINT) || /unsubscribe|removeChannel/.test(stack)) {
        event.preventDefault();
      }
    };
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
  }, []);
  return null;
}
