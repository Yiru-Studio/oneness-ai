'use client';

import { useState } from 'react';
import { ProjectTab } from '@/types';
import {
  ArrowLeft, List, Users, Package, Image, Workflow, Film, BarChart3
} from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Props {
  activeTab: ProjectTab;
  onTabChange: (tab: ProjectTab) => void;
}

const NAV_ITEMS: Array<{
  tab: ProjectTab;
  icon: React.ElementType;
  label: string;
}> = [
  { tab: 'info', icon: List, label: '信息' },
  { tab: 'characters', icon: Users, label: '角色' },
  { tab: 'items', icon: Package, label: '物品' },
  { tab: 'scenes', icon: Image, label: '场景' },
  { tab: 'workbench', icon: Workflow, label: '工作台' },
  { tab: 'storyboard', icon: Film, label: '分镜' },
  { tab: 'analytics', icon: BarChart3, label: '数据分析' },
];

export function ProjectNavSidebar({ activeTab, onTabChange }: Props) {
  const router = useRouter();
  const [hoveredTab, setHoveredTab] = useState<ProjectTab | null>(null);

  return (
    <div className="fixed left-4 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-50">
      <button
        onClick={() => router.push('/projects')}
        className="w-10 h-10 flex items-center justify-center rounded-full bg-white shadow-md border border-[var(--color-border)] hover:shadow-lg transition-shadow"
      >
        <ArrowLeft className="w-4 h-4 text-[var(--color-text)]" />
      </button>

      {NAV_ITEMS.map(({ tab, icon: Icon, label }) => {
        const isActive = activeTab === tab;
        const isHovered = hoveredTab === tab;

        return (
          <div key={tab} className="relative">
            {(isActive || isHovered) && (
              <span className="absolute left-12 top-1/2 -translate-y-1/2 bg-gray-800 text-white text-xs px-3 py-1.5 rounded-lg whitespace-nowrap z-50">
                {label}
              </span>
            )}
            <button
              onClick={() => onTabChange(tab)}
              onMouseEnter={() => setHoveredTab(tab)}
              onMouseLeave={() => setHoveredTab(null)}
              className={`w-10 h-10 flex items-center justify-center rounded-full shadow-md border transition-all ${
                isActive
                  ? 'bg-[var(--color-dark)] text-white border-[var(--color-dark)]'
                  : 'bg-white text-[var(--color-text)] border-[var(--color-border)] hover:shadow-lg'
              }`}
            >
              <Icon className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
