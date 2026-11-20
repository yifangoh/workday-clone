export function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="16" fill="#0a6ad0" />
      <path d="M14 40c8-14 14-14 18-6s10 8 18-6" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      <circle cx="50" cy="28" r="5" fill="#f5a623" />
    </svg>
  )
}
