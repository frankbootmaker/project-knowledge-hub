import { describe, expect, it } from 'vitest';
import {
  TIMELINE_AT_RISK_DAYS,
  addDaysYmd,
  assessRiskRag,
  computeFinancialRag,
  computeRiskRag,
  projectHealthFromBudget,
  raidDueDateTone,
  timelineRag,
  worstProjectRag,
  type RiskRagItem,
} from './project-health.js';

const TODAY = '2026-10-17';

describe('project health timeline window', () => {
  it('uses a single 7-day at-risk window', () => {
    expect(TIMELINE_AT_RISK_DAYS).toBe(7);
    expect(addDaysYmd(TODAY, TIMELINE_AT_RISK_DAYS)).toBe('2026-10-24');
  });

  it('marks an item due in 5 days amber (PRO-B-18)', () => {
    expect(timelineRag([{ status: 'todo', date: '2026-10-22' }], TODAY)).toBe('amber');
  });

  it('marks the inclusive 7th day amber and the 8th day green', () => {
    expect(timelineRag([{ status: 'in_progress', date: '2026-10-24' }], TODAY)).toBe('amber');
    expect(timelineRag([{ status: 'in_progress', date: '2026-10-25' }], TODAY)).toBe('green');
  });

  it('marks overdue open items red and ignores done, cancelled, and undated', () => {
    expect(timelineRag([{ status: 'blocked', date: '2026-10-16' }], TODAY)).toBe('red');
    expect(
      timelineRag(
        [
          { status: 'done', date: '2026-10-01' },
          { status: 'cancelled', date: '2026-10-01' },
          { status: 'todo', date: null },
        ],
        TODAY,
      ),
    ).toBe('green');
  });

  it('returns red as soon as any open item is overdue', () => {
    expect(
      timelineRag(
        [
          { status: 'todo', date: '2026-10-22' },
          { status: 'todo', date: '2026-10-01' },
        ],
        TODAY,
      ),
    ).toBe('red');
  });
});

function raid(partial: Partial<RiskRagItem> & Pick<RiskRagItem, 'severity'>): RiskRagItem {
  return {
    kind: 'risk',
    status: 'open',
    dueDate: null,
    ...partial,
  };
}

