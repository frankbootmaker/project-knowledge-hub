import { describe, expect, it } from 'vitest';
import { projectReportFileSlug } from './project-reports';

describe('projectReportFileSlug', () => {
  it('transliterates Hungarian, German, Polish, French, and Nordic names', () => {
    expect(projectReportFileSlug('AI Lawyer – nyitott kérdések jogi átnézése')).toBe(
      'ai-lawyer-nyitott-kerdesek-jogi-atnezese',
    );
    expect(projectReportFileSlug('Straße Größe')).toBe('strasse-grosse');
    expect(projectReportFileSlug('Zażółć gęślą jaźń')).toBe('zazolc-gesla-jazn');
    expect(projectReportFileSlug('Café déjà vu – œuvre naïve')).toBe(
      'cafe-deja-vu-oeuvre-naive',
    );
    expect(projectReportFileSlug('Smørrebrød på Ærø')).toBe('smorrebrod-pa-aero');
  });

  it('keeps an existing ascii slug and falls back when nothing remains', () => {
    const legacy = 'ai-lawyer-nyitott-k-rd-sek-jogi-tn-z-se';
    expect(projectReportFileSlug(legacy)).toBe(legacy);
    expect(projectReportFileSlug('---')).toBe('project');
  });
});