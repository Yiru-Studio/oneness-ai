'use client';

import { CheckCircle2, Circle } from 'lucide-react';

/**
 * Mirrors likeai's 4-step AI-assist progress panel. Phase 1 is manual-only,
 * so all steps render as inactive — kept here as a visual placeholder so the
 * AI-assist toggle has a destination when it's wired up later.
 */
const STEPS = [
  { key: 'scene-list', label: '场景列表分析' },
  { key: 'batch-shots', label: '批量分镜生成' },
  { key: 'sketch', label: '生成分镜手稿' },
  { key: 'crop', label: '裁切分镜手稿' },
] as const;

export function AnalysisProgressPanel({ aiAssistEnabled }: { aiAssistEnabled: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 mb-4">
      {STEPS.map((step) => (
        <div
          key={step.key}
          className={`flex items-center gap-3 py-2 ${
            aiAssistEnabled ? 'opacity-100' : 'opacity-40'
          }`}
        >
          {aiAssistEnabled ? (
            <Circle className="w-5 h-5 text-gray-400" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-gray-300" />
          )}
          <span className="text-sm text-[var(--color-text)]">{step.label}</span>
          <span className="text-xs text-gray-400 ml-auto">
            {aiAssistEnabled ? '待开始' : '手动模式'}
          </span>
        </div>
      ))}
    </div>
  );
}
