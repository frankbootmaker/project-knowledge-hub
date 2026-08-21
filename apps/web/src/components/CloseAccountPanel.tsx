'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, ErrorText, Field, Input, useToast } from './ui';

const CLOSE_PHRASE = 'CLOSE';

export function CloseAccountPanel() {
  const t = useTranslations('profile');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { pushToast } = useToast();
  const [closeStep, setCloseStep] = useState<0 | 1 | 2>(0);
  const [closePhrase, setClosePhrase] = useState('');
  const [closeAcknowledged, setCloseAcknowledged] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function resetCloseFlow() {
    setCloseStep(0);
    setClosePhrase('');
    setCloseAcknowledged(false);
    setCloseError(null);
  }

  async function onCloseAccount() {
    if (closePhrase.trim() !== CLOSE_PHRASE || !closeAcknowledged) return;
    setPending(true);
    setCloseError(null);
    try {
      const response = await fetch('/api/v1/me', {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({ confirmPhrase: CLOSE_PHRASE }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('closeFailed'));
      }
      pushToast(t('closeDone'));
      router.replace('/login?accountClosed=1');
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('closeFailed');
      setCloseError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="kh-ops-panel kh-ops-danger-zone">
      <div className="kh-ops-panel-head">
        <h2 className="kh-ops-panel-title">{t('closeTitle')}</h2>
        <span className="kh-ops-panel-meta">{t('closeTitle')}</span>
      </div>
      <div className="kh-ops-danger-copy grid gap-3">
        {closeStep === 0 ? (
          <>
            <p className="m-0">{t('closeBlurb')}</p>
            <div>
              <Button
                type="button"
                variant="danger"
                disabled={pending}
                onClick={() => {
                  setCloseStep(1);
                  setClosePhrase('');
                  setCloseAcknowledged(false);
                  setCloseError(null);
                }}
              >
                {t('closeStart')}
              </Button>
            </div>
          </>
        ) : null}

        {closeStep === 1 ? (
          <>
            <p className="m-0 text-danger">{t('closeWarning1')}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="danger"
                disabled={pending}
                onClick={() => {
                  setCloseStep(2);
                  setClosePhrase('');
                  setCloseAcknowledged(false);
                }}
              >
                {t('closeContinue')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={resetCloseFlow}
              >
                {tCommon('cancel')}
              </Button>
            </div>
          </>
        ) : null}

        {closeStep === 2 ? (
          <>
            <p className="m-0 text-danger">{t('closeWarning2')}</p>
            <div className="kh-ops-form-grid">
              <Field
                className="kh-ops-field-span"
                label={t('closePhraseLabel', { phrase: CLOSE_PHRASE })}
              >
                <Input
                  value={closePhrase}
                  onChange={(e) => setClosePhrase(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={pending}
                  data-modal-initial-focus
                />
              </Field>
              <label className="kh-ops-field-span flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={closeAcknowledged}
                  disabled={pending}
                  onChange={(e) => setCloseAcknowledged(e.target.checked)}
                />
                <span>{t('closeAcknowledge')}</span>
              </label>
            </div>
            {closeError ? <ErrorText>{closeError}</ErrorText> : null}
          </>
        ) : null}
      </div>
      {closeStep === 2 ? (
        <div className="kh-ops-action-line">
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={resetCloseFlow}
          >
            {tCommon('cancel')}
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setCloseStep(1);
                setClosePhrase('');
                setCloseAcknowledged(false);
              }}
            >
              {t('closeBack')}
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={
                pending ||
                closePhrase.trim() !== CLOSE_PHRASE ||
                !closeAcknowledged
              }
              onClick={() => void onCloseAccount()}
            >
              {t('closeConfirmFinal')}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
