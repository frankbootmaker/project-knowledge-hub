'use client';

import { useTranslations } from 'next-intl';

export type IdentityUser = {
  email: string;
  idpSource: string | null;
  idpSubject: string | null;
  hasPassword: boolean;
};

export function SignInIdentityPanel({ user }: { user: IdentityUser }) {
  const t = useTranslations('account');
  const isLocalAccount = !user.idpSource && !user.idpSubject;

  return (
    <section className="kh-ops-panel">
      <div className="kh-ops-setting-row">
        <div>
          <small>{t('identityEmail')}</small>
          <strong>{user.email}</strong>
        </div>
      </div>
      {isLocalAccount ? (
        <div className="kh-ops-setting-row">
          <p className="m-0 text-xs text-ink-muted">{t('identityLocal')}</p>
        </div>
      ) : (
        <>
          <div className="kh-ops-setting-row">
            <div>
              <small>{t('identityIdpSource')}</small>
              <strong>{user.idpSource}</strong>
            </div>
          </div>
          <div className="kh-ops-setting-row">
            <div>
              <small>{t('identityIdpSubject')}</small>
              <strong className="font-mono">{user.idpSubject}</strong>
            </div>
          </div>
        </>
      )}
      <div className="kh-ops-setting-row">
        <p className="m-0 text-xs text-ink-muted">
          {user.hasPassword ? t('identityHasPassword') : t('identityNoPassword')}
        </p>
      </div>
    </section>
  );
}
