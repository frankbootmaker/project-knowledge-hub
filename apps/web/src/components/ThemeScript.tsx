import { brandCookieName } from '../lib/brand';
import { themeCookieName } from '../lib/theme';

/** Runs before paint to apply dark class, brand, and avoid a flash. */
export function ThemeScript({
  brandDefault = 'knowhub',
  brandLocked = false,
}: {
  brandDefault?: string;
  brandLocked?: boolean;
} = {}) {
  const safeDefault = /^(knowhub|bootmaker|nethorizon|in3)$/.test(brandDefault)
    ? brandDefault
    : 'knowhub';
  const script = `
(function () {
  try {
    var root = document.documentElement;
    var themeMatch = document.cookie.match(/(?:^|; )${themeCookieName}=([^;]*)/);
    var pref = themeMatch ? decodeURIComponent(themeMatch[1]) : 'light';
    var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var resolved = pref === 'system' ? (systemDark ? 'dark' : 'light') : (pref === 'dark' ? 'dark' : 'light');
    root.classList.toggle('dark', resolved === 'dark');
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
    var platformDefault = ${JSON.stringify(safeDefault)};
    var locked = ${brandLocked ? 'true' : 'false'};
    var brandMatch = document.cookie.match(/(?:^|; )${brandCookieName}=([^;]*)/);
    var personal = brandMatch ? decodeURIComponent(brandMatch[1]) : '';
    var brand = locked
      ? platformDefault
      : (/^(knowhub|bootmaker|nethorizon|in3)$/.test(personal) ? personal : platformDefault);
    root.dataset.brand = brand;
    root.dataset.brandDefault = platformDefault;
    root.dataset.brandLocked = locked ? '1' : '0';
  } catch (e) {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.brand = ${JSON.stringify(safeDefault)};
  }
})();`;

  return (
    <script
      // Blocking inline script intentionally avoids a theme flash on first paint.
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
