'use client';

import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { AuthCard } from '../ops/AuthCard';
import type { AuthMode } from './auth-mode';
import { ForgotPasswordForm } from './ForgotPasswordForm';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';

function MobileAuthBody({ mode }: { mode: AuthMode }) {
  const login = useTranslations('login');
  const register = useTranslations('register');
  const forgot = useTranslations('forgotPassword');

  if (mode === 'register') {
    return (
      <AuthCard
        brand={register('accessBrand')}
        eyebrow={register('eyebrow')}
        title={register('title')}
        subtitle={register('subtitle')}
      >
        <div className="mt-4">
          <RegisterForm />
        </div>
      </AuthCard>
    );
  }

  if (mode === 'forgot-password') {
    return (
      <AuthCard
        brand={forgot('accessBrand')}
        eyebrow={forgot('eyebrow')}
        title={forgot('title')}
        subtitle={forgot('subtitle')}
      >
        <div className="mt-4">
          <ForgotPasswordForm />
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      brand={login('accessBrand')}
      eyebrow={login('eyebrow')}
      title={login('welcomeTitle')}
      subtitle={login('subtitle')}
    >
      <div className="mt-4">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </AuthCard>
  );
}

export function MobileAuthPage({ mode }: { mode: AuthMode }) {
  return <MobileAuthBody mode={mode} />;
}
