'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * Tracks in-flight image-generation tasks keyed by entity, so spinners can
 * persist across drawer close, tab switch, and card navigation. Errors that
 * happen after the user navigates away are also captured, so reopening the
 * drawer surfaces them.
 *
 * In-session only — state is dropped on page refresh.
 */

export type GenerationKind = 'item' | 'scene' | 'style' | 'character-avatar';

type Key = string;
const keyOf = (kind: GenerationKind, id: string): Key => `${kind}:${id}`;

type Status = { pending: boolean; error: string | null };

interface GenerationContextValue {
  isGenerating: (kind: GenerationKind, id: string) => boolean;
  getError: (kind: GenerationKind, id: string) => string | null;
  clearError: (kind: GenerationKind, id: string) => void;
  runGeneration: <T>(
    kind: GenerationKind,
    id: string,
    fn: () => Promise<T>,
  ) => Promise<T>;
}

const GenerationContext = createContext<GenerationContextValue | null>(null);

export function GenerationProvider({ children }: { children: React.ReactNode }) {
  const [statuses, setStatuses] = useState<Record<Key, Status>>({});
  const inFlightRef = useRef<Record<Key, Promise<unknown>>>({});

  const isGenerating = useCallback(
    (kind: GenerationKind, id: string) =>
      statuses[keyOf(kind, id)]?.pending ?? false,
    [statuses],
  );

  const getError = useCallback(
    (kind: GenerationKind, id: string) =>
      statuses[keyOf(kind, id)]?.error ?? null,
    [statuses],
  );

  const clearError = useCallback((kind: GenerationKind, id: string) => {
    const key = keyOf(kind, id);
    setStatuses((prev) => {
      const cur = prev[key];
      if (!cur || cur.error == null) return prev;
      if (cur.pending) return { ...prev, [key]: { ...cur, error: null } };
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const runGeneration = useCallback(
    async <T,>(
      kind: GenerationKind,
      id: string,
      fn: () => Promise<T>,
    ): Promise<T> => {
      const key = keyOf(kind, id);
      const existing = inFlightRef.current[key] as Promise<T> | undefined;
      if (existing) return existing;

      const promise = Promise.resolve().then(async () => {
        setStatuses((prev) => ({ ...prev, [key]: { pending: true, error: null } }));
        try {
          const result = await fn();
          setStatuses((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          return result;
        } catch (e) {
          const msg = e instanceof Error ? e.message : '生成失败';
          setStatuses((prev) => ({ ...prev, [key]: { pending: false, error: msg } }));
          throw e;
        } finally {
          if (inFlightRef.current[key] === promise) {
            delete inFlightRef.current[key];
          }
        }
      });
      inFlightRef.current[key] = promise;
      return promise;
    },
    [],
  );

  const value = useMemo<GenerationContextValue>(
    () => ({ isGenerating, getError, clearError, runGeneration }),
    [isGenerating, getError, clearError, runGeneration],
  );

  return (
    <GenerationContext.Provider value={value}>
      {children}
    </GenerationContext.Provider>
  );
}

export function useGeneration(): GenerationContextValue {
  const ctx = useContext(GenerationContext);
  if (!ctx) {
    throw new Error('useGeneration must be used within a GenerationProvider');
  }
  return ctx;
}
