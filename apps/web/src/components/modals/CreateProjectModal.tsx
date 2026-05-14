'use client';

import { useState } from 'react';
import { ArrowLeft, X, Plus } from 'lucide-react';
import {
  STYLE_PRESETS,
  CUSTOM_STYLE_KEY,
} from '@/data/style-presets';

export type CreateProjectPayload = {
  name: string;
  ratio: string;
  styleKey: string;
  styleLabel: string;
  stylePrompt: string;
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (payload: CreateProjectPayload) => Promise<void> | void;
}

const RATIOS = ['9:16', '16:9'] as const;

export function CreateProjectModal({ isOpen, onClose, onCreate }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [ratio, setRatio] = useState<(typeof RATIOS)[number]>('16:9');
  const [styleKey, setStyleKey] = useState<string>(STYLE_PRESETS[0]!.key);
  const [stylePrompt, setStylePrompt] = useState<string>(STYLE_PRESETS[0]!.prompt);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const reset = () => {
    setStep(1);
    setName('');
    setRatio('16:9');
    setStyleKey(STYLE_PRESETS[0]!.key);
    setStylePrompt(STYLE_PRESETS[0]!.prompt);
    setSubmitting(false);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handlePickStyle = (key: string) => {
    setStyleKey(key);
    if (key === CUSTOM_STYLE_KEY) {
      setStylePrompt('');
    } else {
      const preset = STYLE_PRESETS.find((p) => p.key === key);
      if (preset) setStylePrompt(preset.prompt);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim() || !stylePrompt.trim()) return;
    const preset = STYLE_PRESETS.find((p) => p.key === styleKey);
    const styleLabel = preset?.label ?? '自定义';
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({
        name: name.trim(),
        ratio,
        styleKey,
        styleLabel,
        stylePrompt: stylePrompt.trim(),
      });
      reset();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '创建失败');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-2xl p-6 w-[560px] relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
          aria-label="关闭此对话框"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-lg font-semibold mb-6">创建项目</h2>

        {step === 1 && (
          <div className="space-y-5">
            <div>
              <input
                type="text"
                placeholder="请输入项目标题"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] outline-none transition-colors"
              />
            </div>

            <div className="flex gap-3">
              {RATIOS.map((r) => (
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

            <button
              onClick={() => setStep(2)}
              disabled={!name.trim()}
              className="w-full bg-[var(--color-primary)] text-white py-3 rounded-xl font-medium hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              下一步
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <button
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
            >
              <ArrowLeft className="w-4 h-4" />
              返回
            </button>

            <div>
              <div className="text-sm font-medium mb-3">风格选择</div>
              <div className="grid grid-cols-3 gap-3">
                {STYLE_PRESETS.map((p) => {
                  const active = styleKey === p.key;
                  return (
                    <button
                      key={p.key}
                      onClick={() => handlePickStyle(p.key)}
                      className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-colors ${
                        active
                          ? 'border-[var(--color-primary)]'
                          : 'border-transparent hover:border-gray-300'
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.previewUrl}
                        alt={p.label}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-xs py-1.5 text-center">
                        {p.label}
                      </div>
                    </button>
                  );
                })}
                <button
                  onClick={() => handlePickStyle(CUSTOM_STYLE_KEY)}
                  className={`aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-colors ${
                    styleKey === CUSTOM_STYLE_KEY
                      ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                      : 'border-gray-300 text-gray-500 hover:border-gray-400'
                  }`}
                >
                  <Plus className="w-5 h-5" />
                  <span className="text-xs">自定义</span>
                </button>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-2">风格提示词</div>
              <textarea
                placeholder="请输入风格提示词"
                value={stylePrompt}
                onChange={(e) => setStylePrompt(e.target.value)}
                rows={3}
                className="w-full px-4 py-2.5 rounded-xl border border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] outline-none transition-colors text-sm resize-none"
              />
            </div>

            {error && (
              <div className="text-sm text-red-600">{error}</div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                disabled={submitting}
                className="flex-1 py-3 rounded-xl border border-[var(--color-border)] hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                上一步
              </button>
              <button
                onClick={handleSubmit}
                disabled={!stylePrompt.trim() || submitting}
                className="flex-1 bg-[var(--color-primary)] text-white py-3 rounded-xl font-medium hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
