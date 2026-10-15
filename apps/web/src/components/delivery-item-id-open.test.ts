import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

function source(name: string): string {
  return readFileSync(join(here, name), 'utf8');
}

describe('delivery item id opens manage modal', () => {
  const idButton = source('DeliveryItemIdButton.tsx');
  const list = source('ProjectDeliveryList.tsx');
  const tree = source('ProjectDeliveryTree.tsx');
  const calendar = source('ProjectDeliveryCalendar.tsx');
  const panel = source('ProjectDeliveryPanel.tsx');
  const css = readFileSync(join(here, '../styles/ops-shell.css'), 'utf8');

  it('uses a shared button with propagation guards', () => {
    expect(idButton).toContain("type=\"button\"");
    expect(idButton).toContain('stopPropagation');
    expect(idButton).toContain('kh-ops-key-badge');
    expect(idButton).toContain('kh-ops-type-chip');
  });

  it('wires list and tree id chips to onManage handlers', () => {
    expect(list).toContain('DeliveryItemIdButton');
    expect(list).toContain('onManageRef.current(row.kind, row.entityId)');
    expect(tree).toContain('DeliveryItemIdButton');
    expect(tree).toContain('onSubOpen');
    expect(tree).toContain('onSubOpen={onManageTask ? () => onManageTask(task.id) : undefined}');
  });

  it('opens calendar grid entries and day-list keys without selecting the day', () => {
    expect(calendar).toContain('onOpenItem?: (item: CalendarItem) => void');
    expect(calendar).toContain('onHumanKeyOpen={onOpen}');
    expect(calendar).toContain('event.stopPropagation()');
    expect(calendar).toContain('button');
    expect(calendar).toContain('className="kh-ops-event-dot"');
    expect(panel).toContain('onOpenItem={(item) =>');
    expect(panel).toContain('setManageTaskId(taskId)');
    expect(panel).toContain("setManageAgile({ kind: 'milestone', id: milestoneId })");
  });

  it('styles key-badge and calendar entry buttons for pointer and focus', () => {
    expect(css).toMatch(/button\.kh-ops-key-badge[\s\S]*cursor: pointer/);
    expect(css).toMatch(/button\.kh-ops-key-badge:focus-visible[\s\S]*outline: 2px solid var\(--kh-accent\)/);
    expect(css).toMatch(/button\.kh-ops-event-dot[\s\S]*cursor: pointer/);
    expect(css).toMatch(/button\.kh-ops-event-dot:focus-visible[\s\S]*outline: 2px solid var\(--kh-accent\)/);
  });
});
