'use client';

/**
 * EmailBodyFrame — renders raw Gmail/Outlook HTML inside a sandboxed iframe.
 *
 * Why not `dangerouslySetInnerHTML`?
 *   Email HTML routinely carries `<style>` blocks, table `bgcolor` hacks, and
 *   legacy `font` tags that leak into the parent document's CSS. Dumping it
 *   directly into a `<div class="prose">` makes paragraphs render as solid
 *   black bars (Outlook) or inherit dark-mode styles from the host page.
 *
 * The iframe gives us:
 *   - Complete CSS isolation (email styles can't touch the rest of the app)
 *   - Automatic XSS containment via `sandbox` (no script execution)
 *   - Auto-height fit via a tiny post-load measurement
 */
import { useEffect, useRef, useState } from 'react';

interface Props {
  html: string;
  className?: string;
}

const BASE_STYLES = `
  html, body {
    margin: 0;
    padding: 12px 4px;
    background: #ffffff;
    color: #111827;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.55;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  img { max-width: 100%; height: auto; }
  table { max-width: 100% !important; }
  a { color: #0E8A5F; }
  blockquote {
    border-left: 3px solid #D4DCE6;
    margin: 8px 0;
    padding: 4px 12px;
    color: #5B6470;
  }
  pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
`;

export default function EmailBodyFrame({ html, className = '' }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  const srcDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>${BASE_STYLES}</style></head><body>${html || ''}</body></html>`;

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;

    const measure = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        const h = Math.max(
          doc.body.scrollHeight,
          doc.documentElement.scrollHeight,
        );
        setHeight(h + 8);
      } catch {
        // cross-origin — shouldn't happen with srcDoc, but fail quietly
      }
    };

    const onLoad = () => {
      measure();
      // Re-measure once images load, since they usually resolve after the
      // initial `load` event fires.
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          Array.from(doc.images).forEach(img => {
            if (!img.complete) img.addEventListener('load', measure, { once: true });
          });
        }
      } catch { /* noop */ }
    };

    iframe.addEventListener('load', onLoad);
    return () => iframe.removeEventListener('load', onLoad);
  }, [srcDoc]);

  return (
    <iframe
      ref={ref}
      srcDoc={srcDoc}
      sandbox="allow-same-origin allow-popups"
      title="Email body"
      className={`w-full border-0 ${className}`}
      style={{ height }}
    />
  );
}
