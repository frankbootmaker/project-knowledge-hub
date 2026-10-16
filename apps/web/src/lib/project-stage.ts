const PROJECT_STAGES = [
  'idea',
  'planned',
  'active',
  'maintenance',
  'paused',
  'completed',
  'archived',
] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number];

export function isProjectStage(value: string): value is ProjectStage {
  return (PROJECT_STAGES as readonly string[]).includes(value);
}

export function projectStageTone(
  status: string,
): 'neutral' | 'brand' | 'success' | 'warn' | 'danger' {
  if (status === 'idea') return 'warn';
  if (status === 'active') return 'success';
  if (status === 'paused' || status === 'archived') return 'neutral';
  if (status === 'completed') return 'brand';
  return 'brand';
}
