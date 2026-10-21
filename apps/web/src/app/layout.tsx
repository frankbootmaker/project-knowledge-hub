import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { ibmPlexMono, ibmPlexSans, ibmPlexSansCondensed } from '../fonts/ibm-plex';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { ThemeScript } from '../components/ThemeScript';
import { ToastProvider } from '../components/ui';
import { getPersonalBrandCookie, loadPlatformBrandSettings } from '../lib/brand-actions';
import { resolveEffectiveBrand } from '../lib/brand';
import { getThemePreference } from '../lib/theme-actions';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Project Knowledge Hub',
    template: '%s · Project Knowledge Hub',
  },
  description: 'Shared project knowledge for teams and AI tools.',
  applicationName: 'Project Knowledge Hub',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#2f9e4f' },
    { media: '(prefers-color-scheme: dark)', color: '#1b2a22' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const themePreference = await getThemePreference();
  const brandSettings = await loadPlatformBrandSettings();
  const personalBrand = await getPersonalBrandCookie();
  const brand = resolveEffectiveBrand(brandSettings, personalBrand);
  const ssrTheme = themePreference === 'dark' ? 'dark' : 'light';

  return (
    <html
      lang={locale}
      className={`${ibmPlexSans.variable} ${ibmPlexSansCondensed.variable} ${ibmPlexMono.variable}${ssrTheme === 'dark' ? ' dark' : ''}`}
      data-theme={ssrTheme}
      data-brand={brand}
      data-brand-default={brandSettings.defaultBrand}
      data-brand-locked={brandSettings.locked ? '1' : '0'}
      suppressHydrationWarning
    >
      <body className="font-sans">
        <ThemeScript brandDefault={brandSettings.defaultBrand} brandLocked={brandSettings.locked} />
        <NextIntlClientProvider messages={messages}>
          <ToastProvider>{children}</ToastProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
