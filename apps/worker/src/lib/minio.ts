import { Client } from 'minio';
import { config } from '../config.js';

const url = new URL(config.MINIO_ENDPOINT);
const DEFAULT_REGION = 'us-east-1';

export const minioClient = new Client({
  endPoint: url.hostname,
  port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
  useSSL: url.protocol === 'https:',
  accessKey: config.MINIO_ACCESS_KEY,
  secretKey: config.MINIO_SECRET_KEY,
  region: DEFAULT_REGION,
});

export const TaskOutputsBucket = config.MINIO_BUCKET_TASK_OUTPUTS;
