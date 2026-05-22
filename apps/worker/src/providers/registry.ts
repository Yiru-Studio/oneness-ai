import type { ProviderKind } from '@oneness/shared/providers';
import { stubImageProvider } from './stub-image.js';
import { stubVideoProvider } from './stub-video.js';
import { stubTextProvider } from './stub-text.js';
import { openaiImageProvider } from './openai-image.js';
import { openaiTextProvider } from './openai-text.js';
import { nanobananaImageProvider } from './nanobanana.js';
import { zenmuxPredictImageProvider } from './zenmux-predict.js';
import { createSeedanceProvider } from './seedance.js';
import { config } from '../config.js';

/**
 * The registry holds one concrete provider per (kind, name).
 * Stub is registered as the default for every kind. Future real providers
 * (e.g. 'gemini-3-pro') are added here.
 *
 * 'seedance' and 'seedance-fast' share the same code path; they differ only
 * in the default model they fall back to when input.model is not provided.
 */
const seedance = createSeedanceProvider({
  name: 'seedance',
  pinnedModel: 'doubao-seedance-2-0-260128',
});
const seedanceFast = createSeedanceProvider({
  name: 'seedance-fast',
  pinnedModel: 'doubao-seedance-2-0-fast-260128',
});

const registry = {
  image: {
    stub: stubImageProvider,
    openai: openaiImageProvider,
    nanobanana: nanobananaImageProvider,
    'zenmux-predict': zenmuxPredictImageProvider,
  },
  video: {
    stub: stubVideoProvider,
    seedance,
    'seedance-fast': seedanceFast,
  },
  text: {
    stub: stubTextProvider,
    openai: openaiTextProvider,
  },
} as const;

export function selectProvider(kind: ProviderKind, name: string) {
  const bucket = registry[kind] as Record<
    string,
    (typeof registry)[typeof kind][keyof (typeof registry)[typeof kind]]
  >;
  const provider = bucket[name];
  if (!provider) {
    throw new Error(`unknown ${kind} provider: ${name}`);
  }
  return provider;
}

export function defaultProviderName(kind: ProviderKind): string {
  switch (kind) {
    case 'image':
      return config.PROVIDER_IMAGE;
    case 'video':
      return config.PROVIDER_VIDEO;
    case 'text':
      return config.PROVIDER_TEXT;
  }
}