describe('computeRiskRag due-date matrix (PRO-T-98)', () => {
  const far = '2026-11-17';
  const day7 = '2026-10-24';
  const day8 = '2026-10-25';
  const overdue = '2026-10-16';
  const in2 = '2026-10-19';

  it('keeps a critical risk amber when it is due far away or has no due date', () => {
    expect(assessRiskRag([raid({ severity: 'critical', dueDate: far })], TODAY)).toEqual({
      status: 'amber',
      reasons: [{ count: 1, severity: 'critical', kind: 'risk', cause: 'severity' }],
    });
    expect(assessRiskRag([raid({ severity: 'critical', dueDate: day8 })], TODAY).status).toBe(
      'amber',
    );
    expect(assessRiskRag([raid({ severity: 'critical' })], TODAY).status).toBe('amber');
    expect(computeRiskRag([raid({ severity: 'critical', dueDate: far })], TODAY)).toBe('amber');
  });

  it('turns the same critical risk red inside the 7-day window or when overdue', () => {
    expect(assessRiskRag([raid({ severity: 'critical', dueDate: day7 })], TODAY)).toEqual({
      status: 'red',
      reasons: [{ count: 1, severity: 'critical', kind: 'risk', cause: 'due_soon', dueInDays: 7 }],
    });
    expect(assessRiskRag([raid({ severity: 'critical', dueDate: in2 })], TODAY).reasons).toEqual([
      { count: 1, severity: 'critical', kind: 'risk', cause: 'due_soon', dueInDays: 2 },
    ]);
    expect(assessRiskRag([raid({ severity: 'critical', dueDate: TODAY })], TODAY).reasons).toEqual([
      { count: 1, severity: 'critical', kind: 'risk', cause: 'due_soon', dueInDays: 0 },
    ]);
    expect(assessRiskRag([raid({ severity: 'critical', dueDate: overdue })], TODAY)).toEqual({
      status: 'red',
      reasons: [{ count: 1, severity: 'critical', kind: 'risk', cause: 'overdue' }],
    });
  });

  it('treats a critical issue as red regardless of due date', () => {
    for (const dueDate of [null, far, day7, overdue]) {
      expect(
        assessRiskRag([raid({ kind: 'issue', severity: 'critical', dueDate })], TODAY),
      ).toEqual({
        status: 'red',
        reasons: [{ count: 1, severity: 'critical', kind: 'issue', cause: 'issue' }],
      });
    }
    expect(
      assessRiskRag(
        [raid({ kind: 'issue', severity: 'critical', status: 'mitigating', dueDate: null })],
        TODAY,
      ).status,
    ).toBe('red');
  });

  it('marks an overdue high item red and any other high item amber', () => {
    expect(assessRiskRag([raid({ severity: 'high', dueDate: overdue })], TODAY)).toEqual({
      status: 'red',
      reasons: [{ count: 1, severity: 'high', kind: 'risk', cause: 'overdue' }],
    });
    expect(assessRiskRag([raid({ severity: 'high', dueDate: in2 })], TODAY).status).toBe('amber');
    expect(assessRiskRag([raid({ severity: 'high', dueDate: far })], TODAY).status).toBe('amber');
    expect(assessRiskRag([raid({ severity: 'high' })], TODAY)).toEqual({
      status: 'amber',
      reasons: [{ count: 1, severity: 'high', kind: 'risk', cause: 'severity' }],
    });
    expect(
      assessRiskRag([raid({ kind: 'issue', severity: 'high', status: 'mitigating' })], TODAY)
        .status,
    ).toBe('amber');
  });

  it('marks any overdue severity amber and ignores near-term medium or low items', () => {
    expect(assessRiskRag([raid({ severity: 'medium', dueDate: overdue })], TODAY)).toEqual({
      status: 'amber',
      reasons: [{ count: 1, severity: 'medium', kind: 'risk', cause: 'overdue' }],
    });
    expect(
      assessRiskRag(
        [raid({ kind: 'assumption', severity: 'low', status: 'mitigating', dueDate: overdue })],
        TODAY,
      ).status,
    ).toBe('amber');
    expect(assessRiskRag([raid({ severity: 'medium', dueDate: in2 })], TODAY).status).toBe('green');
    expect(assessRiskRag([raid({ kind: 'issue', severity: 'medium' })], TODAY).status).toBe(
      'green',
    );
    expect(assessRiskRag([raid({ kind: 'dependency', severity: 'low' })], TODAY).status).toBe(
      'green',
    );
  });

  it('ignores closed, accepted, cancelled, and archived items', () => {
    const excluded: RiskRagItem[] = [
      raid({ severity: 'critical', status: 'closed', dueDate: overdue }),
      raid({ severity: 'critical', status: 'accepted', dueDate: overdue }),
      raid({ severity: 'critical', status: 'cancelled', dueDate: overdue }),
      raid({ kind: 'issue', severity: 'critical', status: 'closed' }),
      raid({
        severity: 'critical',
        dueDate: overdue,
        archivedAt: '2026-10-01T00:00:00.000Z',
      }),
    ];
    expect(assessRiskRag(excluded, TODAY)).toEqual({ status: 'green', reasons: [] });
    expect(computeRiskRag([], TODAY)).toBe('green');
  });

  it('reports only the reasons that produced the colour, grouped by due day', () => {
    const red = assessRiskRag(
      [
        raid({ severity: 'critical', dueDate: in2 }),
        raid({ severity: 'critical', dueDate: in2 }),
        raid({ severity: 'critical', dueDate: '2026-10-20' }),
        raid({ severity: 'medium', dueDate: overdue }),
        raid({ kind: 'issue', severity: 'critical' }),
      ],
      TODAY,
    );
    expect(red.status).toBe('red');
    expect(red.reasons).toEqual([
      { count: 1, severity: 'critical', kind: 'issue', cause: 'issue' },
      { count: 2, severity: 'critical', kind: 'risk', cause: 'due_soon', dueInDays: 2 },
      { count: 1, severity: 'critical', kind: 'risk', cause: 'due_soon', dueInDays: 3 },
    ]);

    const amber = assessRiskRag(
      [raid({ severity: 'critical', dueDate: far }), raid({ severity: 'high' })],
      TODAY,
    );
    expect(amber).toEqual({
      status: 'amber',
      reasons: [
        { count: 1, severity: 'critical', kind: 'risk', cause: 'severity' },
        { count: 1, severity: 'high', kind: 'risk', cause: 'severity' },
      ],
    });
  });
});

