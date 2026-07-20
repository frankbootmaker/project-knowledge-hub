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

export type PublicMailSettings = {
  driver: 'console' | 'smtp' | 'resend';
  from: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  hasSmtpPass: boolean;
  hasResendApiKey: boolean;
  source: 'override' | 'env';
  effectiveDriver: string;
  envDriver: string;
};

export function MailSettingsAdmin({
  initialSettings,
}: {
  initialSettings: PublicMailSettings;
}) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { pushToast } = useToast();

  const [driver, setDriver] = useState(initialSettings.driver);
  const [from, setFrom] = useState(initialSettings.from);
  const [smtpHost, setSmtpHost] = useState(initialSettings.smtpHost);
  const [smtpPort, setSmtpPort] = useState(String(initialSettings.smtpPort));
  const [smtpSecure, setSmtpSecure] = useState(initialSettings.smtpSecure);
  const [smtpUser, setSmtpUser] = useState(initialSettings.smtpUser);
  const [smtpPass, setSmtpPass] = useState('');
  const [clearSmtpPass, setClearSmtpPass] = useState(false);
  const [resendApiKey, setResendApiKey] = useState('');
  const [clearResendKey, setClearResendKey] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [source, setSource] = useState(initialSettings.source);
  const [hasSmtpPass, setHasSmtpPass] = useState(initialSettings.hasSmtpPass);
  const [hasResendApiKey, setHasResendApiKey] = useState(
    initialSettings.hasResendApiKey,
  );

  function applySettings(settings: PublicMailSettings) {
    setDriver(settings.driver);
    setFrom(settings.from);
    setSmtpHost(settings.smtpHost);
    setSmtpPort(String(settings.smtpPort));
    setSmtpSecure(settings.smtpSecure);
    setSmtpUser(settings.smtpUser);
    setSmtpPass('');
    setClearSmtpPass(false);
    setResendApiKey('');
    setClearResendKey(false);
    setSource(settings.source);
    setHasSmtpPass(settings.hasSmtpPass);
    setHasResendApiKey(settings.hasResendApiKey);
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        driver,
        from: from.trim(),
        smtpHost: smtpHost.trim() || undefined,
        smtpPort: Number(smtpPort) || 587,
        smtpSecure,
        smtpUser: smtpUser.trim() || undefined,
      };
      if (clearSmtpPass) {
        body.smtpPass = null;
      } else if (smtpPass.trim()) {
        body.smtpPass = smtpPass.trim();
      }
      if (clearResendKey) {
        body.resendApiKey = null;
      } else if (resendApiKey.trim()) {
        body.resendApiKey = resendApiKey.trim();
      }

      const response = await fetch('/api/v1/admin/mail-settings', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        settings?: PublicMailSettings;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      if (payload.settings) {
        applySettings(payload.settings);
      }
      pushToast(t('mailSettingsSaved'));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function resetToEnv() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/mail-settings', {
        method: 'DELETE',
        credentials: 'include',
        headers: { Origin: window.location.origin },
      });
      const payload = (await response.json()) as {
        settings?: PublicMailSettings;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      if (payload.settings) {
        applySettings(payload.settings);
      }
      pushToast(t('mailSettingsReset'));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function sendTest() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/mail-settings/test', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({
          to: testTo.trim() || undefined,
        }),
      });
      const payload = (await response.json()) as {
        to?: string;
        warning?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      pushToast(t('mailTestSent', { to: payload.to ?? '' }));
      if (payload.warning) {
        pushToast(payload.warning, 'info');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6">
      <Panel className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={source === 'override' ? 'brand' : 'neutral'}>
            {source === 'override' ? t('mailSourceOverride') : t('mailSourceEnv')}
          </Badge>
          <span className="text-sm text-ink-muted">
            {t('mailEnvDriver', { driver: initialSettings.envDriver })}
          </span>
        </div>
        <p className="m-0 text-sm text-ink-muted">{t('mailSettingsBlurb')}</p>
      </Panel>

      <Panel className="grid gap-4">
        <Field label={t('mailDriver')}>
          <Select
            value={driver}
            onChange={(e) =>
              setDriver(e.target.value as PublicMailSettings['driver'])
            }
          >
            <option value="console">{t('mailDriverConsole')}</option>
            <option value="smtp">{t('mailDriverSmtp')}</option>
            <option value="resend">{t('mailDriverResend')}</option>
          </Select>
        </Field>
        <Field label={t('mailFrom')}>
          <Input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="Project Knowledge Hub <noreply@example.com>"
            autoComplete="off"
          />
        </Field>

        {driver === 'smtp' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('mailSmtpHost')} className="sm:col-span-2">
              <Input
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="smtp.example.com"
                autoComplete="off"
              />
            </Field>
            <Field label={t('mailSmtpPort')}>
              <Input
                type="number"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                min={1}
                max={65535}
              />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input
                type="checkbox"
                checked={smtpSecure}
                onChange={(e) => setSmtpSecure(e.target.checked)}
              />
              {t('mailSmtpSecure')}
            </label>
            <Field label={t('mailSmtpUser')}>
              <Input
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label={t('mailSmtpPass')}>
              <PasswordInput
                value={smtpPass}
                onChange={(e) => {
                  setSmtpPass(e.target.value);
                  if (e.target.value) setClearSmtpPass(false);
                }}
                placeholder={
                  hasSmtpPass ? t('mailSecretLeaveBlank') : t('mailSmtpPass')
                }
                autoComplete="new-password"
              />
            </Field>
            {hasSmtpPass ? (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={clearSmtpPass}
                  onChange={(e) => {
                    setClearSmtpPass(e.target.checked);
                    if (e.target.checked) setSmtpPass('');
                  }}
                />
                {t('mailClearSmtpPass')}
              </label>
            ) : null}
          </div>
        ) : null}

        {driver === 'resend' ? (
          <div className="grid gap-3">
            <Field label={t('mailResendApiKey')}>
              <PasswordInput
                value={resendApiKey}
                onChange={(e) => {
                  setResendApiKey(e.target.value);
                  if (e.target.value) setClearResendKey(false);
                }}
                placeholder={
                  hasResendApiKey
                    ? t('mailSecretLeaveBlank')
                    : 're_…'
                }
                autoComplete="new-password"
              />
            </Field>
            {hasResendApiKey ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={clearResendKey}
                  onChange={(e) => {
                    setClearResendKey(e.target.checked);
                    if (e.target.checked) setResendApiKey('');
                  }}
                />
                {t('mailClearResendKey')}
              </label>
            ) : null}
            <p className="m-0 text-sm text-ink-muted">{t('mailResendHint')}</p>
          </div>
        ) : null}

        {driver === 'console' ? (
          <p className="m-0 text-sm text-ink-muted">{t('mailConsoleHint')}</p>
        ) : null}

        {error ? <ErrorText>{error}</ErrorText> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending || !from.trim()} onClick={() => void save()}>
            {tCommon('save')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending || source === 'env'}
            onClick={() => void resetToEnv()}
          >
            {t('mailResetToEnv')}
          </Button>
        </div>
      </Panel>

      <Panel className="grid gap-3">
        <h2 className="m-0 text-base font-semibold">{t('mailTestTitle')}</h2>
        <p className="m-0 text-sm text-ink-muted">{t('mailTestBlurb')}</p>
        <Field label={t('mailTestTo')}>
          <Input
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder={t('mailTestToHint')}
            autoComplete="email"
          />
        </Field>
        <div>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => void sendTest()}>
            {t('mailSendTest')}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
