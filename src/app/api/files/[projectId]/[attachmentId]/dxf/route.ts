import { NextRequest, NextResponse } from 'next/server';
import DxfParser from 'dxf-parser';
import { requireAuth } from '@/lib/shared/api-auth';
import { resolveAttachmentBinary } from '@/lib/drawing/file-resolver';

export const dynamic = 'force-dynamic';

interface Point { x: number; y: number; }
interface Bounds { minX: number; minY: number; maxX: number; maxY: number; }

function expandBounds(b: Bounds, p: Point) {
  if (p.x < b.minX) b.minX = p.x;
  if (p.y < b.minY) b.minY = p.y;
  if (p.x > b.maxX) b.maxX = p.x;
  if (p.y > b.maxY) b.maxY = p.y;
}

// Render DXF entities as SVG paths.
// Supports the most common 2D entities: LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, TEXT, MTEXT.
function dxfToSvg(dxf: { entities: Array<Record<string, unknown>> }): { svg: string; entityCount: number } {
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const elements: string[] = [];
  let entityCount = 0;

  for (const e of dxf.entities || []) {
    const type = e.type as string;
    const layer = (e.layer as string) || 'default';
    const stroke = '#1e293b';
    const strokeWidth = 0.4;

    try {
      if (type === 'LINE') {
        const v = e.vertices as Point[];
        if (v && v.length >= 2) {
          expandBounds(bounds, v[0]);
          expandBounds(bounds, v[1]);
          elements.push(
            `<line x1="${v[0].x}" y1="${v[0].y}" x2="${v[1].x}" y2="${v[1].y}" stroke="${stroke}" stroke-width="${strokeWidth}" data-layer="${layer}" />`
          );
          entityCount++;
        }
      } else if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
        const v = e.vertices as Point[];
        if (v && v.length > 1) {
          v.forEach((p) => expandBounds(bounds, p));
          const points = v.map((p) => `${p.x},${p.y}`).join(' ');
          const closed = e.shape === true ? 'polygon' : 'polyline';
          elements.push(
            `<${closed} points="${points}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" data-layer="${layer}" />`
          );
          entityCount++;
        }
      } else if (type === 'CIRCLE') {
        const center = e.center as Point;
        const r = e.radius as number;
        if (center && typeof r === 'number') {
          expandBounds(bounds, { x: center.x - r, y: center.y - r });
          expandBounds(bounds, { x: center.x + r, y: center.y + r });
          elements.push(
            `<circle cx="${center.x}" cy="${center.y}" r="${r}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" data-layer="${layer}" />`
          );
          entityCount++;
        }
      } else if (type === 'ARC') {
        const center = e.center as Point;
        const r = e.radius as number;
        const start = ((e.startAngle as number) ?? 0) * (Math.PI / 180);
        const end = ((e.endAngle as number) ?? 0) * (Math.PI / 180);
        if (center && typeof r === 'number') {
          const x1 = center.x + r * Math.cos(start);
          const y1 = center.y + r * Math.sin(start);
          const x2 = center.x + r * Math.cos(end);
          const y2 = center.y + r * Math.sin(end);
          const largeArc = end - start > Math.PI ? 1 : 0;
          expandBounds(bounds, { x: center.x - r, y: center.y - r });
          expandBounds(bounds, { x: center.x + r, y: center.y + r });
          elements.push(
            `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" data-layer="${layer}" />`
          );
          entityCount++;
        }
      } else if (type === 'TEXT' || type === 'MTEXT') {
        const pos = (e.position || e.startPoint) as Point;
        const text = ((e.text as string) || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] || c));
        const height = (e.height as number) || 2;
        if (pos && text) {
          expandBounds(bounds, pos);
          elements.push(
            `<text x="${pos.x}" y="${-pos.y}" font-size="${height}" fill="#0f172a" font-family="Arial,sans-serif" transform="scale(1,-1)">${text}</text>`
          );
          entityCount++;
        }
      }
    } catch { /* skip malformed entity */ }
  }

  if (!isFinite(bounds.minX)) {
    bounds.minX = 0; bounds.minY = 0; bounds.maxX = 100; bounds.maxY = 100;
  }
  // Add padding
  const padX = (bounds.maxX - bounds.minX) * 0.05 || 5;
  const padY = (bounds.maxY - bounds.minY) * 0.05 || 5;
  const vbX = bounds.minX - padX;
  const vbY = bounds.minY - padY;
  const vbW = (bounds.maxX - bounds.minX) + 2 * padX;
  const vbH = (bounds.maxY - bounds.minY) + 2 * padY;

  // DXF Y is bottom-up; SVG Y is top-down. Flip vertically using a group transform.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;background:#f8fafc">
  <g transform="scale(1,-1) translate(0,${-(2 * vbY + vbH)})">
    ${elements.join('\n    ')}
  </g>
</svg>`;

  return { svg, entityCount };
}

// GET: Parse a DXF attachment to SVG for inline rendering
export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string; attachmentId: string } }
) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const result = await resolveAttachmentBinary(params.projectId, params.attachmentId);
  if ('error' in result) {
    return NextResponse.json(result.error, { status: result.status });
  }

  try {
    const text = result.buffer.toString('utf-8');
    const parser = new DxfParser();
    const dxf = parser.parseSync(text);
    if (!dxf) {
      return NextResponse.json({ error: 'DXF parser returned null' }, { status: 500 });
    }
    const { svg, entityCount } = dxfToSvg(dxf as unknown as { entities: Array<Record<string, unknown>> });
    return NextResponse.json({
      filename: result.filename,
      svg,
      entityCount,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'DXF parse failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
