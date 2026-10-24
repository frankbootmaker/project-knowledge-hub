/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageSwitcher } from './LanguageSwitcher';
import { LandingLangSegment } from './landing/LandingLangSegment';
import { setLocaleAction } from '../lib/locale';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${values.current ?? ''}:${values.next ?? ''}` : key,
}));

vi.mock('../lib/locale', () => ({
  setLocaleAction: vi.fn(async () => undefined),
}));

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

afterEach(() => {
  refresh.mockClear();
  vi.mocked(setLocaleAction).mockClear();
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

describe('language switch', () => {
  it('sets the locale once and does not refresh again from the client', async () => {
    const container = render(<LanguageSwitcher />);
    const button = container.querySelector('button');
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
    });
    expect(setLocaleAction).toHaveBeenCalledTimes(1);
    expect(setLocaleAction).toHaveBeenCalledWith('de');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('uses the same single action on the landing control', async () => {
    const container = render(<LandingLangSegment />);
    const button = container.querySelector('button');
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
    });
    expect(setLocaleAction).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });
});
