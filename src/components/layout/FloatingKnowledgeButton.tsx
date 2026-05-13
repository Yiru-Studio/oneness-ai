'use client';

import { useState } from 'react';
import { FileText } from 'lucide-react';

export function FloatingKnowledgeButton() {
  const [showLabel, setShowLabel] = useState(false);

  return (
    <a
      href="/knowledge-base"
      className="fixed bottom-6 right-6 z-[9999] flex items-center gap-2"
      onMouseEnter={() => setShowLabel(true)}
      onMouseLeave={() => setShowLabel(false)}
    >
      {showLabel && (
        <span className="bg-gray-800 text-white text-xs px-3 py-1.5 rounded-lg whitespace-nowrap">
          知识库
        </span>
      )}
      <div className="w-12 h-12 rounded-full bg-white shadow-lg border border-[var(--color-border)] flex items-center justify-center hover:shadow-xl transition-shadow">
        <FileText className="w-5 h-5 text-[var(--color-text)]" />
      </div>
    </a>
  );
}
