import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { LandingPage } from '../components/landing/LandingPage';
import { getSession } from '../lib/session';
import { getThemePreference } from '../lib/theme-actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('landing');
  return {
    title: {
      absolute: 'KnowHub — Project knowledge, managed',
    },
    description: t('heroBody'),
  };
}

export default async function HomePage() {
  const session = await getSession();
  if (session) {
    redirect('/dashboard');
  }

  const themePreference = await getThemePreference();
  return <LandingPage themePreference={themePreference} />;
}
