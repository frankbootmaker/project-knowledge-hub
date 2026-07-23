'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  Panel,
  PasswordInput,
  Select,
  useToast,
} from '../ui';

export type PublicBlobSettings = {
  provider: 'disabled' | 's3';
  backupOffsite: boolean;
  s3Bucket: string;
  s3Region: string;
  s3Endpoint: string;
  s3ForcePathStyle: boolean;
  keyPrefix: string;
  hasAccessKeyId: boolean;
  hasSecretAccessKey: boolean;
  source: 'override' | 'env';
  effectiveProvider: string;
  envProvider: string;
};

export function StorageSettingsAdmin({
  initialSettings,
}: {
  initialSettings: PublicBlobSettings;
}) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { pushToast } = useToast();

  const [provider, setProvider] = useState(initialSettings.provider);
  const [backupOffsite, setBackupOffsite] = useState(initialSettings.backupOffsite);
  const [s3Bucket, setS3Bucket] = useState(initialSettings.s3Bucket);
  const [s3Region, setS3Region] = useState(initialSettings.s3Region);
  const [s3Endpoint, setS3Endpoint] = useState(initialSettings.s3Endpoint);
  const [s3ForcePathStyle, setS3ForcePathStyle] = useState(
    initialSettings.s3ForcePathStyle,
  );
  const [keyPrefix, setKeyPrefix] = useState(initialSettings.keyPrefix);
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [clearAccessKey, setClearAccessKey] = useState(false);
  const [clearSecret, setClearSecret] = useState(false);
  const [hasAccessKeyId, setHasAccessKeyId] = useState(
    initialSettings.hasAccessKeyId,
  );
  const [hasSecretAccessKey, setHasSecretAccessKey] = useState(
    initialSettings.hasSecretAccessKey,
  );
  const [source, setSource] = useState(initialSettings.source);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function applySettings(settings: PublicBlobSettings) {
    setProvider(settings.provider);
    setBackupOffsite(settings.backupOffsite);
    setS3Bucket(settings.s3Bucket);
    setS3Region(settings.s3Region);
    setS3Endpoint(settings.s3Endpoint);
    setS3ForcePathStyle(settings.s3ForcePathStyle);
    setKeyPrefix(settings.keyPrefix);
    setAccessKeyId('');
    setSecretAccessKey('');
    setClearAccessKey(false);
    setClearSecret(false);
    setHasAccessKeyId(settings.hasAccessKeyId);
    setHasSecretAccessKey(settings.hasSecretAccessKey);
    setSource(settings.source);
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/storage-settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          backupOffsite,
          s3Bucket,
          s3Region,
          s3Endpoint,
          s3ForcePathStyle,
          keyPrefix,
          s3AccessKeyId: clearAccessKey
            ? null
            : accessKeyId.trim()
              ? accessKeyId.trim()
              : undefined,
          s3SecretAccessKey: clearSecret
            ? null
            : secretAccessKey.trim()
              ? secretAccessKey.trim()
              : undefined,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        settings?: PublicBlobSettings;
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      if (body.settings) applySettings(body.settings);
      pushToast(t('storageSettingsSaved'));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('storageSettingsFailed'));
    } finally {
      setPending(false);
    }
  }

  async function resetToEnv() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/storage-settings', {
        method: 'DELETE',
        credentials: 'include',
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        settings?: PublicBlobSettings;
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      if (body.settings) applySettings(body.settings);
      pushToast(t('storageSettingsReset'));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('storageSettingsFailed'));
    } finally {
      setPending(false);
    }
  }

  async function testConnection() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/storage-settings/test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        key?: string;
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      pushToast(t('storageTestOk', { key: body.key ?? '' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('storageTestFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6">
      <Panel className="grid gap-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={source === 'override' ? 'brand' : 'neutral'}>
            {source === 'override'
              ? t('storageSourceOverride')
              : t('storageSourceEnv')}
          </Badge>
          <span className="text-sm text-ink-muted">
            {t('storageEnvProvider', { provider: initialSettings.envProvider })}
          </span>
        </div>
        <p className="m-0 text-sm text-ink-muted">{t('storageSettingsBlurb')}</p>

        <Field label={t('storageProvider')}>
          <Select
            value={provider}
            disabled={pending}
            onChange={(event) =>
              setProvider(event.target.value as 'disabled' | 's3')
            }
          >
            <option value="disabled">{t('storageProviderDisabled')}</option>
            <option value="s3">{t('storageProviderS3')}</option>
          </Select>
        </Field>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={backupOffsite}
            disabled={pending || provider === 'disabled'}
            onChange={(event) => setBackupOffsite(event.target.checked)}
          />
          {t('storageBackupOffsite')}
        </label>

        {provider === 's3' ? (
          <div className="grid gap-3">
            <Field label={t('storageS3Bucket')}>
              <Input
                value={s3Bucket}
                disabled={pending}
                onChange={(event) => setS3Bucket(event.target.value)}
                autoComplete="off"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('storageS3Region')}>
                <Input
                  value={s3Region}
                  disabled={pending}
                  onChange={(event) => setS3Region(event.target.value)}
                  placeholder="auto"
                />
              </Field>
              <Field label={t('storageKeyPrefix')}>
                <Input
                  value={keyPrefix}
                  disabled={pending}
                  onChange={(event) => setKeyPrefix(event.target.value)}
                  placeholder="staging"
                />
              </Field>
            </div>
            <Field label={t('storageS3Endpoint')}>
              <Input
                value={s3Endpoint}
                disabled={pending}
                onChange={(event) => setS3Endpoint(event.target.value)}
                placeholder="https://s3.example.com"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={s3ForcePathStyle}
                disabled={pending}
                onChange={(event) => setS3ForcePathStyle(event.target.checked)}
              />
              {t('storageS3ForcePathStyle')}
            </label>
            <Field label={t('storageS3AccessKey')}>
              <PasswordInput
                value={accessKeyId}
                disabled={pending || clearAccessKey}
                onChange={(event) => setAccessKeyId(event.target.value)}
                placeholder={
                  hasAccessKeyId
                    ? t('storageSecretLeaveBlank')
                    : undefined
                }
                autoComplete="off"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={clearAccessKey}
                disabled={pending}
                onChange={(event) => setClearAccessKey(event.target.checked)}
              />
              {t('storageClearAccessKey')}
            </label>
            <Field label={t('storageS3SecretKey')}>
              <PasswordInput
                value={secretAccessKey}
                disabled={pending || clearSecret}
                onChange={(event) => setSecretAccessKey(event.target.value)}
                placeholder={
                  hasSecretAccessKey
                    ? t('storageSecretLeaveBlank')
                    : undefined
                }
                autoComplete="off"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={clearSecret}
                disabled={pending}
                onChange={(event) => setClearSecret(event.target.checked)}
              />
              {t('storageClearSecretKey')}
            </label>
          </div>
        ) : (
          <p className="m-0 text-sm text-ink-muted">{t('storageDisabledHint')}</p>
        )}

        {error ? <ErrorText>{error}</ErrorText> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending} onClick={() => void save()}>
            {tCommon('save')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending || provider === 'disabled'}
            onClick={() => void testConnection()}
          >
            {t('storageTest')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => void resetToEnv()}
          >
            {t('storageResetToEnv')}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
