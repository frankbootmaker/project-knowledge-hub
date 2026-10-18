/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { AiBillingChart, AiBillingChartLegend } from './AiBillingChart';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

const labels = {
  subscription: 'Subscription',
  planChange: 'Plan change',
  onDemand: 'On-demand',
  paid: 'Paid',
  theoretical: 'Theoretical API',
  difference: 'Difference',
  ratio: 'Ratio',
  scheduled: 'scheduled',
};

const periods = [
  {
    period: '2026-09',
    paidCost: 0,
    subscription: 0,
    planChange: 0,
    onDemand: 0,
    legacyToken: 0,
    theoreticalApiCost: 0,
    difference: 0,
    ratio: null,
  },
  {
    period: '2026-10',
    paidCost: 35,
    subscription: 40,
    planChange: -10,
    onDemand: 5,
    legacyToken: 0,
    theoreticalApiCost: 30,
    difference: 5,
    ratio: 1.167,
  },
];

describe('AiBillingChart', () => {
  it('shows currency ticks, a locale month, and a tooltip that matches the month', () => {
    const container = render(
      <AiBillingChart
        periods={periods}
        ariaLabel="AI cost"
        locale="en"
        currency="USD"
        labels={labels}
      />,
    );
    expect(container.textContent).toContain('Oct 2026');
    expect(container.textContent).not.toContain('26-10');
    expect(container.querySelector('.kh-ops-ai-cost-tick')?.textContent).toMatch(/\$/);
    expect(container.textContent).not.toContain('-$0.00');
    const hit = [...container.querySelectorAll('.kh-ops-ai-cost-hit')].find((node) =>
      node.getAttribute('aria-label')?.includes('Oct 2026'),
    );
    expect(hit).toBeTruthy();
    act(() => {
      hit?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    const tip = container.querySelector('.kh-ops-ai-cost-tip');
    expect(tip?.textContent).toContain('Oct 2026');
    expect(tip?.textContent).toContain('Subscription');
    expect(tip?.textContent).toContain('$40.00');
    expect(tip?.textContent).toContain('$35.00');
    expect(tip?.textContent).toContain('$30.00');
    expect(tip?.textContent).toContain('$5.00');
    expect(tip?.textContent).toContain('1.167');
    const sub = container.querySelector('.kh-ops-ai-cost-sub');
    const line = container.querySelector('.kh-ops-ai-cost-line');
    expect(sub).toBeTruthy();
    expect(line).toBeTruthy();
  });

  it('greys a series that is zero in every month', () => {
    const container = render(
      <AiBillingChartLegend
        periods={periods.map((row) => ({ ...row, onDemand: 0 }))}
        labels={labels}
      />,
    );
    const onDemand = [...container.querySelectorAll('span')].find((node) =>
      node.textContent?.includes('On-demand'),
    );
    const subscription = [...container.querySelectorAll('span')].find((node) =>
      node.textContent?.includes('Subscription'),
    );
    expect(onDemand?.getAttribute('data-empty')).toBe('true');
    expect(subscription?.getAttribute('data-empty')).toBe('false');
  });
});
