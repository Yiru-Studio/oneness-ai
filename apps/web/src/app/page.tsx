'use client';

import { useState } from 'react';
import { LoginModal } from '@/components/modals/LoginModal';
import { FloatingKnowledgeButton } from '@/components/layout/FloatingKnowledgeButton';
import { ParticleBackground } from '@/components/home/ParticleBackground';
import { Play } from 'lucide-react';

export default function HomePage() {
  const [showLogin, setShowLogin] = useState(false);

  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">
      <ParticleBackground />

      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-8 py-5 z-10">
        <div className="flex items-center gap-2">
          <img src="/yiru_logo_bw.png" alt="一如创影" width={28} height={28} className="object-contain" />
          <span className="text-lg font-semibold">一如创影</span>
        </div>
        <button
          onClick={() => setShowLogin(true)}
          className="text-sm text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors"
        >
          登录
        </button>
      </div>

      <div className="relative z-10 text-center">
        <h1 className="text-5xl font-bold tracking-tight mb-3">
          一如创影
        </h1>
        <p className="text-lg text-[var(--color-text-secondary)] mb-8">
          专业 AI 影视创作
        </p>
        <button
          onClick={() => setShowLogin(true)}
          className="inline-flex items-center gap-2 bg-[var(--color-primary)] text-white px-8 py-3.5 rounded-full font-medium hover:bg-[var(--color-primary-hover)] hover:scale-105 transition-all shadow-lg shadow-blue-500/25"
        >
          <span>立即创作</span>
          <Play className="w-4 h-4 fill-current" />
        </button>
      </div>

      <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
      <FloatingKnowledgeButton />
    </main>
  );
}
