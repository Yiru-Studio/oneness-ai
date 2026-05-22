export const AnalysisStatus = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
} as const;
export type AnalysisStatus = typeof AnalysisStatus[keyof typeof AnalysisStatus];

export const KnowledgeDocType = {
  CREATED: 'CREATED',
  FAVORITED: 'FAVORITED',
  COLLABORATED: 'COLLABORATED',
} as const;
export type KnowledgeDocType = typeof KnowledgeDocType[keyof typeof KnowledgeDocType];

export const TaskType = {
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
  TEXT_ANALYZE: 'TEXT_ANALYZE',
} as const;
export type TaskType = typeof TaskType[keyof typeof TaskType];

export const TaskStatus = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus];

export const ResourceReviewStatus = {
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  CONFIRMED: 'CONFIRMED',
} as const;
export type ResourceReviewStatus =
  typeof ResourceReviewStatus[keyof typeof ResourceReviewStatus];

export const ResourcePromptStatus = {
  EMPTY: 'EMPTY',
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  READY: 'READY',
  FAILED: 'FAILED',
} as const;
export type ResourcePromptStatus =
  typeof ResourcePromptStatus[keyof typeof ResourcePromptStatus];

export const AssetBucket = {
  USER_UPLOADS: 'user-uploads',
  TASK_OUTPUTS: 'task-outputs',
} as const;
export type AssetBucket = typeof AssetBucket[keyof typeof AssetBucket];

export const TaskAssetRole = {
  INPUT: 'input',
  OUTPUT: 'output',
  REFERENCE: 'reference',
} as const;
export type TaskAssetRole = typeof TaskAssetRole[keyof typeof TaskAssetRole];
