"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** If provided, called with the caught error to render the fallback. */
  fallbackRender?: (error: Error) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Minimal client-side error boundary. Wrap fragile subtrees (e.g. the WebGL
 * hero) so a render-time throw degrades to a fallback instead of crashing the
 * whole page with React's generic "client-side exception" screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: unknown) {
    // Non-fatal: the fallback renders instead. Logged for diagnostics.
    console.error("[ErrorBoundary] caught:", error);
  }

  render() {
    const { error } = this.state;
    if (error) {
      if (this.props.fallbackRender) return this.props.fallbackRender(error);
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}
