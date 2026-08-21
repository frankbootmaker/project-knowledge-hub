'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, Modal } from '../ui';
import { cn } from '../../lib/cn';

const PRESET_COLORS = [
  '#111111',
  '#1A1A1A',
  '#5A6270',
  '#374151',
  '#0B5FFF',
  '#0F766E',
  '#6F42C1',
  '#B45309',
  '#B91C1C',
  '#FFFFFF',
] as const;

function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (/^#[0-9A-Fa-f]{6}$/.test(withHash)) {
    return withHash.toUpperCase();
  }
  if (/^#[0-9A-Fa-f]{3}$/.test(withHash)) {
    const [, r, g, b] = withHash;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return null;
}

export function StylePackColorField(props: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(props.value);
  const [hexText, setHexText] = useState(props.value);

  useEffect(() => {
    if (!open) {
      return;
    }
    const next = normalizeHex(props.value) ?? props.value;
    setDraft(next);
    setHexText(next);
  }, [open, props.value]);

  const display = normalizeHex(props.value) ?? props.value;
  const draftValid = normalizeHex(draft) ?? normalizeHex(hexText);

  function applyDraft() {
    const next = normalizeHex(hexText) ?? normalizeHex(draft);
    if (!next) {
      return;
    }
    props.onChange(next);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        disabled={props.disabled}
        className={cn(
          'kh-input flex w-full items-center gap-3 text-left',
          props.disabled && 'cursor-not-allowed opacity-60',
        )}
        onClick={() => setOpen(true)}
        aria-label={t('templatesPickColor', { label: props.label })}
      >
        <span
          className="kh-ops-color-swatch"
          style={{ backgroundColor: display }}
          aria-hidden
        />
        <span className="font-mono text-sm uppercase tracking-wide">{display}</span>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('templatesColorPickerTitle', { label: props.label })}
        description={t('templatesColorPickerBlurb')}
        size="md"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={!draftValid}
              onClick={applyDraft}
            >
              {tCommon('save')}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <input
              type="color"
              data-modal-initial-focus
              value={normalizeHex(draft) ?? '#111111'}
              onChange={(event) => {
                const next = event.target.value.toUpperCase();
                setDraft(next);
                setHexText(next);
              }}
              className="kh-ops-color-input"
              aria-label={props.label}
            />
            <label className="grid min-w-[10rem] flex-1 gap-1 text-sm">
              <span className="text-ink-muted">{t('templatesColorHex')}</span>
              <Input
                value={hexText}
                spellCheck={false}
                onChange={(event) => {
                  const raw = event.target.value;
                  setHexText(raw);
                  const next = normalizeHex(raw);
                  if (next) {
                    setDraft(next);
                  }
                }}
                placeholder="#1A1A1A"
              />
            </label>
          </div>

          <div className="grid gap-2">
            <p className="m-0 text-sm text-ink-muted">{t('templatesColorPresets')}</p>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((color) => {
                const active =
                  (normalizeHex(draft) ?? '').toUpperCase() === color;
                return (
                  <button
                    key={color}
                    type="button"
                    title={color}
                    aria-label={color}
                    aria-pressed={active}
                    className="kh-ops-color-swatch"
                    style={{ backgroundColor: color }}
                    onClick={() => {
                      setDraft(color);
                      setHexText(color);
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
