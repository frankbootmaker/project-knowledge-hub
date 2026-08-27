import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthEntry } from '../../components/landing/AuthEntry';
import { getThemePreference } from '../../lib/theme-actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('forgotPassword');
  return {
    title: t('title'),
    description: t('subtitle'),
  };
}

export default async function ForgotPasswordPage() {
  const themePreference = await getThemePreference();
  return <AuthEntry mode="forgot-password" themePreference={themePreference} />;
}
