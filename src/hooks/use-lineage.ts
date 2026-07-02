'use client';

/**
 * React hook to fetch and cache the lineage map for a project.
 *
 * Caches per-project in a module-level Map so multiple <FieldSource>
 * components on the same page share a single fetch.
 *
 * Usage:
 *   const { lineage, loading } = useLineage(projectId);
 *   const entry = lineage?.project?.['floors'];
 */

import { useEffect, useState } from 'react';
import type { LineageEntry } from '@/lib/pipeline/lineage';

export interface LineagePayload {
  project_id: string;
  project: Record<string, LineageEntry>;
  services: Array<{
    id: string;
    service_type: string;
    lineage: Record<string, LineageEntry>;
  }>;
  spec: Record<string, LineageEntry>;
  attachments: Array<{
    id: string;
    filename: string;
    lineage: Record<string, LineageEntry>;
  }>;
  boq: Record<string, LineageEntry>;
}

const cache = new Map<string, LineagePayload>();
const inflight = new Map<string, Promise<LineagePayload>>();

async function fetchLineage(projectId: string): Promise<LineagePayload> {
  if (cache.has(projectId)) return cache.get(projectId)!;
  if (inflight.has(projectId)) return inflight.get(projectId)!;

  const promise = fetch(`/api/projects/${projectId}/lineage`, {
    credentials: 'include',
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`lineage fetch failed: ${res.status}`);
      const data = (await res.json()) as LineagePayload;
      cache.set(projectId, data);
      inflight.delete(projectId);
      return data;
    })
    .catch((err) => {
      inflight.delete(projectId);
      throw err;
    });

  inflight.set(projectId, promise);
  return promise;
}

/** Invalidate the cached lineage for a project — call after manual edits. */
export function invalidateLineage(projectId: string): void {
  cache.delete(projectId);
  inflight.delete(projectId);
}

/**
 * Batch hook — fetches lineage for many projects in one call and seeds the
 * shared cache. Used by the bid list page so per-row <FieldSource> chips can
 * read from the same cache as <FieldSource> on the detail page.
 */
let batchInflight: Promise<Record<string, LineagePayload>> | null = null;
let batchInflightKey = '';

async function fetchBatchLineage(projectIds: string[]): Promise<Record<string, LineagePayload>> {
  // Filter out already-cached IDs
  const missing = projectIds.filter((id) => !cache.has(id));
  if (missing.length === 0) {
    const result: Record<string, LineagePayload> = {};
    for (const id of projectIds) {
      const cached = cache.get(id);
      if (cached) result[id] = cached;
    }
    return result;
  }

  // Reuse in-flight batch if same keys
  const key = missing.sort().join(',');
  if (batchInflightKey === key && batchInflight) {
    return batchInflight;
  }

  batchInflightKey = key;
  // Chunk into ≤500-id batches — the route's MAX_BATCH guard returns 400
  // for larger calls. Without chunking, a bid list with 500+ projects
  // (heavy testing accounts) fires an endless 400 loop.
  const BATCH_SIZE = 500;
  const chunks: string[][] = [];
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    chunks.push(missing.slice(i, i + BATCH_SIZE));
  }
  batchInflight = Promise.all(
    chunks.map((chunk) =>
      fetch('/api/projects/lineage/batch', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_ids: chunk }),
      }).then(async (res) => {
        if (!res.ok) throw new Error(`batch lineage failed: ${res.status}`);
        return (await res.json()) as Record<string, LineagePayload>;
      })
    )
  )
    .then((parts) => {
      const data: Record<string, LineagePayload> = {};
      for (const part of parts) Object.assign(data, part);
      for (const [id, payload] of Object.entries(data)) cache.set(id, payload);
      batchInflight = null;
      batchInflightKey = '';
      return data;
    })
    .catch((err) => {
      batchInflight = null;
      batchInflightKey = '';
      throw err;
    });

  return batchInflight;
}

export function useBatchLineage(projectIds: string[]) {
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (projectIds.length === 0) return;
    let cancelled = false;
    fetchBatchLineage(projectIds)
      .then(() => {
        if (!cancelled) setVersion((v) => v + 1);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
    // join into a stable string key so changing array order doesn't refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIds.join(',')]);

  return { ready: version > 0, error };
}

export function useLineage(projectId: string | null) {
  const [lineage, setLineage] = useState<LineagePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    setLoading(true);
    fetchLineage(projectId)
      .then((data) => {
        if (!cancelled) {
          setLineage(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return { lineage, loading, error };
}
