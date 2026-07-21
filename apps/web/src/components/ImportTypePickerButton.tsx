'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, Modal } from './ui';

const IMPORT_TYPES = [
  { id: 'paste_chat', available: true },
  { id: 'documents', available: false },
  { id: 'images', available: false },
] as const;

type ImportTypeId = (typeof IMPORT_TYPES)[number]['id'];

/**
 * Opens a modal to pick an import lane. Paste chat navigates to the existing
 * conversation-import flow; document/image conversion is reserved for later.
 */
export function ImportTypePickerButton({
  workspaceSlug,
  variant = 'primary',
  label,
}: {
  workspaceSlug: string;
  variant?: 'primary' | 'secondary';
  label?: string;
}) {
  const t = useTranslations('imports');
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function chooseType(typeId: ImportTypeId, available: boolean) {
    if (!available) {
      return;
    }
    setOpen(false);
    if (typeId === 'paste_chat') {
      router.push(`/workspaces/${workspaceSlug}/imports/new`);
    }
  }

  return (
    <>
      <Button type="button" variant={variant} onClick={() => setOpen(true)}>
        {label ?? t('new')}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('pickTypeTitle')}
        description={t('pickTypeBlurb')}
        size="lg"
      >
        <ul className="m-0 grid list-none gap-2 p-0">
          {IMPORT_TYPES.map((type, index) => (
            <li key={type.id}>
              <button
                type="button"
                disabled={!type.available}
                data-modal-initial-focus={index === 0 ? true : undefined}
                className="kh-panel-inset flex w-full cursor-pointer flex-col items-start gap-1 border border-line bg-panel-solid text-left transition hover:border-brand/35 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => chooseType(type.id, type.available)}
              >
                <span className="flex w-full flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink">{t(`type_${type.id}`)}</span>
                  <span className="text-xs font-medium text-ink-muted">
                    {type.available ? t('typeAvailable') : t('typeComingSoon')}
                  </span>
                </span>
                <span className="text-sm text-ink-muted">{t(`typeHint_${type.id}`)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
