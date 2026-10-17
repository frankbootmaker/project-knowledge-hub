import type { ProjectRagStatus } from '@project-knowledge-hub/domain';

export {
  computeFinancialRag,
  computeRiskRag,
  worstProjectRag,
  type ProjectHealth,
  type ProjectRagStatus,
} from '@project-knowledge-hub/domain';

/** Open change requests awaiting decision → amber. */
export function computeChangeRag(
  items: Array<{ status: string }>,
): ProjectRagStatus {
  if (items.some((item) => item.status === 'proposed')) return 'amber';
  return 'green';
}
