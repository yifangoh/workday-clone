import type { Metadata } from 'next'
import Link from 'next/link'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Card, Empty, Flags, LeaveStatusBadge, PageHeader } from '@/components/ui'
import { LeaveRequestForm } from '@/components/LeaveRequestForm'
import { fmtDate, fmtRange, halfDayLabel, num, todaySG } from '@/lib/format'
import type { LeaveBalance, LeaveRequest, LeaveType } from '@/lib/types'

export const metadata: Metadata = { title: 'Time Off' }

export default async function TimeOffPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const me = await requireMe()
  const supabase = await createClient()
  const today = todaySG()
  const { year: y } = await searchParams
  const year = Number(y) || Number(today.slice(0, 4))

  const [{ data: types }, { data: balances }, { data: requests }] = await Promise.all([
    supabase.from('leave_types').select('*').eq('is_active', true).order('sort_order'),
    supabase.from('v_leave_balances').select('*').eq('employee_id', me.id).eq('year', year).order('sort_order'),
    supabase.from('leave_requests').select('*').eq('employee_id', me.id).order('start_date', { ascending: false }),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Time Off"
        subtitle="Request leave, check balances and track approvals."
        actions={
          <div className="flex gap-1 rounded-full bg-white p-1 ring-1 ring-line">
            {[year - 1, year, year + 1].map((yy) => (
              <Link key={yy} href={`/time-off?year=${yy}`} className={`rounded-full px-3 py-1 text-sm ${yy === year ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink'}`}>
                {yy}
              </Link>
            ))}
          </div>
        }
      />

      <Card title={`Balances · ${year}`} padded={false}>
        {(balances ?? []).length === 0 ? (
          <div className="p-5"><Empty title={`No entitlements for ${year}`}>HR sets these up from your contract.</Empty></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>Type</th><th className="text-right">Entitlement</th><th className="text-right">Taken</th><th className="text-right">Pending</th><th className="text-right">Available</th><th>Note</th></tr>
              </thead>
              <tbody>
                {(balances as LeaveBalance[]).map((b) => (
                  <tr key={b.leave_type}>
                    <td><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />{b.leave_name}</td>
                    <td className="text-right">{num(b.entitled)}{b.adjustments ? <span className="text-xs text-muted"> ({b.adjustments > 0 ? '+' : ''}{num(b.adjustments)} adj.)</span> : null}</td>
                    <td className="text-right">{num(b.taken)}</td>
                    <td className="text-right">{num(b.pending)}</td>
                    <td className="text-right font-semibold">{num(b.available)}</td>
                    <td className="text-xs text-muted">{b.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Request time off">
        <LeaveRequestForm types={(types ?? []) as LeaveType[]} today={today} approverName={me.manager?.full_name ?? 'your approver'} />
      </Card>

      <Card title="My requests" padded={false}>
        {(requests ?? []).length === 0 ? (
          <div className="p-5"><Empty title="No requests yet" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Ref</th><th>Dates</th><th>Type</th><th className="text-right">Days</th><th>Status</th><th>Submitted</th></tr></thead>
              <tbody>
                {(requests as LeaveRequest[]).map((r) => (
                  <tr key={r.id} className="hover:bg-canvas/60">
                    <td><Link href={`/time-off/${r.id}`} className="link">{r.ref}</Link></td>
                    <td>{fmtRange(r.start_date, r.end_date)} {r.half_day !== 'none' && <span className="text-xs text-muted">· {halfDayLabel(r.half_day)}</span>}</td>
                    <td>{r.leave_type}</td>
                    <td className="text-right">{num(r.days)}</td>
                    <td className="space-x-1"><LeaveStatusBadge status={r.status} /> <Flags flags={r.flags} /></td>
                    <td className="text-muted">{fmtDate(r.submitted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
