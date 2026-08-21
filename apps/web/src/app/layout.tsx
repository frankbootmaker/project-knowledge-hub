import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { ThemeScript } from '../components/ThemeScript';
import { ToastProvider } from '../components/ui';
import { getBrandPreference } from '../lib/brand-actions';
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

const sans = IBM_Plex_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-sans',
  display: 'swap',
});

const display = IBM_Plex_Sans_Condensed({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '600', '700'],
  variable: '--font-ibm-plex-sans-condensed',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const themePreference = await getThemePreference();
  const brand = await getBrandPreference();
  const ssrTheme = themePreference === 'dark' ? 'dark' : 'light';

  return (
    <html
      lang={locale}
      className={`${sans.variable} ${display.variable} ${mono.variable}${ssrTheme === 'dark' ? ' dark' : ''}`}
      data-theme={ssrTheme}
      data-brand={brand}
      suppressHydrationWarning
    >
      <body className="font-sans">
        <ThemeScript />
        <NextIntlClientProvider messages={messages}>
          <ToastProvider>{children}</ToastProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
