import type { ClaimStatus, LeaveStatus } from './types'

const TZ = 'Asia/Singapore'

export function todaySG(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}

function asDate(d: string) {
  // date-only strings are parsed as local midnight to avoid UTC shifts
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00') : new Date(d)
}

export function fmtDate(d: string | null | undefined, opts: Intl.DateTimeFormatOptions = {}) {
  if (!d) return '—'
  return asDate(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', ...opts })
}

export function fmtShort(d: string) {
  return asDate(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })
}

export function fmtRange(start: string, end: string) {
  if (start === end) return fmtDate(start, { weekday: 'short' })
  const s = asDate(start)
  const e = asDate(end)
  const sameYear = s.getFullYear() === e.getFullYear()
  return `${s.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })} – ${fmtDate(end)}`
}

export function fmtDateTime(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-SG', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function timeAgo(d: string) {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const days = Math.round(h / 24)
  if (days < 30) return `${days} d ago`
  return fmtDate(d)
}

export function money(n: number | string | null | undefined, currency = 'SGD') {
  const v = Number(n ?? 0)
  return `${currency} ${v.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function days(n: number | string | null | undefined) {
  const v = Number(n ?? 0)
  return `${Number.isInteger(v) ? v : v.toFixed(1)} ${Math.abs(v) === 1 ? 'day' : 'days'}`
}

export function num(n: number | string | null | undefined) {
  const v = Number(n ?? 0)
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

export const leaveStatusLabel: Record<LeaveStatus, string> = {
  pending: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Not approved',
  cancelled: 'Cancelled',
}

export const claimStatusLabel: Record<ClaimStatus, string> = {
  pending: 'Awaiting approval',
  submitted_to_finance: 'Submitted to Finance',
  rejected: 'Not approved',
  paid: 'Paid',
  returned: 'Returned by Finance',
  cancelled: 'Withdrawn',
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((p) => p && p[0] === p[0].toUpperCase())
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
}

export const auditLabel: Record<string, string> = {
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Not approved',
  cancelled: 'Cancelled',
  withdrawn: 'Withdrawn',
  recorded_in_master_leave_record: 'Posted to Master Leave Record',
  submitted_to_finance: 'Sent to Finance payment queue',
  paid: 'Paid',
  returned: 'Returned by Finance',
  reminder_sent: 'Reminder sent to approver',
  escalated: 'Escalated',
}

export function halfDayLabel(h: string) {
  return h === 'am' ? 'Morning (AM)' : h === 'pm' ? 'Afternoon (PM)' : ''
}
