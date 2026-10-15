/**
 * @vitest-environment happy-dom
 *
 * Mounts the calendar the way production does: cursor and today start null,
 * then the clock effect fills them. That second render is the hook-order
 * path that used to throw React error #310.
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { todayYmd } from '../lib/delivery-schedule';
import { ProjectDeliveryCalendar, type CalendarItem } from './ProjectDeliveryCalendar';
import { ToastProvider } from './ui/Toast';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useLocale: () => 'en',
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

function renderCalendar(node: ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  mounted.push({ root, container });
  return container;
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function buttonByLabel(container: ParentNode, label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === label,
  );
  if (!match) throw new Error(`Missing button ${label}`);
  return match;
}

describe('ProjectDeliveryCalendar mount', () => {
  it('fills the clock, switches month, and selects a day', () => {
    const now = new Date();
    const today = todayYmd(now);
    const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonthIso = todayYmd(nextMonthDate);
    const opened: string[] = [];

    const items: CalendarItem[] = [
      {
        id: 'epic:1',
        kind: 'epic',
        title: 'Platform epic',
        date: today,
        status: 'in_progress',
        humanKey: 'FUR-E-1',
      },
      {
        id: 'story:1',
        kind: 'story',
        title: 'Story alpha',
        date: today,
        status: 'planned',
        humanKey: 'FUR-S-1',
      },
      {
        id: 'ms:1',
        kind: 'milestone',
        title: 'Release gate',
        date: today,
        status: 'planned',
        humanKey: 'FUR-M-1',
      },
      {
        id: 'task:1',
        kind: 'task',
        title: 'Task beta',
        date: nextMonthIso,
        status: 'todo',
        humanKey: 'FUR-T-1',
        itemType: 'task',
      },
    ];

    const container = renderCalendar(
      <ToastProvider>
        <ProjectDeliveryCalendar
          projectId="p1"
          projectName="FurniTender"
          items={items}
          onOpenItem={(item) => {
            opened.push(item.id);
          }}
        />
      </ToastProvider>,
    );

    expect(container.textContent).not.toContain('calendarLoading');
    const monthGrid = container.querySelector('.kh-ops-month');
    expect(monthGrid?.textContent).toContain('Platform epic');
    expect(monthGrid?.textContent).toContain('Story alpha');
    expect(monthGrid?.textContent).toContain('Release gate');
    expect(monthGrid?.textContent).not.toContain('Task beta');

    const monthHeading = () => container.querySelector('h3')?.textContent ?? '';
    const currentLabel = monthHeading();
    expect(currentLabel).toContain(`calendarMonths.${now.getMonth()}`);

    click(buttonByLabel(container, 'calendarNext'));

    expect(monthHeading()).toContain(`calendarMonths.${nextMonthDate.getMonth()}`);
    expect(monthHeading()).not.toBe(currentLabel);
    expect(monthGrid?.textContent).toContain('Task beta');
    expect(monthGrid?.textContent).not.toContain('Platform epic');

    const taskDay = [...container.querySelectorAll('.kh-ops-day')].find((day) =>
      day.textContent?.includes('Task beta'),
    );
    expect(taskDay?.getAttribute('data-selected')).not.toBe('true');
    if (!taskDay) throw new Error('Missing task day');
    click(taskDay);

    expect(taskDay.getAttribute('data-selected')).toBe('true');
    const agenda = container.querySelector('.kh-ops-stack');
    expect(agenda?.textContent).toContain('Task beta');
    expect(agenda?.textContent).toContain('FUR-T-1');
    expect(agenda?.textContent).not.toContain('Platform epic');

    const entry = taskDay.querySelector('button.kh-ops-event-dot');
    if (!entry) throw new Error('Missing calendar entry');
    click(entry);
    expect(opened).toEqual(['task:1']);

    const idButton = agenda?.querySelector('button.kh-ops-key-badge');
    expect(idButton?.textContent).toBe('FUR-T-1');
    if (!idButton) throw new Error('Missing item id');
    click(idButton);
    expect(opened).toEqual(['task:1', 'task:1']);
  });
});
