'use client';

export function EmptyState({ message = '暂无文档' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="w-32 h-32 mb-4 opacity-20">
        <svg viewBox="0 0 128 128" fill="none" className="w-full h-full">
          <rect x="24" y="16" width="80" height="96" rx="6" stroke="currentColor" strokeWidth="2" />
          <line x1="40" y1="42" x2="88" y2="42" stroke="currentColor" strokeWidth="2" />
          <line x1="40" y1="58" x2="88" y2="58" stroke="currentColor" strokeWidth="2" />
          <line x1="40" y1="74" x2="72" y2="74" stroke="currentColor" strokeWidth="2" />
        </svg>
      </div>
      <span className="text-[var(--color-text-secondary)]">{message}</span>
    </div>
  );
}
