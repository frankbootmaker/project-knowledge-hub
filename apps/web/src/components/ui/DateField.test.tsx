/**
 * @vitest-environment happy-dom
 */
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateField, DateRangeFields, parseDateInput } from './DateField';
import { AiCostPeriodForm } from '../financials/AiCostPeriodForm';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => {
      entry.root.unmount();
    });
    entry.container.remove();
  }
});

function render(node: ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  mounted.push({ root, container });
  return container;
}

function setControl(element: HTMLInputElement, value: string) {
  act(() => {
    const prototype = Object.getPrototypeOf(element) as object;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('parseDateInput', () => {
  it('accepts ISO and locale forms', () => {
    expect(parseDateInput('2026-10-19', 'en')).toBe('2026-10-19');
    expect(parseDateInput('10/19/2026', 'en')).toBe('2026-10-19');
    expect(parseDateInput('19.10.2026', 'de')).toBe('2026-10-19');
    expect(parseDateInput('2026. 10. 19.', 'hu')).toBe('2026-10-19');
    expect(parseDateInput('nope', 'en')).toBeNull();
    expect(parseDateInput('', 'en')).toBe('');
  });
});

describe('DateField', () => {
  it('fills the field from the calendar and still accepts typed ISO', () => {
    const changes: string[] = [];
    render(<DateField value="" onChange={(iso) => changes.push(iso)} />);
    const open = document.body.querySelector('.kh-date-icon') as HTMLButtonElement;
    expect(open.closest('.kh-date-control')?.querySelector('[data-date-field]')).toBeTruthy();
    expect(document.body.querySelector('.kh-date-open')).toBeNull();
    act(() => {
      open.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    const day = [...document.body.querySelectorAll('.kh-date-day')].find(
      (button) => button.textContent === '19',
    ) as HTMLButtonElement;
    expect(day.className).not.toContain('font-mono');
    act(() => {
      day.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(changes.at(-1)).toMatch(/-19$/);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    const input = document.body.querySelector('[data-date-field]') as HTMLInputElement;
    setControl(input, '2026-11-06');
    expect(changes.at(-1)).toBe('2026-11-06');
  });

  it('moves with the arrow keys and closes on Escape', () => {
    render(<DateField value="2026-10-19" onChange={() => undefined} />);
    const open = [...document.body.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === 'openCalendar',
    );
    act(() => {
      open?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const day = document.body.querySelector('.kh-date-day.is-selected') as HTMLButtonElement;
    act(() => {
      day.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    const focused = document.activeElement as HTMLButtonElement;
    expect(focused.textContent).toBe('20');
    act(() => {
      focused.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});

function RangeHarness() {
  const [range, setRange] = useState({ from: '', to: '' });
  return (
    <DateRangeFields
      from={range.from}
      to={range.to}
      fromLabel="From"
      toLabel="To"
      onChange={setRange}
    />
  );
}

describe('DateRangeFields', () => {
  it('keeps the calendar icon inside each field and one picker sets both dates', () => {
    render(<RangeHarness />);
    const controls = [...document.body.querySelectorAll('.kh-date-control')];
    expect(controls).toHaveLength(2);
    for (const control of controls) {
      expect(control.querySelector('.kh-date-icon')).toBeTruthy();
      expect(control.querySelector('[data-date-field]')).toBeTruthy();
    }
    expect(document.body.querySelector('.kh-date-open')).toBeNull();
    const open = controls[1]?.querySelector('.kh-date-icon') as HTMLButtonElement;
    act(() => {
      open.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    const day = (label: string) =>
      [...document.body.querySelectorAll('.kh-date-day')].find(
        (button) => button.textContent === label,
      ) as HTMLButtonElement;
    act(() => {
      day('6')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    act(() => {
      day('19')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const inputs = [...document.body.querySelectorAll('[data-date-field]')] as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    const start = inputs[0]?.getAttribute('data-iso') ?? '';
    const end = inputs[1]?.getAttribute('data-iso') ?? '';
    expect(start).toMatch(/-06$/);
    expect(end).toMatch(/-19$/);
    expect(start < end).toBe(true);
    act(() => {
      open.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const between = [...document.body.querySelectorAll('.kh-date-day.is-in-range')];
    expect(between.length).toBeGreaterThan(0);
    expect(
      between.every((button) => {
        const iso = button.getAttribute('data-iso') ?? '';
        return iso > start && iso < end;
      }),
    ).toBe(true);
  });
});

describe('AiCostPeriodForm presets', () => {
  it('places this quarter and this month beside this year', () => {
    render(
      <AiCostPeriodForm action="/admin/financials" from="2026-01" to="2026-10" range="year" />,
    );
    const labels = [...document.body.querySelectorAll('a')].map((link) => link.textContent);
    const year = labels.indexOf('presetYear');
    expect(labels[year + 1]).toBe('presetQuarter');
    expect(labels[year + 2]).toBe('presetMonth');
    const quarter = [...document.body.querySelectorAll('a')].find(
      (link) => link.textContent === 'presetQuarter',
    );
    expect(quarter?.getAttribute('href')).toContain('range=quarter');
    expect(quarter?.getAttribute('href')).not.toContain('from=');
    const dates = [...document.body.querySelectorAll('input[type="date"]')];
    expect(dates).toHaveLength(2);
    for (const input of dates) {
      expect(input.parentElement?.className).toContain('kh-ops-period-field');
      expect(input.previousElementSibling?.tagName).toBe('SPAN');
    }
  });
});
