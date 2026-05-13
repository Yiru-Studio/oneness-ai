'use client';

import { Project } from '@/types';
import { CheckCircle2, Pencil } from 'lucide-react';

interface Props {
  project: Project;
}

export function InfoTabContent({ project }: Props) {
  const infoItems = [
    { label: '分辨率', value: project.ratio },
    { label: '风格', value: project.style },
    { label: '创建时间', value: new Date(project.createdAt).toLocaleString('zh-CN') },
    { label: '分析模型', value: project.analysisModel },
    { label: '图像模型', value: project.imageModel },
    { label: '视频模型', value: project.videoModel },
  ];

  return (
    <div className="flex gap-8 h-full">
      {/* Left info panel */}
      <div className="w-[300px] flex-shrink-0 overflow-y-auto">
        <div className="flex items-center gap-2 mb-6">
          <h2 className="text-xl font-bold">{project.name}</h2>
          <button className="text-gray-400 hover:text-gray-600">
            <Pencil className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          {infoItems.map(item => (
            <div key={item.label}>
              <div className="text-xs text-[var(--color-text-secondary)] mb-1">{item.label}</div>
              <div className="text-sm font-medium">{item.value}</div>
            </div>
          ))}

          <div>
            <div className="text-xs text-[var(--color-text-secondary)] mb-1">风格提示词</div>
            <div className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
              {project.stylePrompt || '暂无'}
            </div>
          </div>

          <div className="pt-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">通用分析</span>
              {project.generalAnalysis === 'completed' ? (
                <span className="inline-flex items-center gap-1 text-xs text-[var(--color-success)]">
                  <CheckCircle2 className="w-3 h-3" />
                  已完成
                </span>
              ) : (
                <span className="text-xs text-gray-400">进行中</span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">基础分析</span>
              {project.basicAnalysis === 'completed' ? (
                <span className="inline-flex items-center gap-1 text-xs text-[var(--color-success)]">
                  <CheckCircle2 className="w-3 h-3" />
                  已完成
                </span>
              ) : (
                <span className="text-xs text-gray-400">进行中</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right content area */}
      <div className="flex-1 overflow-y-auto">
        <div className="prose max-w-none whitespace-pre-wrap leading-relaxed text-[var(--color-text)] text-sm">
          {`故事背景设定在一个近未来的世界，武术"极意"成为了全球主流竞技项目。

主角是一位名叫李昊的年轻格斗家，他在一场国际邀请赛后意外卷入了一个神秘组织的阴谋。这个组织试图利用"极意"技术控制全球能源命脉。

李昊必须联合来自不同国家的格斗家，包括日本的空手道高手、巴西的柔术冠军、泰国的泰拳王者，共同对抗这个组织。

在旅途中，李昊逐渐发现了自己体内潜藏的特殊能力——"共鸣"，这种能力让他能够短暂预知对手的动作。但随着能力的觉醒，他也面临着身体被能力反噬的危险。

最终决战发生在组织的总部，一座隐藏在太平洋深处的浮空城市。李昊必须在保护同伴和拯救世界之间做出选择...`}
        </div>
      </div>
    </div>
  );
}
