import localFont from 'next/font/local';

/**
 * Vendored IBM Plex (OFL). Same families, weights, and swap display as before,
 * so production builds do not download font files. The woff2 cuts are the
 * complete fonts (a superset of latin and latin-ext).
 */
const sans = localFont({
  src: [
    { path: './IBMPlexSans-Regular.woff2', weight: '400', style: 'normal' },
    { path: './IBMPlexSans-Medium.woff2', weight: '500', style: 'normal' },
    { path: './IBMPlexSans-SemiBold.woff2', weight: '600', style: 'normal' },
    { path: './IBMPlexSans-Bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-ibm-plex-sans',
  display: 'swap',
  adjustFontFallback: 'Arial',
});

const display = localFont({
  src: [
    {
      path: './IBMPlexSansCondensed-Regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: './IBMPlexSansCondensed-SemiBold.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: './IBMPlexSansCondensed-Bold.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-ibm-plex-sans-condensed',
  display: 'swap',
  adjustFontFallback: 'Arial',
});

const mono = localFont({
  src: [
    { path: './IBMPlexMono-Regular.woff2', weight: '400', style: 'normal' },
    { path: './IBMPlexMono-Medium.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
  adjustFontFallback: 'Arial',
});

export { sans as ibmPlexSans, display as ibmPlexSansCondensed, mono as ibmPlexMono };
