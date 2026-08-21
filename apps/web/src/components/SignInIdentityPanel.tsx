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
          <p className="m-0 text-[10px] font-mono uppercase tracking-wide text-ink-muted">
            {t('identityEmail')}
          </p>
          <p className="m-0 mt-1 text-xs">{user.email}</p>
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
              <p className="m-0 text-[10px] font-mono uppercase tracking-wide text-ink-muted">
                {t('identityIdpSource')}
              </p>
              <p className="m-0 mt-1 text-xs">{user.idpSource}</p>
            </div>
          </div>
          <div className="kh-ops-setting-row">
            <div>
              <p className="m-0 text-[10px] font-mono uppercase tracking-wide text-ink-muted">
                {t('identityIdpSubject')}
              </p>
              <p className="m-0 mt-1 font-mono text-xs">{user.idpSubject}</p>
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
