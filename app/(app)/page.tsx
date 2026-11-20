import Link from 'next/link'
import {
  CalendarDays, CalendarPlus, ClipboardCheck, FileSpreadsheet, Landmark, Receipt, ReceiptText, Users, BookUser, BarChart3,
} from 'lucide-react'
import { requireMe, hasRole, isPeopleLeader } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getCounts } from '@/lib/queries'
import { Avatar, Card, ClaimStatusBadge, Empty, LeaveStatusBadge } from '@/components/ui'
import { days, fmtDate, fmtRange, money, num, todaySG } from '@/lib/format'
import type { Claim, LeaveBalance, LeaveRequest } from '@/lib/types'

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-SG', { hour: 'numeric', hour12: false, timeZone: 'Asia/Singapore' }).format(new Date()))
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export default async function Home({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { denied } = await searchParams
  const me = await requireMe()
  const supabase = await createClient()
  const today = todaySG()
  const year = Number(today.slice(0, 4))
  const weekEnd = new Date(today + 'T00:00:00')
  weekEnd.setDate(weekEnd.getDate() + 13)
  const to = weekEnd.toISOString().slice(0, 10)

  const [counts, balances, myLeave, myClaims, holidays, away] = await Promise.all([
    getCounts(me),
    supabase.from('v_leave_balances').select('*').eq('employee_id', me.id).eq('year', year).order('sort_order'),
    supabase.from('leave_requests').select('*').eq('employee_id', me.id).order('submitted_at', { ascending: false }).limit(4),
    supabase.from('claims').select('*').eq('employee_id', me.id).order('submitted_at', { ascending: false }).limit(3),
    supabase.from('public_holidays').select('*').gte('holiday_date', today).order('holiday_date').limit(4),
    supabase.rpc('team_absence', { p_from: today, p_to: to }),
  ])

  const leader = isPeopleLeader(me)
  const apps = [
    { href: '/time-off?new=1', label: 'Request Time Off', icon: CalendarPlus },
    { href: '/time-off', label: 'My Time Off', icon: CalendarDays },
    { href: '/expenses/new', label: 'Create Expense Report', icon: Receipt },
    { href: '/expenses', label: 'My Expenses', icon: ReceiptText },
    { href: '/team', label: leader ? 'My Team' : 'Team Calendar', icon: Users },
    ...(leader || counts.inbox ? [{ href: '/inbox', label: 'Approvals', icon: ClipboardCheck, badge: counts.inbox }] : []),
    ...(hasRole(me, 'finance', 'admin') ? [{ href: '/finance', label: 'Claims Payment Queue', icon: Landmark, badge: counts.financeQueue }] : []),
    ...(hasRole(me, 'hr', 'office_manager', 'admin', 'director')
      ? [
          { href: '/hr/master-leave-record', label: 'Master Leave Record', icon: FileSpreadsheet },
          { href: '/hr', label: 'HR Reports', icon: BarChart3 },
        ]
      : []),
    { href: '/directory', label: 'Directory', icon: BookUser },
  ]

  const awayRows = (away.data ?? []).filter((a: { employee_id: string }) => a.employee_id !== me.id)

  return (
    <div className="space-y-6">
      {denied && (
        <div className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900 ring-1 ring-amber-100">
          That page is only available to certain roles.
        </div>
      )}
      <section className="overflow-hidden rounded-2xl bg-gradient-to-r from-navy via-[#123761] to-brand-700 px-6 py-8 text-white">
        <p className="text-sm text-white/70">{fmtDate(today, { weekday: 'long' })}</p>
        <h1 className="mt-1 text-3xl font-semibold">{greeting()}, {me.full_name.split(' ')[0]}</h1>
        <p className="mt-2 text-white/80">
          {counts.inbox > 0 ? (
            <>You have <Link href="/inbox" className="font-semibold text-sun underline-offset-2 hover:underline">{counts.inbox} item{counts.inbox === 1 ? '' : 's'} awaiting your action</Link>.</>
          ) : (
            "You're all caught up."
          )}
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Your top apps">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {apps.map((a) => (
                <Link
                  key={a.href}
                  href={a.href}
                  className="group relative flex flex-col items-start gap-3 rounded-xl border border-line p-4 transition hover:border-brand-200 hover:bg-brand-50"
                >
                  <span className="rounded-lg bg-brand-50 p-2 text-brand-600 group-hover:bg-white">
                    <a.icon className="h-5 w-5" />
                  </span>
                  <span className="text-sm font-medium leading-tight">{a.label}</span>
                  {'badge' in a && !!a.badge && (
                    <span className="absolute right-3 top-3 rounded-full bg-sun px-2 text-xs font-bold text-navy">{a.badge}</span>
                  )}
                </Link>
              ))}
            </div>
          </Card>

          <Card title={`Time off balances · ${year}`} actions={<Link href="/time-off" className="link text-sm">View all</Link>}>
            {(balances.data ?? []).length === 0 ? (
              <Empty title="No entitlements set up yet">HR will add your contract entitlements.</Empty>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {(balances.data as LeaveBalance[]).filter((b) => ['AL', 'SL', 'CCL'].includes(b.leave_type) || b.taken > 0).slice(0, 6).map((b) => (
                  <div key={b.leave_type} className="rounded-xl border border-line p-4">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />
                      <span className="text-sm font-medium">{b.leave_name}</span>
                    </div>
                    <p className="mt-2 text-2xl font-semibold">{num(b.available)}<span className="text-sm font-normal text-muted"> / {num(b.entitled)}</span></p>
                    <p className="text-xs text-muted">
                      {num(b.taken)} taken{b.pending > 0 ? ` · ${num(b.pending)} pending` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="My recent requests">
            {(myLeave.data ?? []).length + (myClaims.data ?? []).length === 0 ? (
              <Empty title="Nothing yet">Your time off and expense requests will show here.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {(myLeave.data as LeaveRequest[]).map((r) => (
                  <li key={r.id}>
                    <Link href={`/time-off/${r.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-canvas/60">
                      <div>
                        <p className="text-sm font-medium">{r.ref} · {fmtRange(r.start_date, r.end_date)}</p>
                        <p className="text-xs text-muted">{r.leave_type} · {days(r.days)}</p>
                      </div>
                      <LeaveStatusBadge status={r.status} />
                    </Link>
                  </li>
                ))}
                {(myClaims.data as Claim[]).map((c) => (
                  <li key={c.id}>
                    <Link href={`/expenses/${c.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-canvas/60">
                      <div>
                        <p className="text-sm font-medium">{c.ref} · {c.title}</p>
                        <p className="text-xs text-muted">{money(c.total_amount)}</p>
                      </div>
                      <ClaimStatusBadge status={c.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Who's away · next 2 weeks" actions={<Link href="/team" className="link text-sm">Calendar</Link>}>
            {awayRows.length === 0 ? (
              <p className="text-sm text-muted">No one in your team is away.</p>
            ) : (
              <ul className="space-y-3">
                {awayRows.slice(0, 6).map((a: { request_id: string; full_name: string; start_date: string; end_date: string; leave_name: string; status: string }) => (
                  <li key={a.request_id} className="flex items-center gap-3">
                    <Avatar name={a.full_name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{a.full_name}</p>
                      <p className="text-xs text-muted">
                        {fmtRange(a.start_date, a.end_date)} · {a.leave_name}{a.status === 'pending' ? ' (pending)' : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Upcoming public holidays">
            <ul className="space-y-2">
              {(holidays.data ?? []).map((h: { holiday_date: string; name: string }) => (
                <li key={h.holiday_date} className="flex items-center justify-between text-sm">
                  <span>{h.name}</span>
                  <span className="text-muted">{fmtDate(h.holiday_date, { weekday: 'short' })}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="About me">
            <div className="flex items-center gap-3">
              <Avatar name={me.full_name} />
              <div>
                <p className="text-sm font-semibold">{me.full_name}</p>
                <p className="text-xs text-muted">{me.job_title} · {me.department?.name}</p>
              </div>
            </div>
            <p className="mt-3 text-sm text-muted">
              Approver: <span className="text-ink">{me.manager?.full_name ?? 'Routed automatically'}</span>
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
