'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { TopBar } from '@/components/layout/TopBar';
import { FloatingKnowledgeButton } from '@/components/layout/FloatingKnowledgeButton';
import { ProfileForm } from '@/components/profile/ProfileForm';
import { updateProfile } from '@/lib/api';

export default function ProfilePage() {
  const { isLoggedIn, user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.push('/');
    }
  }, [isLoggedIn, isLoading, router]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">加载中...</div>;
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-white">
      <TopBar />
      <main className="pt-8 px-8">
        <ProfileForm user={user} onSave={updateProfile} />
      </main>
      <FloatingKnowledgeButton />
    </div>
  );
}
