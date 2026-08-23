'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  PasswordInput,
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

export type BlobUsagePurposeId =
  | 'media'
  | 'imports'
  | 'avatars'
  | 'docTemplates';

export type BlobUsageSummary = {
  purposes: Array<{
    id: BlobUsagePurposeId;
    bytes: number;
    files: number;
  }>;
  totalBytes: number;
  totalFiles: number;
  volume: {
    path: string;
    totalBytes: number | null;
    freeBytes: number | null;
    usedBytes: number | null;
  };
};

type MigrateResult = {
  uploaded: number;
  skipped: number;
  failed: number;
  errors: Array<{ key: string; message: string }>;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

function emptyUsage(): BlobUsageSummary {
  return {
    purposes: [
      { id: 'media', bytes: 0, files: 0 },
      { id: 'imports', bytes: 0, files: 0 },
      { id: 'avatars', bytes: 0, files: 0 },
      { id: 'docTemplates', bytes: 0, files: 0 },
    ],
    totalBytes: 0,
    totalFiles: 0,
    volume: {
      path: '',
      totalBytes: null,
      freeBytes: null,
      usedBytes: null,
    },
  };
}

export function StorageSettingsAdmin({
  initialSettings,
  initialUsage,
}: {
  initialSettings: PublicBlobSettings;
  initialUsage?: BlobUsageSummary | null;
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
  const [usage, setUsage] = useState<BlobUsageSummary>(
    initialUsage ?? emptyUsage(),
  );
  const [migrateResult, setMigrateResult] = useState<MigrateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const volumePct = useMemo(() => {
    const total = usage.volume.totalBytes;
    const used = usage.volume.usedBytes;
    if (!total || total <= 0 || used == null) return null;
    return Math.min(100, Math.round((used / total) * 100));
  }, [usage.volume.totalBytes, usage.volume.usedBytes]);

  const migratePct = useMemo(() => {
    if (!migrateResult) return 0;
    const total =
      migrateResult.uploaded + migrateResult.skipped + migrateResult.failed;
    if (total <= 0) return 100;
    return Math.round(
      ((migrateResult.uploaded + migrateResult.skipped) / total) * 100,
    );
  }, [migrateResult]);

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

  async function migrateLocal() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/storage-settings/migrate-local', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: '{}',
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        result?: MigrateResult;
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      const result = body.result ?? {
        uploaded: 0,
        skipped: 0,
        failed: 0,
        errors: [],
      };
      setMigrateResult(result);
      if (result.failed > 0) {
        const detail = result.errors
          .slice(0, 3)
          .map((entry) => `${entry.key}: ${entry.message}`)
          .join('; ');
        setError(
          t('storageMigratePartial', {
            uploaded: result.uploaded,
            skipped: result.skipped,
            failed: result.failed,
            detail,
          }),
        );
      }
      pushToast(
        t('storageMigrateOk', {
          uploaded: result.uploaded,
          skipped: result.skipped,
          failed: result.failed,
        }),
      );
      const refresh = await fetch('/api/v1/admin/storage-settings', {
        credentials: 'include',
      });
      if (refresh.ok) {
        const refreshed = (await refresh.json()) as {
          usage?: BlobUsageSummary;
        };
        if (refreshed.usage) setUsage(refreshed.usage);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('storageMigrateFailed'));
    } finally {
      setPending(false);
    }
  }

  const primaryBadge =
    provider === 's3'
      ? t('storagePrimaryS3')
      : t('storagePrimaryLocal');

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={provider === 's3' ? 'brand' : 'neutral'}>{primaryBadge}</Badge>
        <Badge tone={source === 'override' ? 'brand' : 'neutral'}>
          {source === 'override'
            ? t('storageSourceOverride')
            : t('storageSourceEnv')}
        </Badge>
        <span className="text-sm text-ink-muted">
          {t('storageEnvProvider', { provider: initialSettings.envProvider })}
        </span>
      </div>

      <div className="kh-ops-storage-choice">
        <button
          type="button"
          className={`kh-ops-provider${provider === 'disabled' ? ' selected' : ''}`}
          disabled={pending}
          onClick={() => setProvider('disabled')}
        >
          <strong>{t('storageProviderDisabled')}</strong>
          <small>{t('storageDisabledHintShort')}</small>
        </button>
        <button
          type="button"
          className={`kh-ops-provider${provider === 's3' ? ' selected' : ''}`}
          disabled={pending}
          onClick={() => setProvider('s3')}
        >
          <strong>{t('storageProviderS3')}</strong>
          <small>
            {s3Bucket.trim() || s3Region.trim()
              ? [s3Bucket, s3Region].filter(Boolean).join(' · ')
              : t('storageS3HintShort')}
          </small>
        </button>
        <button
          type="button"
          className="kh-ops-provider"
          disabled
          title={t('storageProviderAzureHint')}
        >
          <strong>{t('storageProviderAzure')}</strong>
          <small>{t('storageProviderAzureHint')}</small>
        </button>
      </div>

      <div className="kh-ops-detail-grid">
        <section className="kh-ops-panel mb-0">
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">
              {provider === 's3' ? t('storageS3ConfigTitle') : t('storageLocalConfigTitle')}
            </h2>
            <Badge tone={provider === 's3' ? 'warn' : 'success'}>
              {provider === 's3' ? t('storageStandbyTarget') : t('storageActiveTarget')}
            </Badge>
          </div>
          <div className="kh-ops-card-body grid gap-4">
            <p className="m-0 text-sm text-ink-muted">{t('storageSettingsBlurb')}</p>

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
              <div className="kh-ops-form-grid">
                <p className="kh-ops-field-span m-0 text-sm text-ink-muted">
                  {t('storageS3Hint')}
                </p>
                <Field label={t('storageS3Bucket')}>
                  <Input
                    value={s3Bucket}
                    disabled={pending}
                    onChange={(event) => setS3Bucket(event.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <div className="kh-ops-form-grid kh-ops-field-span">
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
                      hasAccessKeyId ? t('storageSecretLeaveBlank') : undefined
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

            <div className="kh-ops-action-line flex flex-wrap items-center gap-2">
              <span className="kh-ops-panel-meta mr-auto">
                {t('storageDualWriteNote')}
              </span>
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
          </div>
        </section>

        <aside className="kh-ops-panel mb-0">
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">{t('storageDiskUsageTitle')}</h2>
            {volumePct != null ? (
              <Badge tone={volumePct >= 85 ? 'danger' : volumePct >= 65 ? 'warn' : 'success'}>
                {t('storageDiskUsagePct', { pct: volumePct })}
              </Badge>
            ) : null}
          </div>
          <div className="kh-ops-budget-box">
            <div className="kh-ops-big-pair">
              <strong>{formatBytes(usage.totalBytes)}</strong>
              <span>
                {usage.volume.totalBytes != null
                  ? t('storageDiskOfVolume', {
                      total: formatBytes(usage.volume.totalBytes),
                    })
                  : t('storageDiskAllocated')}
              </span>
            </div>
            <div className="kh-ops-disk-strip" aria-hidden>
              <i
                style={{
                  width: `${volumePct ?? (usage.totalBytes > 0 ? 8 : 0)}%`,
                }}
              />
            </div>
            <dl className="kh-ops-keyvals">
              <dt>{t('storageDiskAvailable')}</dt>
              <dd>
                {usage.volume.freeBytes != null
                  ? formatBytes(usage.volume.freeBytes)
                  : '—'}
              </dd>
              <dt>{t('storageDiskObjects')}</dt>
              <dd>{usage.totalFiles}</dd>
              <dt>{t('storageDiskPath')}</dt>
              <dd title={usage.volume.path || undefined}>
                {usage.volume.path || '—'}
              </dd>
            </dl>
          </div>
        </aside>
      </div>

      <div className="kh-ops-grid-main">
        <section className="kh-ops-panel mb-0">
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">{t('storagePurposesTitle')}</h2>
            <span className="kh-ops-panel-meta">
              {t('storagePurposesMeta', { size: formatBytes(usage.totalBytes) })}
            </span>
          </div>
          <div>
            {usage.purposes.map((row) => (
              <div key={row.id} className="kh-ops-purpose-row">
                <strong>{t(`storagePurpose.${row.id}`)}</strong>
                <span>{formatBytes(row.bytes)}</span>
                <span className="kh-ops-type-chip">
                  {t(`storagePurposeChip.${row.id}`)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="kh-ops-panel mb-0">
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">{t('storageMigrateTitle')}</h2>
            <span className="kh-ops-panel-meta">
              {migrateResult
                ? t('storageMigrateMetaDone')
                : t('storageMigrateMetaIdle')}
            </span>
          </div>
          <div className="kh-ops-card-body grid gap-3">
            <p className="m-0 text-sm text-ink-muted">{t('storageMigrateBlurb')}</p>
            <div className="kh-ops-migration-progress" aria-hidden>
              <i style={{ width: `${migratePct}%` }} />
            </div>
            <p className="m-0 text-xs text-ink-muted">
              {migrateResult
                ? t('storageMigrateProgress', {
                    uploaded: migrateResult.uploaded,
                    skipped: migrateResult.skipped,
                    failed: migrateResult.failed,
                    pct: migratePct,
                  })
                : t('storageMigrateProgressIdle')}
            </p>
          </div>
          <div className="kh-ops-action-line flex flex-wrap items-center gap-2">
            <Badge tone="warn">{t('storageMigrateWindow')}</Badge>
            <Button
              type="button"
              variant="secondary"
              className="ml-auto"
              disabled={pending || provider === 'disabled'}
              onClick={() => void migrateLocal()}
            >
              {t('storageMigrate')}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
