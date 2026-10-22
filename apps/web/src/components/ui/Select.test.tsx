/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Field } from './Field';
import { Select } from './Select';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}));

const here = dirname(fileURLToPath(import.meta.url));
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

function click(element: Element | null | undefined) {
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function press(keyName: string, target?: EventTarget | null) {
  const node = target ?? document.activeElement ?? document.body;
  act(() => {
    node.dispatchEvent(
      new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true }),
    );
  });
}

function triggerOf(container: ParentNode): HTMLButtonElement {
  const button = container.querySelector('.kh-select-trigger');
  if (!(button instanceof HTMLButtonElement)) throw new Error('missing select trigger');
  return button;
}

function nativeOf(container: ParentNode): HTMLSelectElement {
  const select = container.querySelector('select.kh-select-native');
  if (!(select instanceof HTMLSelectElement)) throw new Error('missing native select');
  return select;
}

function Harness({
  onChange,
  disabled,
  required,
}: {
  onChange?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  const [value, setValue] = useState('alpha');
  return (
    <Field label="Status">
      <Select
        name="status"
        value={value}
        required={required}
        disabled={disabled}
        data-modal-initial-focus
        onChange={(event) => {
          setValue(event.target.value);
          onChange?.(event.target.value);
        }}
      >
        <option value="alpha">Alpha</option>
        <option value="beta">Beta</option>
        <option value="gamma">Gamma</option>
        <option value="gone" disabled>
          Gone
        </option>
      </Select>
    </Field>
  );
}

describe('Select listbox', () => {
  it('keeps a single ink border on the selected row and sans on the trigger', () => {
    const css = readFileSync(join(here, '../../styles/ops-shell.css'), 'utf8');
    const selected = css.match(
      /\.kh-ops-select-menu \.kh-ops-choice\[aria-selected='true'\][\s\S]*?\{([^}]*)\}/,
    );
    expect(selected?.[1]).toContain('border: 1px solid var(--kh-ink)');
    expect(selected?.[1]).toContain('background: transparent');
    expect(selected?.[1]).toContain('outline: none');
    expect(selected?.[1]).toContain('box-shadow: none');
    expect(css).toContain('.kh-ops-select-menu .kh-ops-choice::-moz-focus-inner');
    expect(css).toContain('background: var(--kh-neutral-soft)');
    expect(css).toContain('max-height: min(24rem, calc(100vh - 1rem))');
    expect(css).toContain('overflow: auto');
    expect(css).toContain('z-index: calc(var(--kh-z-modal) + 2)');
    const trigger = css.match(/(?:^|\n)\.kh-select-trigger \{([^}]*)\}/);
    expect(trigger?.[1]).toContain('font-family: var(--font-sans)');
    expect(trigger?.[1] ?? '').not.toMatch(/font-mono|monospace/);
  });

  it('submits name and value, and commits with Enter after arrows', () => {
    const changes: string[] = [];
    const container = render(<Harness onChange={(value) => changes.push(value)} />);
    const trigger = triggerOf(container);
    const hidden = nativeOf(container);
    expect(trigger.className).not.toContain('font-mono');
    expect(trigger.textContent).toContain('Alpha');
    expect(hidden.name).toBe('status');
    expect(hidden.value).toBe('alpha');
    expect(hidden.tabIndex).toBe(-1);
    expect(hidden.getAttribute('aria-hidden')).toBe('true');
    expect(trigger.hasAttribute('data-modal-initial-focus')).toBe(true);
    expect(container.querySelector('label')?.textContent).toContain('Status');

    click(trigger);
    const listbox = document.body.querySelector('[role="listbox"]');
    expect(listbox?.getAttribute('aria-label')).toContain('Status');
    const selected = listbox?.querySelector('[aria-selected="true"]');
    expect(selected?.textContent).toBe('Alpha');
    expect(selected?.className).toContain('kh-ops-choice');
    expect(document.body.querySelector('.kh-ops-select-menu')).toBeTruthy();

    press('ArrowDown');
    expect(changes).toEqual([]);
    expect(hidden.value).toBe('alpha');
    press('Enter');
    expect(changes).toEqual(['beta']);
    expect(nativeOf(container).value).toBe('beta');
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(triggerOf(container));
  });

  it('closes on Escape without changing the value and restores focus', () => {
    const changes: string[] = [];
    const container = render(<Harness onChange={(value) => changes.push(value)} />);
    click(triggerOf(container));
    press('ArrowDown');
    press('Escape');
    expect(changes).toEqual([]);
    expect(nativeOf(container).value).toBe('alpha');
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(triggerOf(container));
  });

  it('jumps with Home, End, type-ahead, and Space', () => {
    const changes: string[] = [];
    const container = render(<Harness onChange={(value) => changes.push(value)} />);
    click(triggerOf(container));
    press('End');
    expect(document.activeElement?.textContent).toBe('Gamma');
    press('Home');
    expect(document.activeElement?.textContent).toBe('Alpha');
    press('g');
    expect(document.activeElement?.textContent).toBe('Gamma');
    press('Enter');
    expect(changes).toEqual(['gamma']);
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();

    click(triggerOf(container));
    press('ArrowUp');
    press(' ');
    expect(changes).toEqual(['gamma', 'beta']);
  });

  it('does not open when disabled and keeps required on the native control', () => {
    const container = render(<Harness disabled required />);
    const trigger = triggerOf(container);
    expect(trigger.disabled).toBe(true);
    expect(nativeOf(container).disabled).toBe(true);
    expect(nativeOf(container).required).toBe(true);
    click(trigger);
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
  });

  it('blocks an empty required value and then accepts a choice', () => {
    const container = render(
      <form>
        <Select name="workspaceId" defaultValue="" required>
          <option value="">Any</option>
          <option value="ws-1">Lab</option>
        </Select>
      </form>,
    );
    const hidden = nativeOf(container);
    expect(hidden.required).toBe(true);
    expect(hidden.value).toBe('');
    expect(hidden.checkValidity()).toBe(false);
    click(triggerOf(container));
    const lab = [...document.body.querySelectorAll('[role="option"]')].find(
      (option) => option.textContent === 'Lab',
    );
    click(lab);
    expect(nativeOf(container).value).toBe('ws-1');
    expect(nativeOf(container).checkValidity()).toBe(true);
    expect(
      new FormData(container.querySelector('form') as HTMLFormElement).get('workspaceId'),
    ).toBe('ws-1');
  });

  it('renders optgroup labels and a secondary-button trigger', () => {
    const container = render(
      <Select variant="button" defaultValue="a" aria-label="Move">
        <option value="">None</option>
        <optgroup label="North">
          <option value="a">Alpha</option>
          <option value="b">Beta</option>
        </optgroup>
      </Select>,
    );
    const trigger = triggerOf(container);
    expect(trigger.className).toContain('kh-btn-secondary');
    expect(trigger.className).not.toContain('font-mono');
    click(trigger);
    const group = document.body.querySelector('[role="group"]');
    expect(group?.getAttribute('aria-label')).toBe('North');
    expect(group?.textContent).toContain('North');
    expect(group?.textContent).toContain('Beta');
  });

  it('scrolls a long list inside the menu', () => {
    const container = render(
      <Select defaultValue="0" aria-label="Rows">
        {Array.from({ length: 40 }, (_, index) => (
          <option key={index} value={String(index)}>
            {`Row ${index}`}
          </option>
        ))}
      </Select>,
    );
    click(triggerOf(container));
    const menu = document.body.querySelector('.kh-ops-select-menu');
    expect(menu).toBeTruthy();
    expect(menu?.querySelectorAll('[role="option"]').length).toBe(40);
    press('End');
    expect(document.activeElement?.textContent).toBe('Row 39');
  });

  it('opens from the field label once', () => {
    const container = render(<Harness />);
    const label = container.querySelector('label');
    click(label);
    expect(document.body.querySelector('[role="listbox"]')).toBeTruthy();
  });

  it('handles Escape before a document dialog listener', () => {
    const seen: string[] = [];
    function onDialog(event: Event) {
      if (event instanceof KeyboardEvent && event.key === 'Escape') seen.push('dialog');
    }
    document.addEventListener('keydown', onDialog);
    const container = render(<Harness />);
    click(triggerOf(container));
    press('Escape');
    document.removeEventListener('keydown', onDialog);
    expect(seen).toEqual([]);
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
  });

  it('closes when the pointer goes outside', () => {
    const container = render(<Harness />);
    click(triggerOf(container));
    expect(document.body.querySelector('[role="listbox"]')).toBeTruthy();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
  });

  it('restores defaultValue when the form resets', () => {
    const container = render(
      <form>
        <Select name="period" defaultValue="month">
          <option value="month">Month</option>
          <option value="year">Year</option>
        </Select>
        <button type="reset">Reset</button>
      </form>,
    );
    click(triggerOf(container));
    const year = [...document.body.querySelectorAll('[role="option"]')].find(
      (option) => option.textContent === 'Year',
    );
    click(year);
    expect(nativeOf(container).value).toBe('year');
    click(container.querySelector('button[type="reset"]'));
    expect(nativeOf(container).value).toBe('month');
    expect(triggerOf(container).textContent).toContain('Month');
  });

  it('leaves a multi-row select native', () => {
    const container = render(
      <Select multiple defaultValue={['a']} aria-label="Tags">
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </Select>,
    );
    expect(container.querySelector('.kh-select-trigger')).toBeNull();
    expect(container.querySelector('select')?.multiple).toBe(true);
  });
});
