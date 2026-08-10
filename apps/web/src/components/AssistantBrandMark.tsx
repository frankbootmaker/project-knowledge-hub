'use client';

import { cn } from '../lib/cn';
import {
  ASSISTANT_BRANDS,
  resolveAssistantBrand,
  type AssistantBrand,
} from '../lib/assistant-brand';

const sizeClass = {
  sm: 'size-8',
  md: 'size-12',
  lg: 'size-20',
} as const;

const brandChrome: Record<
  AssistantBrand,
  { className: string; label: string }
> = {
  cursor: {
    className: 'border-[#26251e] bg-[#26251e] text-[#f7f7f4]',
    label: 'Cursor',
  },
  openai: {
    className: 'border-[#10a37f] bg-[#10a37f] text-white',
    label: 'OpenAI',
  },
  claude: {
    className: 'border-[#d97757] bg-[#d97757] text-white',
    label: 'Claude',
  },
  gemini: {
    className: 'border-[#4285f4] bg-[#4285f4] text-white',
    label: 'Gemini',
  },
  ollama: {
    className: 'border-ink bg-ink text-panel-solid',
    label: 'Ollama',
  },
  openwebui: {
    className: 'border-[#64748b] bg-[#64748b] text-white',
    label: 'Open WebUI',
  },
  generic: {
    className: 'border-brand/40 bg-brand-soft text-brand',
    label: 'AI',
  },
};

const BRAND_SET = new Set<string>(ASSISTANT_BRANDS);

function BrandGlyph({ brand }: { brand: AssistantBrand }) {
  // Stylized marks (not official trademarks) — readable at avatar size.
  switch (brand) {
    case 'cursor':
      return (
        <svg viewBox="0 0 24 24" className="size-[55%]" aria-hidden>
          <path
            fill="currentColor"
            d="M4 3.5 18.5 12 10 14.2 7.8 20.5 4 3.5Z"
          />
        </svg>
      );
    case 'openai':
      return (
        <svg viewBox="0 0 24 24" className="size-[58%]" aria-hidden>
          <path
            fill="currentColor"
            d="M12 3.2c1.6 0 3 .8 3.9 2.1a4.1 4.1 0 0 1 4.4 2.6 4.2 4.2 0 0 1-1.1 5.3 4.1 4.1 0 0 1-3.9 6.6A4.2 4.2 0 0 1 8.1 21a4.1 4.1 0 0 1-4.4-2.6 4.2 4.2 0 0 1 1.1-5.3A4.1 4.1 0 0 1 8.7 6.5 4.2 4.2 0 0 1 12 3.2Zm0 2.2a2 2 0 0 0-1.8 1.1l-.3.6-.7-.1a1.9 1.9 0 0 0-2.1 1.5l-.1.5-.5.2a2 2 0 0 0-.4 2.8l.4.5-.2.6a1.9 1.9 0 0 0 1.3 2.3l.6.2.1.7a2 2 0 0 0 2.7 1.3l.5-.2.5.4a1.9 1.9 0 0 0 2.6-.8l.3-.6.7.1a1.9 1.9 0 0 0 2.1-1.5l.1-.5.5-.2a2 2 0 0 0 .4-2.8l-.4-.5.2-.6a1.9 1.9 0 0 0-1.3-2.3l-.6-.2-.1-.7A2 2 0 0 0 14 6.6l-.5.2-.5-.4A1.9 1.9 0 0 0 12 5.4Z"
          />
        </svg>
      );
    case 'claude':
      return (
        <svg viewBox="0 0 24 24" className="size-[55%]" aria-hidden>
          <path
            fill="currentColor"
            d="M12 3 4.5 20h3.2l1.4-3.2h6.2L16.7 20H20L12 3Zm0 5.2 2.2 5.1H9.8L12 8.2Z"
          />
        </svg>
      );
    case 'gemini':
      return (
        <svg viewBox="0 0 24 24" className="size-[55%]" aria-hidden>
          <path
            fill="currentColor"
            d="M12 2c.4 4.2 1.6 7.2 4.2 9.8C13.6 14.4 12.4 17.4 12 22c-.4-4.6-1.6-7.6-4.2-10.2C10.4 9.2 11.6 6.2 12 2Z"
          />
        </svg>
      );
    case 'ollama':
      return (
        <svg viewBox="0 0 24 24" className="size-[60%]" aria-hidden>
          <ellipse cx="12" cy="13" rx="7" ry="6" fill="currentColor" />
          <circle
            cx="9.2"
            cy="12.2"
            r="1.1"
            fill="var(--color-panel-solid, #fff)"
          />
          <circle
            cx="14.8"
            cy="12.2"
            r="1.1"
            fill="var(--color-panel-solid, #fff)"
          />
        </svg>
      );
    case 'openwebui':
      return (
        <svg viewBox="0 0 24 24" className="size-[55%]" aria-hidden>
          <path
            fill="currentColor"
            d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7A2.5 2.5 0 0 1 16.5 16H13l-3.5 3.2V16H7.5A2.5 2.5 0 0 1 5 13.5v-7Z"
          />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" className="size-[55%]" aria-hidden>
          <path
            fill="currentColor"
            d="M8 10a4 4 0 1 1 8 0v1h1.5A2.5 2.5 0 0 1 20 13.5v2A2.5 2.5 0 0 1 17.5 18H6.5A2.5 2.5 0 0 1 4 15.5v-2A2.5 2.5 0 0 1 6.5 11H8v-1Zm2 1h4v-1a2 2 0 1 0-4 0v1Z"
          />
        </svg>
      );
  }
}

export function AssistantBrandMark({
  brand: brandProp,
  name,
  slug,
  size = 'md',
  className,
}: {
  brand?: string | null;
  name?: string | null;
  slug?: string | null;
  size?: keyof typeof sizeClass;
  className?: string;
}) {
  const brand = resolveAssistantBrand({
    name,
    slug,
    metadata:
      brandProp && BRAND_SET.has(brandProp)
        ? { assistantBrand: brandProp }
        : null,
  });
  const chrome = brandChrome[brand];

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border',
        sizeClass[size],
        chrome.className,
        className,
      )}
      title={chrome.label}
      aria-label={chrome.label}
    >
      <BrandGlyph brand={brand} />
    </span>
  );
}
