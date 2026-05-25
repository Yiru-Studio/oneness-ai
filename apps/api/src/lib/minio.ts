import { Client } from 'minio';
import { config } from '../config.js';

const DEFAULT_REGION = 'us-east-1';

function clientFor(endpoint: string): Client {
  const url = new URL(endpoint);
  return new Client({
    endPoint: url.hostname,
    port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
    useSSL: url.protocol === 'https:',
    accessKey: config.MINIO_ACCESS_KEY,
    secretKey: config.MINIO_SECRET_KEY,
    region: DEFAULT_REGION,
  });
}

// Internal client: used for uploads/deletes/health from inside the API.
export const minioClient = clientFor(config.MINIO_ENDPOINT);

// Public client: used to mint presigned URLs that browsers will fetch.
// In production MINIO_PUBLIC_ENDPOINT points to https://s3.yirustudio.com or
// equivalent; in dev it's unset and falls back to MINIO_ENDPOINT.
export const minioPublicClient = config.MINIO_PUBLIC_ENDPOINT
  ? clientFor(config.MINIO_PUBLIC_ENDPOINT)
  : minioClient;

export const Buckets = {
  USER_UPLOADS: config.MINIO_BUCKET_USER_UPLOADS,
  TASK_OUTPUTS: config.MINIO_BUCKET_TASK_OUTPUTS,
} as const;
