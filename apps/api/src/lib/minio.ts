import { Client } from 'minio';
import { config } from '../config.js';

const url = new URL(config.MINIO_ENDPOINT);

export const minioClient = new Client({
  endPoint: url.hostname,
  port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
  useSSL: url.protocol === 'https:',
  accessKey: config.MINIO_ACCESS_KEY,
  secretKey: config.MINIO_SECRET_KEY,
});

export const Buckets = {
  USER_UPLOADS: config.MINIO_BUCKET_USER_UPLOADS,
  TASK_OUTPUTS: config.MINIO_BUCKET_TASK_OUTPUTS,
} as const;
