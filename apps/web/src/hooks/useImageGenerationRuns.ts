'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildApiUrl, readAuthToken } from '@/lib/api-client';
import { getImageGenerationRuns, type ImageGenerationRun } from '@/lib/api';

type Options = {
  activeOnly?: boolean;
  limit?: number;
  enabled?: boolean;
};

export function useImageGenerationRuns(
  projectId: string,
  { activeOnly = true, limit = 100, enabled = true }: Options = {},
) {
  const [runs, setRuns] = useState<ImageGenerationRun[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled || !projectId) {
      return;
    }
    const controller = new AbortController();
    let pollingTimer: number | null = null;
    let stopped = false;

    const startPolling = () => {
      if (pollingTimer !== null || stopped) return;
      const poll = async () => {
        try {
          setRuns(await getImageGenerationRuns(projectId, { activeOnly, limit }));
        } catch {
          // Keep the last known snapshot; UI-level refresh paths still work.
        }
      };
      void poll();
      pollingTimer = window.setInterval(() => void poll(), 3000);
    };

    const connect = async () => {
      try {
        const token = readAuthToken();
        const response = await fetch(buildApiUrl('/api/image-generation-runs/events', {
          projectId,
          activeOnly,
          limit,
        }), {
          headers: token ? { authorization: `Bearer ${token}` } : undefined,
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error('events unavailable');
        setConnected(true);
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() ?? '';
          for (const chunk of chunks) {
            const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
            if (!dataLine) continue;
            const parsed = JSON.parse(dataLine.slice(6)) as ImageGenerationRun[];
            if (Array.isArray(parsed)) setRuns(parsed);
          }
        }
      } catch {
        setConnected(false);
        startPolling();
      }
    };

    void connect();
    return () => {
      stopped = true;
      controller.abort();
      if (pollingTimer !== null) window.clearInterval(pollingTimer);
    };
  }, [activeOnly, enabled, limit, projectId]);

  const byOwner = useMemo(() => {
    const map = new Map<string, ImageGenerationRun>();
    for (const run of runs) {
      if (!run.ownerEntityKind || !run.ownerEntityId) continue;
      map.set(`${run.ownerEntityKind}:${run.ownerEntityId}`, run);
    }
    return map;
  }, [runs]);

  return { runs, byOwner, connected };
}
