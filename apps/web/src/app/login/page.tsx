import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AuthEntry } from '../../components/landing/AuthEntry';
import { getSession } from '../../lib/session';
import { getThemePreference } from '../../lib/theme-actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('login');
  return {
    title: t('welcomeTitle'),
    description: t('subtitle'),
  };
}

export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect('/dashboard');
  }

  const themePreference = await getThemePreference();
  return <AuthEntry mode="login" themePreference={themePreference} />;
}
