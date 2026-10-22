/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../messages/en.json';
import { UtilizationStackBar } from './UtilizationStackBar';

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
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        {node}
      </NextIntlClientProvider>,
    );
  });
  mounted.push({ root, container });
  return container;
}

function segment(container: HTMLElement, name: string): HTMLElement {
  const node = container.querySelector(`[data-segment="${name}"]`);
  if (!(node instanceof HTMLElement)) {
    throw new Error(`Missing ${name} segment`);
  }
  return node;
}

describe('UtilizationStackBar', () => {
  it('shows adjacent burned and planned segments totalling 73h (13.8%)', () => {
    const container = render(
      <UtilizationStackBar
        name="Alex Morgan"
        burnHours={69.5}
        plannedHours={3.5}
        capacityHours={528}
      />,
    );
    const track = container.querySelector('.kh-ops-capacity-track');
    expect(track).toBeTruthy();
    expect(track?.getAttribute('role')).toBe('img');
    expect(track?.getAttribute('data-overflow')).toBe('false');
    expect(track?.getAttribute('data-total-hours')).toBe('73');
    expect(track?.getAttribute('data-total-pct')).toBe('13.8');
    expect(track?.getAttribute('aria-label')).toContain('69.5h');
    expect(track?.getAttribute('aria-label')).toContain('3.5h');
    expect(track?.getAttribute('aria-label')).toContain('73.0h');
    expect(track?.getAttribute('aria-label')).toContain('13.8%');
    expect(track?.getAttribute('aria-label')).toContain('528.0h');

    const burn = segment(container, 'burn');
    const planned = segment(container, 'planned');
    expect(burn.style.width).toBe('13.1629%');
    expect(planned.style.left).toBe(burn.style.width);
    expect(planned.style.width).toBe('0.6629%');
    expect(container.querySelector('[data-segment="overflow"]')).toBeNull();
    expect(container.querySelector('[data-marker="100"]')).toBeNull();
    expect(container.textContent).toContain('73.0h');
    expect(container.textContent).toContain('13.8%');
    expect(container.textContent).toContain('Burned');
    expect(container.textContent).toContain('Planned demand');
  });

  it('shows the overflow tail and a 100% marker past capacity', () => {
    const container = render(
      <UtilizationStackBar name="Total" burnHours={400} plannedHours={200} capacityHours={500} />,
    );
    const track = container.querySelector('.kh-ops-capacity-track');
    expect(track?.getAttribute('data-overflow')).toBe('true');
    expect(track?.getAttribute('data-total-hours')).toBe('600');
    expect(track?.getAttribute('data-total-pct')).toBe('120');
    expect(track?.getAttribute('aria-label')).toContain('100%');

    const burn = segment(container, 'burn');
    const planned = segment(container, 'planned');
    const overflow = segment(container, 'overflow');
    const marker = container.querySelector('[data-marker="100"]');
    expect(planned.style.left).toBe(burn.style.width);
    expect(burn.style.width).toBe('66.6667%');
    expect(planned.style.width).toBe('33.3333%');
    expect(overflow.style.left).toBe('83.3333%');
    expect(overflow.style.width).toBe('16.6667%');
    expect(marker).toBeTruthy();
    expect(marker?.textContent).toContain('100%');
    expect(overflow.className).toContain('kh-ops-capacity-overflow');
  });
});
