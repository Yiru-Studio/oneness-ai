'use client';

import { useEffect, useRef, useState } from 'react';
import { Pencil, Check } from 'lucide-react';

type Option = { value: string; label: string };

type Props = {
  label: string;
  value: string;
  /** when provided, the editor renders as a select; otherwise a textarea. */
  options?: Option[];
  onSave: (next: string) => Promise<void> | void;
  multiline?: boolean;
};

export function EditableField({ label, value, options, onSave, multiline }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | HTMLSelectElement | null>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const labelFor = (v: string) => options?.find((o) => o.value === v)?.label ?? v;

  const commit = async () => {
    if (draft === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(value);
    setError(null);
    setEditing(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-[var(--color-text-secondary)]">{label}</span>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-gray-400 hover:text-gray-600"
            aria-label={`编辑${label}`}
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
      </div>
      {!editing && (
        <div className="text-sm font-medium whitespace-pre-wrap break-words text-[var(--color-text)]">
          {value ? labelFor(value) : <span className="text-gray-400">暂无</span>}
        </div>
      )}
      {editing && options && (
        <div className="flex items-center gap-2">
          <select
            ref={(el) => {
              inputRef.current = el;
            }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            disabled={saving}
            className="flex-1 px-2 py-1.5 rounded-lg border border-[var(--color-border)] focus:border-[var(--color-primary)] outline-none text-sm bg-white"
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {editing && !options && (
        <div className="flex flex-col gap-1">
          <textarea
            ref={(el) => {
              inputRef.current = el;
            }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancel();
              if (e.key === 'Enter' && !multiline && !e.shiftKey) {
                e.preventDefault();
                void commit();
              }
            }}
            rows={multiline ? 3 : 1}
            disabled={saving}
            className="px-2 py-1.5 rounded-lg border border-[var(--color-border)] focus:border-[var(--color-primary)] outline-none text-sm resize-none"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={commit}
              disabled={saving}
              className="text-xs text-[var(--color-primary)] hover:opacity-80 inline-flex items-center gap-1"
            >
              <Check className="w-3 h-3" />
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      )}
      {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
    </div>
  );
}
