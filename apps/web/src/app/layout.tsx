import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import './globals.css';

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body
        style={{
          margin: 0,
          fontFamily:
            'IBM Plex Sans, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
          background:
            'radial-gradient(circle at top left, #d9e8f5 0%, #f4f7fb 42%, #eef2f6 100%)',
          color: '#15202b',
          minHeight: '100vh',
        }}
      >
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
