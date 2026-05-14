import { Client } from 'minio';
import type { PrismaClient } from '@prisma/client';
import { config } from '../config.js';

/**
 * Public-facing MinIO client. Used to mint presigned URLs that external
 * providers (e.g. Seedance) can fetch over the public internet.
 *
 * In production: set MINIO_PUBLIC_ENDPOINT to a publicly reachable URL that
 * fronts the same MinIO storage (direct exposure / CDN reverse-proxy / TOS
 * mirror). The proxy MUST preserve request-signing semantics — i.e. it must
 * pass through the host the URL was signed against. This is usually achieved
 * by signing against the public host directly with the same access/secret
 * keys; the proxy then forwards to internal MinIO transparently.
 *
 * In development: usually unset, falls back to MINIO_ENDPOINT (localhost).
 * Seedance won't be able to reach localhost — pure text-to-video tasks work,
 * reference-asset tasks need a tunnel (ngrok / cloudflared) or skip refs.
 */
let cached: Client | null = null;
function getPublicClient(): Client {
  if (cached) return cached;
  const endpoint = config.MINIO_PUBLIC_ENDPOINT ?? config.MINIO_ENDPOINT;
  const url = new URL(endpoint);
  cached = new Client({
    endPoint: url.hostname,
    port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
    useSSL: url.protocol === 'https:',
    accessKey: config.MINIO_ACCESS_KEY,
    secretKey: config.MINIO_SECRET_KEY,
  });
  return cached;
}

/**
 * Look up an Asset by id and return a presigned GET URL valid for ttlSec.
 * Default TTL 24h — matches the Seedance docs' note that their own returned
 * video URLs expire after 24h.
 */
export async function presignedPublicGetUrl(
  prisma: PrismaClient,
  assetId: string,
  ttlSec = 86400,
): Promise<string> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error(`asset not found: ${assetId}`);
  return getPublicClient().presignedGetObject(asset.bucket, asset.key, ttlSec);
}
