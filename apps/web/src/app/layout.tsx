import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { ThemeScript } from '../components/ThemeScript';
import { ToastProvider } from '../components/ui';
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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#1F4B73' },
    { media: '(prefers-color-scheme: dark)', color: '#1F4B73' },
  ],
};

const sans = IBM_Plex_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-sans',
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
  const theme = await getThemePreference();

  return (
    <html
      lang={locale}
      className={`${sans.variable} ${mono.variable}${theme === 'dark' ? ' dark' : ''}`}
      data-theme={theme}
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
