'use client';

import { useState, useRef } from 'react';
import { ProjectTab } from '@/types';
import {
  ArrowLeft, List, Package, Workflow, Film, BarChart3
} from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Props {
  activeTab: ProjectTab;
  onTabChange: (tab: ProjectTab) => void;
  /** When false, only the 'info' tab is interactive — used before a script is uploaded. */
  scriptUploaded: boolean;
}

const NAV_ITEMS: Array<{
  tab: ProjectTab;
  icon: React.ElementType;
  label: string;
}> = [
  { tab: 'info', icon: List, label: '信息' },
  { tab: 'resources', icon: Package, label: '素材' },
  { tab: 'workbench', icon: Workflow, label: '工作台' },
  { tab: 'storyboard', icon: Film, label: '分镜' },
  { tab: 'analytics', icon: BarChart3, label: '数据分析' },
];

const FLASH_DURATION = 400;

export function ProjectNavSidebar({ activeTab, onTabChange, scriptUploaded }: Props) {
  const router = useRouter();
  const [hoveredTab, setHoveredTab] = useState<ProjectTab | null>(null);
  const [flashTab, setFlashTab] = useState<ProjectTab | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = (tab: ProjectTab, disabled: boolean) => {
    if (disabled) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    setFlashTab(tab);
    timerRef.current = setTimeout(() => setFlashTab(null), FLASH_DURATION);

    onTabChange(tab);
  };

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
        const isFlashed = flashTab === tab;
        const showTooltip = isHovered || isFlashed;
        const disabled = !scriptUploaded && tab !== 'info' && tab !== 'analytics';

        return (
          <div key={tab} className="relative">
            {showTooltip && (
              <span className="absolute left-12 top-1/2 -translate-y-1/2 bg-gray-800 text-white text-xs px-3 py-1.5 rounded-lg whitespace-nowrap z-50">
                {label}
                {disabled && <span className="ml-1 opacity-70">（上传剧本后可用）</span>}
              </span>
            )}
            <button
              onClick={() => handleClick(tab, disabled)}
              disabled={disabled}
              aria-label={label}
              onMouseEnter={() => setHoveredTab(tab)}
              onMouseLeave={() => setHoveredTab(null)}
              className={`w-10 h-10 flex items-center justify-center rounded-full shadow-md border transition-all ${
                isActive
                  ? 'bg-[var(--color-dark)] text-white border-[var(--color-dark)]'
                  : disabled
                    ? 'bg-gray-100 text-gray-300 border-[var(--color-border)] cursor-not-allowed'
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
