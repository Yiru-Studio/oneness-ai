'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Resolves with the character_id-equivalent on the server */
  onCreate: (data: { name: string; description?: string }) => Promise<void>;
}

/**
 * "添加角色" modal — matches LikeAI: small dialog with single name input
 * + 取消 / 确认 buttons. No avatar, no description; analysis happens after.
 *
 * Reference: docs/research/likeai-screenshots/p03-after-add-char-card.png
 */
export function AddCharacterModal({ isOpen, onClose, onCreate }: Props) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setName('');
      setSaving(false);
      setError(null);
    }
  }, [isOpen]);

  const handleConfirm = async () => {
    if (!name.trim()) {
      setError('请输入角色名称');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCreate({ name: name.trim() });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl p-6 w-[420px] relative shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold">添加角色</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
              角色名称
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleConfirm();
              }}
              placeholder="请输入角色名称"
              className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] outline-none transition-colors text-sm"
            />
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg border border-[var(--color-border)] text-sm hover:bg-gray-50"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={saving || !name.trim()}
              className="px-4 py-1.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
            >
              {saving ? '创建中…' : '确认'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
