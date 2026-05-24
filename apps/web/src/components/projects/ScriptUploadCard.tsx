'use client';

import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { createEpisode } from '@/lib/api';
import { StoryboardEpisode } from '@/types';

interface Props {
  projectId: string;
  onUploaded: (episode: StoryboardEpisode) => void;
}

const ACCEPTED = '.txt,.md,.docx';
const MAX_SCRIPT_LENGTH = 100000;

async function readScript(file: File): Promise<string> {
  if (/\.docx$/i.test(file.name)) {
    const mammoth = await import('mammoth/mammoth.browser');
    const buf = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
    return value;
  }
  return await file.text();
}

export function ScriptUploadCard({ projectId, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'idle' | 'reading' | 'uploading' | 'error'>(
    'idle',
  );
  const [error, setError] = useState<string | null>(null);

  const handlePick = () => inputRef.current?.click();

  const handleFile = async (file: File) => {
    setError(null);
    setStatus('reading');
    let text: string;
    try {
      text = await readScript(file);
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : '读取文件失败');
      return;
    }

    if (!text.trim()) {
      setStatus('error');
      setError('文件内容为空');
      return;
    }

    if (text.length > MAX_SCRIPT_LENGTH) {
      setStatus('error');
      setError(
        `剧本过长（${text.length.toLocaleString()} 字符），上限为 ${MAX_SCRIPT_LENGTH.toLocaleString()} 字符，请精简后重试`,
      );
      return;
    }

    setStatus('uploading');
    try {
      const title = file.name.replace(/\.(txt|md|docx)$/i, '') || '第1集';
      const episode = await createEpisode(projectId, {
        number: 1,
        title,
        content: text,
      });
      onUploaded(episode);
      setStatus('idle');
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : '上传失败');
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => e.preventDefault();

  const busy = status === 'reading' || status === 'uploading';
  const label =
    status === 'reading'
      ? '正在读取文件…'
      : status === 'uploading'
        ? '正在上传剧本…'
        : '上传剧本';

  return (
    <div className="h-full flex items-center justify-center p-8">
      <div
        onClick={busy ? undefined : handlePick}
        onDrop={busy ? undefined : onDrop}
        onDragOver={onDragOver}
        className={`w-full max-w-2xl aspect-[16/9] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-3 transition-colors ${
          busy
            ? 'border-gray-300 bg-gray-50 cursor-wait'
            : 'border-gray-300 bg-[var(--color-bg-card)] hover:border-[var(--color-primary)] cursor-pointer'
        }`}
      >
        <Upload className="w-10 h-10 text-gray-400" />
        <p className="text-base font-medium text-[var(--color-text)]">{label}</p>
        <p className="text-xs text-[var(--color-text-secondary)]">
          支持 .txt、.md、.docx 格式文件
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          onChange={onChange}
          className="hidden"
        />
      </div>
    </div>
  );
}