describe('raidDueDateTone', () => {
  it('uses the same 7-day window as the timeline RAG', () => {
    expect(raidDueDateTone('2026-10-16', TODAY)).toBe('overdue');
    expect(raidDueDateTone(TODAY, TODAY)).toBe('soon');
    expect(raidDueDateTone(addDaysYmd(TODAY, TIMELINE_AT_RISK_DAYS), TODAY)).toBe('soon');
    expect(raidDueDateTone(addDaysYmd(TODAY, TIMELINE_AT_RISK_DAYS + 1), TODAY)).toBeNull();
    expect(raidDueDateTone(null, TODAY)).toBeNull();
  });
});

describe('computeFinancialRag', () => {
  it('keeps the budget thresholds', () => {
    expect(computeFinancialRag({ bac: null, ac: 100, cpi: 0.5 })).toBe('green');
    expect(computeFinancialRag({ bac: 100, ac: 101, cpi: 1.2 })).toBe('red');
    expect(computeFinancialRag({ bac: 100, ac: 10, cpi: 0.89 })).toBe('red');
    expect(computeFinancialRag({ bac: 100, ac: 86, cpi: 1.1 })).toBe('amber');
    expect(computeFinancialRag({ bac: 100, ac: 10, cpi: 0.95 })).toBe('amber');
    expect(computeFinancialRag({ bac: 100, ac: 80, cpi: 1 })).toBe('green');
  });
});

describe('projectHealthFromBudget', () => {
  it('is red when only the budget is red (PRO-B-19)', () => {
    expect(
      projectHealthFromBudget({
        timeline: 'green',
        budget: { risk: 'green', financial: 'red' },
      }),
    ).toEqual({
      overall: 'red',
      timeline: 'green',
      risk: 'green',
      financial: 'red',
      riskReasons: [],
    });
  });

  it('takes the worst of timeline, risk, and financial', () => {
    expect(worstProjectRag(['green', 'amber', 'red'])).toBe('red');
    expect(
      projectHealthFromBudget({
        timeline: 'amber',
        budget: { risk: 'green', financial: 'green' },
      }).overall,
    ).toBe('amber');
  });

  it('copies risk reasons onto the shared health payload', () => {
    const reasons = [{ count: 1, severity: 'high', kind: 'risk', cause: 'overdue' as const }];
    expect(
      projectHealthFromBudget({
        timeline: 'green',
        budget: { risk: 'red', financial: 'green', riskReasons: reasons },
      }),
    ).toMatchObject({ overall: 'red', risk: 'red', riskReasons: reasons });
  });

  it('falls back to timeline only when the budget summary fails', () => {
    expect(
      projectHealthFromBudget({
        timeline: 'amber',
        budget: null,
      }),
    ).toEqual({
      overall: 'amber',
      timeline: 'amber',
      risk: 'green',
      financial: null,
      riskReasons: [],
    });
  });
});
