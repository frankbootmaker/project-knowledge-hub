import { themeCookieName } from '../lib/theme';

/** Runs before paint to apply dark class and avoid a light/dark flash. */
export function ThemeScript() {
  const script = `
(function () {
  try {
    var match = document.cookie.match(/(?:^|; )${themeCookieName}=([^;]*)/);
    var theme = match ? decodeURIComponent(match[1]) : 'light';
    var dark = theme === 'dark';
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {}
})();`;

  return (
    <script
      // Blocking inline script intentionally avoids a theme flash on first paint.
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
