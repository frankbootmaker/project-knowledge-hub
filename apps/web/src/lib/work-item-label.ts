export type WorkItemType = 'task' | 'bug';

export function workItemKindLabel(
  itemType: WorkItemType | null | undefined,
  labels: { task: string; bug: string },
): string {
  return itemType === 'bug' ? labels.bug : labels.task;
}

/** Bug rows show the Bug word and the B key together. Tasks keep the key, or the Task word. */
export function workItemIdLabel(input: {
  itemType?: WorkItemType | null;
  humanKey?: string | null;
  taskLabel: string;
  bugLabel: string;
}): string {
  if (input.itemType === 'bug') {
    return input.humanKey
      ? `${input.bugLabel} · ${input.humanKey}`
      : input.bugLabel;
  }
  return input.humanKey ?? input.taskLabel;
}
