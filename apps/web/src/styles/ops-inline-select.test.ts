import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import de from '../../messages/de.json';
import en from '../../messages/en.json';
import hu from '../../messages/hu.json';

const here = dirname(fileURLToPath(import.meta.url));

function source(relativePath: string): string {
  return readFileSync(join(here, relativePath), 'utf8');
}

/**
 * Content box inside a 10rem select after 0.75rem start padding and 2rem end
 * padding (chevron). Measured in Chrome at 12px: about 114px. The longest
 * current label ("Product Owner") is about 80px in Liberation Sans, so 16
 * characters leaves headroom before the floor must grow.
 */
const MAX_LABEL_CHARS = 16;

type Messages = {
  delivery: {
    taskStatus: Record<string, string>;
    milestoneStatus: Record<string, string>;
  };
  raid: { status: Record<string, string> };
  changes: { status: Record<string, string> };
  stakeholders: { projectRole: Record<string, string> };
};

function labels(messages: Messages, locale: string): Array<[string, string]> {
  const groups: Array<[string, Record<string, string>]> = [
    ['delivery.taskStatus', messages.delivery.taskStatus],
    ['delivery.milestoneStatus', messages.delivery.milestoneStatus],
    ['raid.status', messages.raid.status],
    ['changes.status', messages.changes.status],
    ['stakeholders.projectRole', messages.stakeholders.projectRole],
  ];
  return groups.flatMap(([group, values]) =>
    Object.entries(values).map(
      ([key, label]) => [`${locale}.${group}.${key}`, label] as [string, string],
    ),
  );
}

describe('inline table selects', () => {
  const css = source('ops-shell.css');

  it('keeps a 10rem floor and chevron padding on data-table selects', () => {
    expect(css).toContain('.kh-ops-data-table td:has(> select.kh-input)');
    const rule = css.match(
      /\.kh-ops-inline-select,\s*\.kh-ops-data-table td select\.kh-input \{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    const body = rule?.[1] ?? '';
    expect(body).toContain('min-width: 10rem');
    expect(body).toContain('width: max-content');
    expect(body).toContain('max-width: none');
    expect(body).toContain('field-sizing: content');
    expect(body).toContain('padding-inline-end: 2rem');
    expect(body).toContain('white-space: nowrap');
    expect(body).toContain('flex-shrink: 0');
  });

  it('still wraps text columns and nowraps status columns', () => {
    expect(css).toMatch(
      /\.kh-ops-data-table th\.kh-ops-cell-text,[\s\S]*?white-space: normal;[\s\S]*?overflow-wrap: anywhere;/,
    );
    expect(css).toMatch(
      /\.kh-ops-data-table \.kh-ops-cell-status,[\s\S]*?width: 1%;[\s\S]*?white-space: nowrap;/,
    );
  });

  it('marks the delivery status select and the stakeholder role select', () => {
    const delivery = source('../components/ProjectDeliveryList.tsx');
    const stakeholders = source('../components/ProjectStakeholdersList.tsx');
    expect(delivery).toContain('className="kh-ops-inline-select h-9 min-h-9 py-0 text-xs"');
    expect(stakeholders).toContain('kh-ops-inline-select');
    expect(source('../components/ProjectRaidList.tsx')).not.toContain('<Select');
    expect(source('../components/ProjectChangeList.tsx')).not.toContain('<Select');
  });

  it('fits en, hu, and de status and role labels inside the 10rem floor', () => {
    const all = [
      ...labels(en as Messages, 'en'),
      ...labels(hu as Messages, 'hu'),
      ...labels(de as Messages, 'de'),
    ];
    const tooLong = all.filter(([, label]) => label.length > MAX_LABEL_CHARS);
    expect(tooLong).toEqual([]);
    expect(all.some(([, label]) => label === 'In progress')).toBe(true);
    expect(all.some(([, label]) => label === 'Folyamatban')).toBe(true);
    expect(all.some(([, label]) => label === 'Abgebrochen')).toBe(true);
    expect(all.some(([, label]) => label === 'Vorgeschlagen')).toBe(true);
    expect(all.some(([, label]) => label === 'Kezelés alatt')).toBe(true);
    expect(all.some(([, label]) => label === 'Közreműködő')).toBe(true);
  });
});
