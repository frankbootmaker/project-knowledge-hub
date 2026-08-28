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
  PasswordInput,
  Switch,
  useToast,
} from '../ui';

export type PublicOidcSettings = {
  enabled: boolean;
  issuer: string;
  clientId: string;
  buttonLabel: string;
  idpSource: string;
  redirectUri: string;
  defaultRedirectUri: string;
  jitProvisioning: boolean;
  hasClientSecret: boolean;
  source: 'override' | 'env';
  effectiveEnabled: boolean;
  envConfigured: boolean;
};

export function OidcSettingsAdmin({
  initialSettings,
}: {
  initialSettings: PublicOidcSettings;
}) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { pushToast } = useToast();

  const [enabled, setEnabled] = useState(initialSettings.enabled);
  const [issuer, setIssuer] = useState(initialSettings.issuer);
  const [clientId, setClientId] = useState(initialSettings.clientId);
  const [clientSecret, setClientSecret] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [buttonLabel, setButtonLabel] = useState(initialSettings.buttonLabel);
  const [idpSource, setIdpSource] = useState(initialSettings.idpSource);
  const [redirectUri, setRedirectUri] = useState(initialSettings.redirectUri);
  const [jitProvisioning, setJitProvisioning] = useState(
    initialSettings.jitProvisioning,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [source, setSource] = useState(initialSettings.source);
  const [hasClientSecret, setHasClientSecret] = useState(
    initialSettings.hasClientSecret,
  );
  const [effectiveEnabled, setEffectiveEnabled] = useState(
    initialSettings.effectiveEnabled,
  );
  const [defaultRedirectUri, setDefaultRedirectUri] = useState(
    initialSettings.defaultRedirectUri,
  );

  function applySettings(settings: PublicOidcSettings) {
    setEnabled(settings.enabled);
    setIssuer(settings.issuer);
    setClientId(settings.clientId);
    setClientSecret('');
    setClearSecret(false);
    setButtonLabel(settings.buttonLabel);
    setIdpSource(settings.idpSource);
    setRedirectUri(settings.redirectUri);
    setJitProvisioning(settings.jitProvisioning);
    setSource(settings.source);
    setHasClientSecret(settings.hasClientSecret);
    setEffectiveEnabled(settings.effectiveEnabled);
    setDefaultRedirectUri(settings.defaultRedirectUri);
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        enabled,
        issuer: issuer.trim() || undefined,
        clientId: clientId.trim() || undefined,
        buttonLabel: buttonLabel.trim() || undefined,
        idpSource: idpSource.trim() || undefined,
        redirectUri: redirectUri.trim() || null,
        jitProvisioning,
      };
      if (clearSecret) {
        body.clientSecret = null;
      } else if (clientSecret.trim()) {
        body.clientSecret = clientSecret.trim();
      }

      const response = await fetch('/api/v1/admin/oidc-settings', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        settings?: PublicOidcSettings;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      if (payload.settings) {
        applySettings(payload.settings);
      }
      pushToast(t('ssoSettingsSaved'));
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
      const response = await fetch('/api/v1/admin/oidc-settings', {
        method: 'DELETE',
        credentials: 'include',
        headers: { Origin: window.location.origin },
      });
      const payload = (await response.json()) as {
        settings?: PublicOidcSettings;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      if (payload.settings) {
        applySettings(payload.settings);
      }
      pushToast(t('ssoSettingsReset'));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-3">
      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('sso')}</h2>
          <div className="flex flex-wrap gap-2">
            <Badge tone={effectiveEnabled ? 'brand' : 'neutral'}>
              {effectiveEnabled ? t('ssoEffectiveOn') : t('ssoEffectiveOff')}
            </Badge>
            <Badge tone={source === 'override' ? 'brand' : 'neutral'}>
              {source === 'override' ? t('mailSourceOverride') : t('mailSourceEnv')}
            </Badge>
          </div>
        </div>
        <div className="kh-ops-card-body">
          <p className="mt-0 mb-3 text-xs text-ink-muted">
            {t('ssoSettingsBlurb')}
          </p>
          <div className="kh-ops-form-grid">
            <div className="kh-ops-field-span">
              <Switch
                id="oidc-enabled"
                label={t('ssoEnabled')}
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>
            <div className="kh-ops-field-span">
              <Switch
                id="oidc-jit"
                label={t('ssoJitProvisioning')}
                checked={jitProvisioning}
                onCheckedChange={setJitProvisioning}
              />
              <p className="m-0 mt-1 text-xs text-ink-muted">{t('ssoJitHint')}</p>
            </div>
            <Field className="kh-ops-field-span" label={t('ssoIssuer')}>
              <Input
                value={issuer}
                onChange={(e) => setIssuer(e.target.value)}
                placeholder="https://auth.example.com/application/o/knowhub/"
                autoComplete="off"
              />
            </Field>
            <Field label={t('ssoClientId')}>
              <Input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label={t('ssoButtonLabel')}>
              <Input
                value={buttonLabel}
                onChange={(e) => setButtonLabel(e.target.value)}
                placeholder={t('ssoButtonLabelPlaceholder')}
                autoComplete="off"
              />
            </Field>
            <Field label={t('ssoIdpSource')}>
              <Input
                value={idpSource}
                onChange={(e) => setIdpSource(e.target.value)}
                placeholder="authentik"
                autoComplete="off"
              />
            </Field>
            <Field className="kh-ops-field-span" label={t('ssoClientSecret')}>
              <PasswordInput
                value={clientSecret}
                onChange={(e) => {
                  setClientSecret(e.target.value);
                  if (e.target.value) setClearSecret(false);
                }}
                placeholder={
                  hasClientSecret
                    ? t('mailSecretLeaveBlank')
                    : t('ssoClientSecret')
                }
                autoComplete="new-password"
              />
            </Field>
            {hasClientSecret ? (
              <div className="kh-ops-field-span grid gap-2">
                <p className="m-0 text-sm text-brand">{t('mailSecretStored')}</p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={clearSecret}
                    onChange={(e) => {
                      setClearSecret(e.target.checked);
                      if (e.target.checked) setClientSecret('');
                    }}
                  />
                  {t('ssoClearSecret')}
                </label>
              </div>
            ) : null}
            <Field className="kh-ops-field-span" label={t('ssoRedirectUri')}>
              <Input
                value={redirectUri}
                onChange={(e) => setRedirectUri(e.target.value)}
                placeholder={defaultRedirectUri}
                autoComplete="off"
              />
              <p className="m-0 mt-1 text-xs text-ink-muted">
                {t('ssoRedirectUriHint', { url: defaultRedirectUri })}
              </p>
            </Field>
            {error ? (
              <div className="kh-ops-field-span">
                <ErrorText>{error}</ErrorText>
              </div>
            ) : null}
          </div>
        </div>
        <div className="kh-ops-action-line">
          <span className="kh-ops-panel-meta">
            {source === 'override' ? t('mailSourceOverride') : t('mailSourceEnv')}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={pending || source === 'env'}
              onClick={() => void resetToEnv()}
            >
              {t('mailResetToEnv')}
            </Button>
            <Button type="button" disabled={pending} onClick={() => void save()}>
              {tCommon('save')}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
