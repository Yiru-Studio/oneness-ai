'use client';

import { AnalyticsData } from '@/types';

interface Props {
  data: AnalyticsData;
}

export function AnalyticsTabContent({ data }: Props) {
  const stats = [
    { label: '积分总消耗', value: data.totalCredits.toFixed(2), suffix: '' },
    { label: '生成图片数', value: String(data.imageCount), suffix: '' },
    { label: '生成视频数', value: String(data.videoCount), suffix: '' },
    { label: '文本任务数', value: String(data.textTaskCount), suffix: '' },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold">数据分析</h2>
        <div className="flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
          <span className="px-3 py-1 rounded-full border border-[var(--color-border)]">
            统计数据每15分钟更新一次
          </span>
          <span>更新时间：{data.updateTime}</span>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-4">
        {stats.map(stat => (
          <div key={stat.label} className="rounded-xl border border-[var(--color-border)] p-5 bg-white">
            <div className="text-xs text-[var(--color-text-secondary)] mb-2">{stat.label}</div>
            <div className="text-2xl font-bold">{stat.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
