'use client';

import { useTranslations } from 'next-intl';
import { Panel } from './ui';

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
    <Panel className="grid gap-3">
      <div className="grid gap-1 text-sm">
        <p className="m-0">
          <span className="text-ink-muted">{t('identityEmail')}: </span>
          {user.email}
        </p>
        {isLocalAccount ? (
          <p className="m-0 text-ink-muted">{t('identityLocal')}</p>
        ) : (
          <>
            <p className="m-0">
              <span className="text-ink-muted">{t('identityIdpSource')}: </span>
              {user.idpSource}
            </p>
            <p className="m-0">
              <span className="text-ink-muted">{t('identityIdpSubject')}: </span>
              <code className="text-xs">{user.idpSubject}</code>
            </p>
          </>
        )}
        <p className="m-0 text-ink-muted">
          {user.hasPassword ? t('identityHasPassword') : t('identityNoPassword')}
        </p>
      </div>
    </Panel>
  );
}
