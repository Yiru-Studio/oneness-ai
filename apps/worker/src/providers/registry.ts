import type { ProviderKind } from '@oneness/shared/providers';
import { stubImageProvider } from './stub-image.js';
import { stubVideoProvider } from './stub-video.js';
import { stubTextProvider } from './stub-text.js';
import { config } from '../config.js';

/**
 * The registry holds one concrete provider per (kind, name).
 * Stub is registered as the default for every kind. Future real providers
 * (e.g. 'gemini-3-pro') are added here.
 */
const registry = {
  image: {
    stub: stubImageProvider,
  },
  video: {
    stub: stubVideoProvider,
  },
  text: {
    stub: stubTextProvider,
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
