'use client';

import { ArrowLeft, User, Star, FileText } from 'lucide-react';

export function DocToolbar() {
  return (
    <div className="fixed left-4 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-50">
      <a
        href="/projects"
        className="w-10 h-10 flex items-center justify-center rounded-full bg-white shadow-md border border-[var(--color-border)] hover:shadow-lg transition-shadow"
      >
        <ArrowLeft className="w-4 h-4 text-[var(--color-text)]" />
      </a>
      <button className="w-10 h-10 flex items-center justify-center rounded-full bg-white shadow-md border border-[var(--color-border)] hover:shadow-lg transition-shadow">
        <User className="w-4 h-4 text-[var(--color-text)]" />
      </button>
      <button className="w-10 h-10 flex items-center justify-center rounded-full bg-white shadow-md border border-[var(--color-border)] hover:shadow-lg transition-shadow">
        <Star className="w-4 h-4 text-[var(--color-text)]" />
      </button>
      <button className="w-10 h-10 flex items-center justify-center rounded-full bg-white shadow-md border border-[var(--color-border)] hover:shadow-lg transition-shadow">
        <FileText className="w-4 h-4 text-[var(--color-text)]" />
      </button>
    </div>
  );
}
