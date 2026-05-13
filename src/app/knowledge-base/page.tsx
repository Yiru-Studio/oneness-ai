'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { TopBar } from '@/components/layout/TopBar';
import { DocSidebar } from '@/components/knowledge/DocSidebar';
import { DocToolbar } from '@/components/knowledge/DocToolbar';
import { EmptyState } from '@/components/knowledge/EmptyState';

export default function KnowledgeBasePage() {
  const { isLoggedIn, isLoading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('created');

  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.push('/');
    }
  }, [isLoggedIn, isLoading, router]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">加载中...</div>;
  }

  return (
    <div className="min-h-screen bg-white">
      <TopBar />
      <main className="pt-4 flex h-[calc(100vh-64px)]">
        <DocToolbar />
        <div className="ml-16 flex flex-1">
          <DocSidebar activeTab={activeTab} onTabChange={setActiveTab} />
          <div className="flex-1 bg-[var(--color-bg-sidebar)] rounded-2xl m-4">
            <EmptyState />
          </div>
        </div>
      </main>
    </div>
  );
}
