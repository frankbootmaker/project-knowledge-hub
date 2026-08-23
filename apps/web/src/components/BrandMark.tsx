/** KnowHub mark — matches `app/icon.svg` (ops ink tile + white KH). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      role="img"
      aria-hidden
      className={className}
    >
      <rect width="32" height="32" rx="3" fill="#111811" />
      <g fill="#FFFFFF">
        <rect x="5.5" y="7" width="3.2" height="18" />
        <polygon points="8.7,16 15.4,7 18.6,7 11.1,16 18.6,25 15.4,25" />
        <rect x="19.4" y="7" width="3.2" height="18" />
        <rect x="25.3" y="7" width="3.2" height="18" />
        <rect x="19.4" y="14.4" width="9.1" height="3.2" />
      </g>
    </svg>
  );
}
