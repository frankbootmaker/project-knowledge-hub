import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import de from '../../messages/de.json';
import en from '../../messages/en.json';
import hu from '../../messages/hu.json';
import { capacityStack, formatHours, formatStackPct, stackSummary } from './utilization-bar';

const here = dirname(fileURLToPath(import.meta.url));

function ruleBody(css: string, selector: string, token?: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g');
  const bodies: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) {
    bodies.push(match[1] ?? '');
  }
  if (!token) return bodies[0] ?? '';
  return bodies.find((body) => body.includes(token)) ?? '';
}

const enT = createTranslator({
  locale: 'en',
  messages: en,
  namespace: 'utilization',
});

function translate(key: string, values?: Record<string, string | number>): string {
  return enT(key as 'barSummary', values);
}

describe('capacityStack', () => {
  it('places burned then planned for 69.5h + 3.5h on 528h (73h, 13.8%)', () => {
    const stack = capacityStack({
      burnHours: 69.5,
      plannedHours: 3.5,
      capacityHours: 528,
    });

    expect(stack.burnHours).toBe(69.5);
    expect(stack.plannedHours).toBe(3.5);
    expect(stack.totalHours).toBe(73);
    expect(stack.capacityHours).toBe(528);
    expect(stack.totalPct).toBe(13.8);
    expect(stack.overflow).toBe(false);
    expect(stack.markerPct).toBeNull();
    expect(stack.overflowWidthPct).toBe(0);
    expect(stack.band).toBe('under');

    expect(stack.burnWidthPct).toBe(13.1629);
    expect(stack.plannedWidthPct).toBe(0.6629);
    expect(stack.plannedLeftPct).toBe(stack.burnWidthPct);
    expect(stack.burnWidthPct + stack.plannedWidthPct).toBeCloseTo((73 / 528) * 100, 4);

    const summary = stackSummary(translate, 'Alex Morgan', stack);
    expect(summary).toContain('69.5h');
    expect(summary).toContain('3.5h');
    expect(summary).toContain('73.0h');
    expect(summary).toContain('13.8%');
    expect(summary).toContain('528.0h');
    expect(summary).toContain('Alex Morgan');
  });

  it('shows overflow past capacity with a 100% marker and both segments', () => {
    const stack = capacityStack({
      burnHours: 400,
      plannedHours: 200,
      capacityHours: 500,
    });

    expect(stack.totalHours).toBe(600);
    expect(stack.totalPct).toBe(120);
    expect(stack.overflow).toBe(true);
    expect(stack.band).toBe('over');
    expect(stack.burnWidthPct).toBe(66.6667);
    expect(stack.plannedLeftPct).toBe(stack.burnWidthPct);
    expect(stack.plannedWidthPct).toBe(33.3333);
    expect(stack.markerPct).toBe(83.3333);
    expect(stack.overflowWidthPct).toBe(16.6667);
    expect(stack.markerPct).toBeLessThan(100);
    expect((stack.markerPct ?? 0) + stack.overflowWidthPct).toBeCloseTo(100, 3);
    expect(stack.plannedLeftPct).toBeLessThan(stack.markerPct ?? 0);

    const summary = stackSummary(translate, 'Total', stack);
    expect(summary).toContain('400.0h');
    expect(summary).toContain('200.0h');
    expect(summary).toContain('600.0h');
    expect(summary).toContain('120.0%');
    expect(summary).toContain('500.0h');
    expect(summary.toLowerCase()).toContain('100%');
  });

  it('keeps a full stack at exactly 100% inside capacity', () => {
    const stack = capacityStack({
      burnHours: 40,
      plannedHours: 60,
      capacityHours: 100,
    });
    expect(stack.overflow).toBe(false);
    expect(stack.totalPct).toBe(100);
    expect(stack.markerPct).toBeNull();
    expect(stack.burnWidthPct).toBe(40);
    expect(stack.plannedLeftPct).toBe(40);
    expect(stack.plannedWidthPct).toBe(60);
    expect(stack.band).toBe('on_track');
  });

  it('leaves percent unknown when capacity is missing', () => {
    const stack = capacityStack({
      burnHours: 10,
      plannedHours: 5,
      capacityHours: null,
    });
    expect(stack.capacityHours).toBeNull();
    expect(stack.totalPct).toBeNull();
    expect(stack.overflow).toBe(false);
    expect(stack.band).toBe('unknown');
    expect(stack.plannedLeftPct).toBe(stack.burnWidthPct);
    expect(formatHours(stack.capacityHours)).toBe('—');
    expect(formatStackPct(stack.totalPct)).toBe('—');
    expect(stackSummary(translate, 'Rina', stack)).toContain('Capacity is not set');
  });
});

describe('utilization copy', () => {
  it('explains planned demand, burn, and capacity in en, de, and hu', () => {
    expect(en.utilization.plannedDemandHint).toBe(
      'Forecast hours on open (not done, not cancelled) tasks',
    );
    expect(en.utilization.burnDemandHint).toMatch(/actual hours/i);
    expect(en.utilization.capacityHint).toMatch(/weekdays/i);
    expect(en.utilization.burned).toBe('Burned');
    expect(en.utilization.marker100).toBe('100%');

    for (const catalog of [de, hu]) {
      expect(catalog.utilization.plannedDemandHint.length).toBeGreaterThan(10);
      expect(catalog.utilization.burnDemandHint.length).toBeGreaterThan(10);
      expect(catalog.utilization.capacityHint.length).toBeGreaterThan(10);
      expect(catalog.utilization.plannedDemandHint).not.toBe(en.utilization.plannedDemandHint);
      expect(catalog.utilization.barSummary).toContain('{total}');
      expect(catalog.utilization.barSummaryOver).toContain('{pct}');
      expect(catalog.utilization.barSummaryUnknown).toContain('{burn}');
    }
  });
});

describe('capacity bar type', () => {
  const css = readFileSync(join(here, '../styles/ops-shell.css'), 'utf8');

  it('uses the UI sans for hours and a hatch plus warning tokens for segments', () => {
    const hours = ruleBody(css, '.kh-ops-capacity-hours');
    expect(hours).toMatch(/font-sans/);
    expect(hours).toMatch(/tabular-nums/);
    expect(hours).not.toMatch(/mono/);

    const planned = ruleBody(css, '.kh-ops-capacity-planned', '--kh-accent-soft');
    expect(planned).toMatch(/--kh-accent-soft/);
    expect(planned).toMatch(/repeating-linear-gradient/);

    const burn = ruleBody(css, '.kh-ops-capacity-burn', '--kh-accent');
    expect(burn).toMatch(/--kh-accent/);
    expect(burn).not.toMatch(/#(?:[0-9a-fA-F]{3,8})/);

    const overflow = ruleBody(css, '.kh-ops-capacity-overflow', '--kh-warn');
    expect(overflow).toMatch(/--kh-warn/);
    expect(overflow).toMatch(/repeating-linear-gradient/);

    const legend = ruleBody(css, '.kh-ops-capacity-legend');
    expect(legend).toMatch(/font-sans/);
    expect(legend).not.toMatch(/mono/);
  });
});
