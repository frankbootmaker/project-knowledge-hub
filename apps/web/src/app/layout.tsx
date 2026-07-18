import type { ReactNode } from 'react';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
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
        {children}
      </body>
    </html>
  );
}
