'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, ratio: string) => void;
}

const RATIOS = ['16:9', '9:16', '1:1', '4:3'];

export function CreateProjectModal({ isOpen, onClose, onCreate }: Props) {
  const [name, setName] = useState('');
  const [ratio, setRatio] = useState('16:9');

  const handleSubmit = () => {
    if (!name) return;
    onCreate(name, ratio);
    setName('');
    setRatio('16:9');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50"
         onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-[480px] relative"
           onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-lg font-semibold mb-6">创建项目</h2>

        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2">项目名称</label>
            <input
              type="text"
              placeholder="请输入项目名称"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] outline-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">画面比例</label>
            <div className="flex gap-3">
              {RATIOS.map(r => (
                <button
                  key={r}
                  onClick={() => setRatio(r)}
                  className={`flex-1 py-3 rounded-xl border transition-colors ${
                    ratio === r
                      ? 'border-[var(--color-primary)] bg-blue-50 text-[var(--color-primary)]'
                      : 'border-[var(--color-border)] hover:border-gray-300'
                  }`}
                >
                  <span className="text-sm font-medium">{r}</span>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!name}
            className="w-full bg-[var(--color-primary)] text-white py-3 rounded-xl font-medium hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            创建
          </button>
        </div>
      </div>
    </div>
  );
}
