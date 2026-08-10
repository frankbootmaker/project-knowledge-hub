import type { ProjectRagStatus } from './delivery-schedule';

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
