import { describe, expect, it } from 'vitest';
import {
  TIMELINE_AT_RISK_DAYS,
  addDaysYmd,
  computeFinancialRag,
  computeRiskRag,
  projectHealthFromBudget,
  timelineRag,
  worstProjectRag,
} from './project-health.js';

const TODAY = '2026-10-17';

describe('project health timeline window', () => {
  it('uses a single 7-day at-risk window', () => {
    expect(TIMELINE_AT_RISK_DAYS).toBe(7);
    expect(addDaysYmd(TODAY, TIMELINE_AT_RISK_DAYS)).toBe('2026-10-24');
  });

  it('marks an item due in 5 days amber (PRO-B-18)', () => {
    expect(
      timelineRag([{ status: 'todo', date: '2026-10-22' }], TODAY),
    ).toBe('amber');
  });

  it('marks the inclusive 7th day amber and the 8th day green', () => {
    expect(
      timelineRag([{ status: 'in_progress', date: '2026-10-24' }], TODAY),
    ).toBe('amber');
    expect(
      timelineRag([{ status: 'in_progress', date: '2026-10-25' }], TODAY),
    ).toBe('green');
  });

  it('marks overdue open items red and ignores done, cancelled, and undated', () => {
    expect(
      timelineRag([{ status: 'blocked', date: '2026-10-16' }], TODAY),
    ).toBe('red');
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

describe('computeRiskRag', () => {
  it('maps open or mitigating critical to red and high to amber', () => {
    expect(
      computeRiskRag([
        { kind: 'risk', status: 'open', severity: 'critical' },
      ]),
    ).toBe('red');
    expect(
      computeRiskRag([
        { kind: 'issue', status: 'mitigating', severity: 'high' },
      ]),
    ).toBe('amber');
    expect(
      computeRiskRag([
        { kind: 'risk', status: 'closed', severity: 'critical' },
        { kind: 'risk', status: 'open', severity: 'medium' },
      ]),
    ).toBe('green');
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
    });
  });

  it('takes the worst of timeline, risk, and financial', () => {
    expect(
      worstProjectRag(['green', 'amber', 'red']),
    ).toBe('red');
    expect(
      projectHealthFromBudget({
        timeline: 'amber',
        budget: { risk: 'green', financial: 'green' },
      }).overall,
    ).toBe('amber');
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
    });
  });
});
