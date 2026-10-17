import type { ProjectRagStatus, RiskRagReason } from '@project-knowledge-hub/domain';

export {
  assessRiskRag,
  computeFinancialRag,
  computeRiskRag,
  raidDueDateTone,
  worstProjectRag,
  type ProjectHealth,
  type ProjectRagStatus,
  type RiskRagReason,
} from '@project-knowledge-hub/domain';

type RiskReasonTranslator = (key: string, values?: Record<string, string | number>) => string;

const RISK_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const RISK_KINDS = new Set(['risk', 'assumption', 'issue', 'dependency']);

const RISK_CAUSE_KEY: Record<RiskRagReason['cause'], string> = {
  issue: 'riskReasonIssue',
  overdue: 'riskReasonOverdue',
  due_soon: 'riskReasonDueSoon',
  severity: 'riskReasonOpen',
};

/** Tooltip text for health.riskReasons. `t` is the `projects` catalog. */
export function formatRiskReasons(
  reasons: readonly RiskRagReason[] | undefined,
  t: RiskReasonTranslator,
): string {
  if (!reasons?.length) return '';
  return reasons
    .map((reason) => {
      const severity = RISK_SEVERITIES.has(reason.severity)
        ? t(`riskReasonSeverity.${reason.severity}`)
        : reason.severity;
      const kind = RISK_KINDS.has(reason.kind)
        ? t(`riskReasonKind.${reason.kind}`, { count: reason.count })
        : reason.kind;
      const key =
        reason.cause === 'due_soon' && reason.dueInDays === 0
          ? 'riskReasonDueToday'
          : RISK_CAUSE_KEY[reason.cause];
      return t(key, {
        count: reason.count,
        severity,
        kind,
        days: reason.dueInDays ?? 0,
      });
    })
    .join('; ');
}

/** Open change requests awaiting decision → amber. */
export function computeChangeRag(items: Array<{ status: string }>): ProjectRagStatus {
  if (items.some((item) => item.status === 'proposed')) return 'amber';
  return 'green';
}
