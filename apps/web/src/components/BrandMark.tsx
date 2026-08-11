/** KnowHub mark — matches `app/icon.svg` (navy tile + white K). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      role="img"
      aria-hidden
      className={className}
    >
      <rect width="32" height="32" rx="8" fill="#1F4B73" />
      <path
        fill="#FFFFFF"
        d="M7.25 5.75h6.1v8.55L21.9 5.75h5.35L18.2 16l9.05 10.25H21.9L13.35 17.7v8.55h-6.1V5.75z"
      />
      <g fill="#1F4B73" stroke="#1F4B73" strokeLinecap="round" strokeLinejoin="round">
        <line x1="10.3" y1="16" x2="8.15" y2="12.55" strokeWidth="1.35" />
        <line x1="10.3" y1="16" x2="7.55" y2="16" strokeWidth="1.35" />
        <line x1="10.3" y1="16" x2="8.15" y2="19.45" strokeWidth="1.35" />
        <circle cx="10.3" cy="16" r="1.55" fill="#1F4B73" stroke="none" />
        <circle cx="8.15" cy="12.55" r="1.05" fill="#1F4B73" stroke="none" />
        <circle cx="7.55" cy="16" r="1.05" fill="#1F4B73" stroke="none" />
        <circle cx="8.15" cy="19.45" r="1.05" fill="#1F4B73" stroke="none" />
      </g>
    </svg>
  );
}
