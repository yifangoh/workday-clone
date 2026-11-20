import Link from 'next/link'
import clsx from 'clsx'
import type { ReactNode } from 'react'
import { claimStatusLabel, initials, leaveStatusLabel } from '@/lib/format'
import type { ClaimStatus, LeaveStatus } from '@/lib/types'

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  back?: { href: string; label: string }
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-sm text-muted hover:text-ink">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ title, actions, children, className, padded = true }: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {actions}
        </header>
      )}
      <div className={clsx(padded && 'p-5')}>{children}</div>
    </section>
  )
}

const tone = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-brand-50 text-brand-700 ring-brand-100',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  amber: 'bg-amber-50 text-amber-800 ring-amber-100',
  red: 'bg-red-50 text-red-700 ring-red-100',
  violet: 'bg-violet-50 text-violet-700 ring-violet-100',
} as const

export function Badge({ children, color = 'gray', className }: { children: ReactNode; color?: keyof typeof tone; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tone[color], className)}>
      {children}
    </span>
  )
}

const leaveTone: Record<LeaveStatus, keyof typeof tone> = { pending: 'amber', approved: 'green', rejected: 'red', cancelled: 'gray' }
const claimTone: Record<ClaimStatus, keyof typeof tone> = {
  pending: 'amber', submitted_to_finance: 'blue', rejected: 'red', paid: 'green', returned: 'violet', cancelled: 'gray',
}

export function LeaveStatusBadge({ status }: { status: LeaveStatus }) {
  return <Badge color={leaveTone[status]}>{leaveStatusLabel[status]}</Badge>
}
export function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  return <Badge color={claimTone[status]}>{claimStatusLabel[status]}</Badge>
}

export function Flags({ flags }: { flags: string[] | null | undefined }) {
  if (!flags?.length) return null
  return (
    <span className="inline-flex flex-wrap gap-1">
      {flags.map((f) => (
        <Badge key={f} color={f === 'Team clash' || f === 'Over limit' ? 'red' : 'amber'}>⚑ {f}</Badge>
      ))}
    </span>
  )
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const palette = ['bg-brand-600', 'bg-emerald-600', 'bg-amber-600', 'bg-rose-600', 'bg-violet-600', 'bg-cyan-700', 'bg-slate-700']
  const idx = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        palette[idx],
        size === 'sm' && 'h-7 w-7 text-[11px]',
        size === 'md' && 'h-9 w-9 text-xs',
        size === 'lg' && 'h-16 w-16 text-lg',
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  )
}

export function Stat({ label, value, hint, tone: t = 'default' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'good' | 'bad' }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={clsx('mt-1 text-2xl font-semibold', t === 'good' && 'text-emerald-700', t === 'bad' && 'text-red-700')}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  )
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function DL({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{k}</dt>
          <dd className="mt-0.5 text-sm text-ink">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Tabs({ tabs, active }: { tabs: { href: string; label: string; count?: number }[]; active: string }) {
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={clsx(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
            active === t.href ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-full bg-canvas px-1.5 text-xs">{t.count}</span>}
        </Link>
      ))}
    </nav>
  )
}
