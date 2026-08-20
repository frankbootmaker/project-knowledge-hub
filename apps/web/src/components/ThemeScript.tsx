import { brandCookieName } from '../lib/brand';
import { themeCookieName } from '../lib/theme';

/** Runs before paint to apply dark class, brand, and avoid a flash. */
export function ThemeScript() {
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
    var brandMatch = document.cookie.match(/(?:^|; )${brandCookieName}=([^;]*)/);
    var brand = brandMatch ? decodeURIComponent(brandMatch[1]) : 'knowhub';
    root.dataset.brand = /^(knowhub|bootmaker|nethorizon|in3)$/.test(brand) ? brand : 'knowhub';
  } catch (e) {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.brand = 'knowhub';
  }
})();`;

  return (
    <script
      // Blocking inline script intentionally avoids a theme flash on first paint.
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
