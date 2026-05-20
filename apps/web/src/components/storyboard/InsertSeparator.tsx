'use client';

import { Plus } from 'lucide-react';

/**
 * Sits between two shots and exposes an "insert new shot here" affordance.
 * Mirrors likeai's `.insert-separator` UI.
 */
export function InsertSeparator({
  onInsert,
  disabled,
}: {
  onInsert: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative h-6 flex items-center my-1 group">
      <div className="absolute inset-x-12 top-1/2 h-px bg-[var(--color-border)] opacity-0 group-hover:opacity-100 transition-opacity" />
      <button
        onClick={onInsert}
        disabled={disabled}
        title="在此处插入新分镜"
        className="mx-auto w-6 h-6 rounded-full bg-white border border-[var(--color-border)] flex items-center justify-center text-gray-400 hover:text-[var(--color-primary)] hover:border-[var(--color-primary)] shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
