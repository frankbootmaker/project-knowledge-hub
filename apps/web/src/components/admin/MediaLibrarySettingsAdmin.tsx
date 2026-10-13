'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, ErrorText, Field, Input, useToast } from '../ui';

type Settings = {
  allowedTypes: string[];
  maxBytes: number;
  ceilingBytes: number;
};

export function MediaLibrarySettingsAdmin() {
  const t = useTranslations('admin');
  const { pushToast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mib, setMib] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void fetch('/api/v1/admin/media-library-settings', { credentials: 'include' })
      .then(async (response) => {
        const payload = (await response.json()) as {
          settings?: Settings;
          error?: { message?: string };
        };
        if (!response.ok || !payload.settings) {
          setError(payload.error?.message || t('mediaSettingsFailed'));
          return;
        }
        setSettings(payload.settings);
        setMib(String(Math.round((payload.settings.maxBytes / (1024 * 1024)) * 100) / 100));
      })
      .catch(() => setError(t('mediaSettingsFailed')));
  }, [t]);

  async function save() {
    if (!settings) return;
    const value = Number(mib);
    if (!Number.isFinite(value) || value <= 0) {
      setError(t('mediaSettingsInvalid'));
      return;
    }
    const maxBytes = Math.round(value * 1024 * 1024);
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/media-library-settings', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({ maxBytes }),
      });
      const payload = (await response.json()) as {
        settings?: Settings;
        error?: { message?: string };
      };
      if (!response.ok || !payload.settings) {
        throw new Error(payload.error?.message || t('mediaSettingsFailed'));
      }
      setSettings(payload.settings);
      setMib(String(Math.round((payload.settings.maxBytes / (1024 * 1024)) * 100) / 100));
      pushToast(t('mediaSettingsSaved'), 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('mediaSettingsFailed'));
    } finally {
      setPending(false);
    }
  }

  const ceilingMib = settings
    ? Math.round((settings.ceilingBytes / (1024 * 1024)) * 100) / 100
    : null;

  return (
    <section className="kh-ops-panel">
      <div className="kh-ops-panel-head">
        <h2 className="kh-ops-panel-title">{t('mediaLibraryTab')}</h2>
      </div>
      <div className="kh-ops-card-body grid gap-3">
        <p className="m-0 text-sm text-ink-muted">{t('mediaLibraryBlurb')}</p>
        <p className="m-0 text-sm">
          {t('mediaTypesFixed')}: {settings?.allowedTypes.join(', ') ?? '…'}
        </p>
        <Field label={t('mediaMaxBytes')}>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            value={mib}
            disabled={!settings || pending}
            onChange={(event) => setMib(event.target.value)}
          />
        </Field>
        {ceilingMib != null ? (
          <p className="m-0 text-xs text-ink-muted">
            {t('mediaMaxBytesHint', { ceiling: ceilingMib })}
          </p>
        ) : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
        <div>
          <Button type="button" disabled={!settings || pending} onClick={() => void save()}>
            {t('mediaSettingsSave')}
          </Button>
        </div>
      </div>
    </section>
  );
}
