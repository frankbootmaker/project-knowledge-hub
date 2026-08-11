import type { ProjectRagStatus } from './delivery-schedule';

const RAG_RANK: Record<ProjectRagStatus, number> = {
  green: 0,
  amber: 1,
  red: 2,
};

/** Worst (most severe) status across Timeline / Risks / Financials. */
export function worstProjectRag(
  statuses: ProjectRagStatus[],
): ProjectRagStatus {
  let worst: ProjectRagStatus = 'green';
  for (const status of statuses) {
    if (RAG_RANK[status] > RAG_RANK[worst]) worst = status;
  }
  return worst;
}

export function computeFinancialRag(input: {
  bac: number | null;
  ac: number;
  cpi: number | null;
}): ProjectRagStatus {
  if (input.bac == null) return 'green';
  if (input.ac > input.bac || (input.cpi != null && input.cpi < 0.9)) {
    return 'red';
  }
  if (input.ac > input.bac * 0.85 || (input.cpi != null && input.cpi < 1)) {
    return 'amber';
  }
  return 'green';
}

export function computeRiskRag(
  items: Array<{ kind: string; status: string; severity: string }>,
): ProjectRagStatus {
  const open = items.filter(
    (item) => item.status === 'open' || item.status === 'mitigating',
  );
  if (open.some((item) => item.severity === 'critical')) return 'red';
  if (open.some((item) => item.severity === 'high')) return 'amber';
  return 'green';
}

/** Open change requests awaiting decision → amber. */
export function computeChangeRag(
  items: Array<{ status: string }>,
): ProjectRagStatus {
  if (items.some((item) => item.status === 'proposed')) return 'amber';
  return 'green';
}
