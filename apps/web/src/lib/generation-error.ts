export type GenerationErrorKind = 'system' | 'content' | 'generic';

export type GenerationErrorDisplay = {
  kind: GenerationErrorKind;
  title: string;
  message: string;
  shortLabel: string;
  showRaw: false;
};

const SYSTEM_RETRY_MESSAGE = '这次失败不是提示词问题。请重试；如果多次失败，请稍后再试。';
const GENERIC_RETRY_MESSAGE = '生成失败，请重试；如果多次失败，请稍后再试。';

function normalizeError(raw: string | null | undefined) {
  return String(raw ?? '').trim();
}

function isWorkerError(value: string) {
  return value.startsWith('worker[');
}

function looksTechnical(value: string) {
  return (
    isWorkerError(value) ||
    value.includes('exceeded recovery window') ||
    value.includes('Traceback') ||
    value.includes('Exception:') ||
    value.includes('Error:')
  );
}

export function getGenerationErrorDisplay(raw: string | null | undefined): GenerationErrorDisplay | null {
  const value = normalizeError(raw);
  if (!value) return null;

  if (value.includes('worker[stale_active]') || value.includes('exceeded recovery window')) {
    return {
      kind: 'system',
      title: '系统异常，生成已中断',
      message: SYSTEM_RETRY_MESSAGE,
      shortLabel: '系统异常',
      showRaw: false,
    };
  }

  if (value.includes('worker[timeout]')) {
    return {
      kind: 'system',
      title: '系统异常，生成超时',
      message: SYSTEM_RETRY_MESSAGE,
      shortLabel: '系统异常',
      showRaw: false,
    };
  }

  if (isWorkerError(value)) {
    return {
      kind: 'system',
      title: '系统异常，生成失败',
      message: SYSTEM_RETRY_MESSAGE,
      shortLabel: '系统异常',
      showRaw: false,
    };
  }

  if (looksTechnical(value)) {
    return {
      kind: 'generic',
      title: '生成失败',
      message: GENERIC_RETRY_MESSAGE,
      shortLabel: '生成失败',
      showRaw: false,
    };
  }

  return {
    kind: 'generic',
    title: '生成失败',
    message: value,
    shortLabel: '生成失败',
    showRaw: false,
  };
}
