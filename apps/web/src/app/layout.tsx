import type { ReactNode } from 'react';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { ThemeScript } from '../components/ThemeScript';
import { getThemePreference } from '../lib/theme-actions';
import './globals.css';

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
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
