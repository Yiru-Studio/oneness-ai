import { TaskType } from './enums.js';

/**
 * MVP estimation table. Real providers can override at runtime by returning
 * `actualCostCredits` from their ProviderResult; the worker reconciles with
 * the reserved amount on completion.
 */
export const TaskCreditEstimate: Record<TaskType, number> = {
  IMAGE: 1,
  VIDEO: 5,
  TEXT_ANALYZE: 1,
};

export function estimateCost(type: TaskType): number {
  return TaskCreditEstimate[type];
}
