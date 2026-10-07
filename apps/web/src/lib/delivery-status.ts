/** Shared delivery status order and labels for list and tree filters. */

export const MILESTONE_STATUSES = ['planned', 'active', 'done', 'cancelled'] as const;

export const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const;

/** Sort rank used by the delivery list. Key order is the filter option order. */
export const DELIVERY_STATUS_RANK: Record<string, number> = {
  planned: 0,
  todo: 1,
  active: 2,
  in_progress: 3,
  blocked: 4,
  done: 5,
  cancelled: 6,
};

const TASK_STATUS_SET = new Set<string>(TASK_STATUSES);

export function isTaskDeliveryStatus(status: string): boolean {
  return TASK_STATUS_SET.has(status);
}

export function isClosedDeliveryStatus(status: string | null | undefined): boolean {
  return status === 'done' || status === 'cancelled';
}
