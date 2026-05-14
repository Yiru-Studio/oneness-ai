'use client';

import { useState } from 'react';
import { Character } from '@/types';
import { User, ImagePlus } from 'lucide-react';

interface Props {
  characters: Character[];
}

export function CharactersTabContent({ characters }: Props) {
  // Track the user's explicit selection; fall back to the first character so
  // the panel still renders right after polling brings the list in.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const effectiveId = pickedId ?? characters[0]?.id ?? null;
  const selected = characters.find((c) => c.id === effectiveId);
  const setSelectedId = setPickedId;
  const selectedId = effectiveId;

  if (characters.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
        正在分析角色…
      </div>
    );
  }

  return (
    <div className="flex gap-0 h-full">
      {/* Left character list */}
      <div className="w-[280px] flex-shrink-0 border-r border-[var(--color-border)] overflow-y-auto">
        <div className="p-4 space-y-2">
          {characters.map((char) => (
            <button
              key={char.id}
              onClick={() => setSelectedId(char.id)}
              className={`w-full flex items-start gap-3 p-3 rounded-xl text-left transition-colors ${
                selectedId === char.id
                  ? 'bg-blue-50 border border-[var(--color-primary)]'
                  : 'hover:bg-gray-50 border border-transparent'
              }`}
            >
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                <User className="w-5 h-5 text-gray-400" />
              </div>
              <div className="min-w-0">
                <div className="font-medium text-sm">{char.name}</div>
                <div className="text-xs text-[var(--color-text-secondary)] line-clamp-2 mt-0.5">
                  {char.description}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right character detail */}
      <div className="flex-1 overflow-y-auto p-6">
        {selected && (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start gap-4">
              <div className="w-20 h-20 rounded-xl bg-gray-100 flex items-center justify-center">
                <User className="w-10 h-10 text-gray-400" />
              </div>
              <div className="flex-1 space-y-4">
                <div>
                  <label className="text-xs text-[var(--color-text-secondary)]">名称</label>
                  <div className="text-sm font-medium mt-1">{selected.name}</div>
                </div>
                <div>
                  <label className="text-xs text-[var(--color-text-secondary)]">音色</label>
                  <div className="mt-1 px-4 py-2 bg-gray-50 rounded-xl text-sm text-[var(--color-text-secondary)] cursor-pointer hover:bg-gray-100 transition-colors">
                    点击上传音色文件
                  </div>
                </div>
                <div>
                  <label className="text-xs text-[var(--color-text-secondary)]">简介</label>
                  <div className="text-sm mt-1 leading-relaxed">{selected.bio}</div>
                </div>
              </div>
            </div>

            {/* Styles */}
            {selected.styles.length > 0 && (
              <div>
                <div className="grid grid-cols-4 gap-4">
                  {selected.styles.map((style, idx) => (
                    <div key={idx} className="rounded-xl overflow-hidden bg-gray-100">
                      <div className="aspect-square flex items-center justify-center">
                        <ImagePlus className="w-8 h-8 text-gray-400" />
                      </div>
                      <div className="px-3 py-2 bg-gray-700 text-white text-xs text-center">
                        {style.name}
                      </div>
                    </div>
                  ))}
                  <button className="aspect-square rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-2 hover:border-gray-400 transition-colors">
                    <ImagePlus className="w-6 h-6 text-gray-400" />
                    <span className="text-xs text-gray-500">添加造型</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
