import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProjectDeliveryCalendar, type CalendarItem } from './ProjectDeliveryCalendar';
import { ToastProvider } from './ui/Toast';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useLocale: () => 'en',
}));

function hasNestedButton(fragment: string): boolean {
  const tags = fragment.match(/<\/?button\b[^>]*>/g) ?? [];
  let depth = 0;
  for (const tag of tags) {
    if (tag.startsWith('</')) {
      depth -= 1;
    } else {
      if (depth > 0) return true;
      depth += 1;
    }
  }
  return depth !== 0;
}

describe('ProjectDeliveryCalendar', () => {
  it('renders epic, story, and task entries without nesting buttons', () => {
    const items: CalendarItem[] = [
      {
        id: 'epic:1',
        kind: 'epic',
        title: 'Platform epic',
        date: '2026-10-15',
        status: 'in_progress',
        humanKey: 'FUR-E-1',
      },
      {
        id: 'story:1',
        kind: 'story',
        title: 'Story alpha',
        date: '2026-10-15',
        status: 'planned',
        humanKey: 'FUR-S-1',
      },
      {
        id: 'task:1',
        kind: 'task',
        title: 'Task beta',
        date: '2026-10-15',
        status: 'todo',
        humanKey: 'FUR-T-1',
        itemType: 'task',
      },
    ];

    const html = renderToStaticMarkup(
      <ToastProvider>
        <ProjectDeliveryCalendar
          projectId="p1"
          projectName="FurniTender"
          items={items}
          initialCursor={{ year: 2026, month: 9 }}
          initialToday="2026-10-15"
          onOpenItem={() => undefined}
        />
      </ToastProvider>,
    );

    expect(html).toContain('Platform epic');
    expect(html).toContain('Story alpha');
    expect(html).toContain('Task beta');
    expect(html).toContain('FUR-E-1');
    expect(html).toContain('FUR-S-1');
    expect(html).toContain('FUR-T-1');
    expect(html).not.toMatch(/<button[^>]*kh-ops-day/);
    expect(html).toMatch(/<button[^>]*kh-ops-event-dot[^>]*>Platform epic<\/button>/);
    expect(html).toMatch(/<button[^>]*kh-ops-key-badge[^>]*>FUR-T-1<\/button>/);

    const days = html.match(/<div class="kh-ops-day"[\s\S]*?<\/div>/g) ?? [];
    expect(days.length).toBeGreaterThan(0);
    const withEntries = days.filter((day) => day.includes('kh-ops-event-dot'));
    expect(withEntries.length).toBeGreaterThan(0);
    for (const day of withEntries) {
      expect(hasNestedButton(day)).toBe(false);
      expect(day).toMatch(/<button[^>]*kh-ops-event-dot/);
    }
  });
});
