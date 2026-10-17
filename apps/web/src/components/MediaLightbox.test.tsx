/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaLightbox } from './MediaLightbox';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next-intl', () => {
  const translate = (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key;
  return {
    useTranslations: () => translate,
  };
});

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => {
      entry.root.unmount();
    });
    entry.container.remove();
  }
  document.body.style.removeProperty('overflow');
});

function renderUi(node: ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  mounted.push({ root, container });
  return container;
}

const items = [
  { id: 'a', url: '/api/v1/media/a', title: 'First' },
  { id: 'b', url: '/api/v1/media/b', title: 'Second' },
];

describe('MediaLightbox', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { origin: 'https://app.test' });
  });

  it('renders nothing when closed', () => {
    renderUi(
      <MediaLightbox
        open={false}
        items={items}
        index={0}
        onClose={vi.fn()}
        onIndexChange={vi.fn()}
      />,
    );
    expect(document.querySelector('.kh-media-lightbox')).toBeNull();
  });

  it('shows the image, open-original link, and loading state', () => {
    renderUi(
      <MediaLightbox
        open
        items={items}
        index={0}
        onClose={vi.fn()}
        onIndexChange={vi.fn()}
      />,
    );
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const img = document.querySelector(
      '.kh-media-lightbox__img',
    ) as HTMLImageElement;
    expect(img.src).toContain('/api/v1/media/a');
    expect(img.alt).toBe('First');
    expect(img.className).toContain('kh-media-lightbox__img--loading');
    const openLink = document.querySelector(
      '.kh-media-lightbox__open',
    ) as HTMLAnchorElement;
    expect(openLink.href).toBe('https://app.test/api/v1/media/a');
    expect(openLink.textContent).toBe('lightboxOpenOriginal');
  });

  it('closes on Escape and backdrop click', () => {
    const onClose = vi.fn();
    renderUi(
      <MediaLightbox
        open
        items={items}
        index={0}
        onClose={onClose}
        onIndexChange={vi.fn()}
      />,
    );
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    const backdrop = document.querySelector(
      '.kh-media-lightbox__backdrop',
    ) as HTMLButtonElement;
    act(() => {
      backdrop.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('navigates with arrow keys and next button', () => {
    const onIndexChange = vi.fn();
    renderUi(
      <MediaLightbox
        open
        items={items}
        index={0}
        onClose={vi.fn()}
        onIndexChange={onIndexChange}
      />,
    );
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    });
    expect(onIndexChange).toHaveBeenCalledWith(1);

    const nextBtn = [...document.querySelectorAll('button')].find(
      (btn) => btn.textContent === 'lightboxNext',
    );
    expect(nextBtn).toBeTruthy();
    act(() => {
      nextBtn!.click();
    });
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });
});
