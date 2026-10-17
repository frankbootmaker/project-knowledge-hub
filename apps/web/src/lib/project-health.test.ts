import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import hu from '../../messages/hu.json';
import { formatRiskReasons } from './project-health';
import type { RiskRagReason } from '@project-knowledge-hub/domain';

function translate(locale: 'en' | 'hu', messages: typeof en) {
  const t = createTranslator({ locale, messages, namespace: 'projects' });
  return (key: string, values?: Record<string, string | number>) => t(key as 'ragRisks', values);
}

describe('formatRiskReasons', () => {
  const enT = translate('en', en);
  const huT = translate('hu', hu);

  it('renders the English tooltip phrases from PRO-T-98', () => {
    const issue: RiskRagReason = {
      count: 1,
      severity: 'critical',
      kind: 'issue',
      cause: 'issue',
    };
    const dueSoon: RiskRagReason = {
      count: 1,
      severity: 'critical',
      kind: 'risk',
      cause: 'due_soon',
      dueInDays: 2,
    };
    const overdue: RiskRagReason = {
      count: 1,
      severity: 'high',
      kind: 'risk',
      cause: 'overdue',
    };
    expect(formatRiskReasons([issue], enT)).toBe('1 critical issue');
    expect(formatRiskReasons([dueSoon], enT)).toBe('1 critical risk due in 2 days');
    expect(formatRiskReasons([overdue], enT)).toBe('1 high risk overdue');
    expect(formatRiskReasons([{ ...dueSoon, dueInDays: 1 }], enT)).toBe(
      '1 critical risk due in 1 day',
    );
    expect(formatRiskReasons([{ ...dueSoon, dueInDays: 0 }], enT)).toBe(
      '1 critical risk due today',
    );
    expect(formatRiskReasons([{ ...issue, count: 2 }], enT)).toBe('2 critical issues');
  });

  it('renders the same reasons in Hungarian', () => {
    expect(
      formatRiskReasons([{ count: 1, severity: 'critical', kind: 'issue', cause: 'issue' }], huT),
    ).toBe('1 kritikus probléma');
    expect(
      formatRiskReasons(
        [
          {
            count: 1,
            severity: 'critical',
            kind: 'risk',
            cause: 'due_soon',
            dueInDays: 2,
          },
        ],
        huT,
      ),
    ).toBe('1 kritikus kockázat 2 nap múlva esedékes');
    expect(
      formatRiskReasons([{ count: 1, severity: 'high', kind: 'risk', cause: 'overdue' }], huT),
    ).toBe('1 magas kockázat lejárt');
  });
});
