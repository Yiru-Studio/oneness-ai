import { z } from 'zod';

export const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/wav',
] as const;

export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export const MAX_ASSET_BYTES = 100 * 1024 * 1024;

export function isAllowedContentType(ct: string): ct is AllowedContentType {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(ct);
}

// Optional metadata accompanying the file upload (sent as fields).
export const UploadMetadataSchema = z.object({
  // For future use: a hint about where the asset will be used.
  // Stays optional; MVP ignores it but accepts it without erroring.
  intent: z.string().max(60).optional(),
});

export type UploadMetadata = z.infer<typeof UploadMetadataSchema>;
