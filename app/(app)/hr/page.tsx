import type { Metadata } from 'next'
import Link from 'next/link'
import { Download } from 'lucide-react'
import { requireRole, hasRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { HrTabs } from '@/components/HrTabs'
import { ActionForm, SubmitButton } from '@/components/forms'
import { Card, PageHeader, Stat } from '@/components/ui'
import { runReminders } from '@/app/actions'
import { money, num, todaySG } from '@/lib/format'

export const metadata: Metadata = { title: 'HR' }

type Report = {
  period: { from: string; to: string }
  by_type: { type: string; code: string; requests: number; days: number }[]
  by_department: { department: string; requests: number; days: number }[]
  top_takers: { name: string; days: number; requests: number }[]
  kpis: {
    submitted: number; decided: number; decided_within_1_wd: number; pct_within_1_wd: number | null
    pending_now: number; escalated: number; ledger_mismatches: number; requests_without_audit: number
  }
  claims: { submitted: number; awaiting_finance: number; awaiting_finance_amount: number; paid_amount: number; returned: number }
  patterns: { sick_leave_next_to_weekends_or_holidays: { name: string; occurrences: number }[]; short_notice_requests: number; team_clash_requests: number }
}

export default async function HrPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const me = await requireRole('hr', 'office_manager', 'admin', 'director')
  const sp = await searchParams
  const today = todaySG()
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? sp.month! : today.slice(0, 7)
  const [y, m] = month.split('-').map(Number)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('hr_leave_report', { p_year: y, p_month: m })
  const r = data as Report | null
  const label = new Date(y, m - 1, 1).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' })
  const totalDays = r?.by_type.reduce((a, t) => a + Number(t.days), 0) ?? 0

  return (
    <div>
      <PageHeader
        title="HR"
        subtitle="Live view of leave, balances and workflow health."
        actions={
          <form className="flex items-center gap-2">
            <input type="month" name="month" defaultValue={month} className="input w-auto" />
            <button className="btn-secondary btn-sm">Show</button>
          </form>
        }
      />
      <HrTabs active="/hr" />
      {error || !r ? (
        <Card><p className="text-sm text-red-700">{error?.message ?? 'Report unavailable'}</p></Card>
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Success criteria · {label}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="Decided within 1 working day"
                value={r.kpis.pct_within_1_wd == null ? '—' : `${r.kpis.pct_within_1_wd}%`}
                hint={`${r.kpis.decided_within_1_wd} of ${r.kpis.decided} decided · target 90%`}
                tone={r.kpis.pct_within_1_wd == null ? 'default' : r.kpis.pct_within_1_wd >= 90 ? 'good' : 'bad'}
              />
              <Stat
                label="Master Leave Record matches approvals"
                value={r.kpis.ledger_mismatches === 0 ? '100%' : `${r.kpis.ledger_mismatches} mismatch`}
                hint="Every approved day posted, every cancellation reversed"
                tone={r.kpis.ledger_mismatches === 0 ? 'good' : 'bad'}
              />
              <Stat
                label="Requests with audit trail"
                value={r.kpis.requests_without_audit === 0 ? '100%' : `${r.kpis.requests_without_audit} missing`}
                hint="Time-stamped from submission to decision"
                tone={r.kpis.requests_without_audit === 0 ? 'good' : 'bad'}
              />
              <Stat label="Manual re-keying" value="0" hint="Approvals write the record directly" tone="good" />
            </div>
          </section>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Requests submitted" value={r.kpis.submitted} hint={label} />
            <Stat label="Pending right now" value={r.kpis.pending_now} hint={`${r.kpis.escalated} escalated this month`} />
            <Stat label="Leave days taken" value={num(totalDays)} hint="approved, overlapping the month" />
            <Stat label="Claims with Finance" value={money(r.claims.awaiting_finance_amount)} hint={`${r.claims.awaiting_finance} claim(s) · ${money(r.claims.paid_amount)} paid this month`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="By leave type" padded={false}>
              <table className="data-table">
                <thead><tr><th>Type</th><th className="text-right">Requests</th><th className="text-right">Days</th></tr></thead>
                <tbody>
                  {r.by_type.map((t) => <tr key={t.code}><td>{t.type}</td><td className="text-right">{t.requests}</td><td className="text-right">{num(t.days)}</td></tr>)}
                  {r.by_type.length === 0 && <tr><td colSpan={3} className="text-muted">No approved leave this month.</td></tr>}
                </tbody>
              </table>
            </Card>
            <Card title="By department" padded={false}>
              <table className="data-table">
                <thead><tr><th>Department</th><th className="text-right">Requests</th><th className="text-right">Days</th></tr></thead>
                <tbody>
                  {r.by_department.map((t) => <tr key={t.department}><td>{t.department}</td><td className="text-right">{t.requests}</td><td className="text-right">{num(t.days)}</td></tr>)}
                  {r.by_department.length === 0 && <tr><td colSpan={3} className="text-muted">—</td></tr>}
                </tbody>
              </table>
            </Card>
            <Card title="Patterns to review">
              <ul className="space-y-3 text-sm">
                <li>
                  <p className="font-medium">Sick leave next to weekends / public holidays (last 90 days, 2+ times)</p>
                  <p className="text-muted">
                    {r.patterns.sick_leave_next_to_weekends_or_holidays.length === 0
                      ? 'None'
                      : r.patterns.sick_leave_next_to_weekends_or_holidays.map((p) => `${p.name} (${p.occurrences})`).join(', ')}
                  </p>
                </li>
                <li><p className="font-medium">Short-notice requests</p><p className="text-muted">{r.patterns.short_notice_requests}</p></li>
                <li><p className="font-medium">Requests with team clashes</p><p className="text-muted">{r.patterns.team_clash_requests}</p></li>
                <li><p className="font-medium">Top leave takers</p><p className="text-muted">{r.top_takers.map((t) => `${t.name} (${num(t.days)})`).join(', ') || '—'}</p></li>
              </ul>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Exports">
              <div className="flex flex-wrap gap-2">
                <a className="btn-secondary btn-sm" href={`/api/export/leave-requests?month=${month}&status=approved`}><Download className="h-4 w-4" /> Approved leave · {label}</a>
                <a className="btn-secondary btn-sm" href={`/api/export/master-leave-record?year=${y}`}><Download className="h-4 w-4" /> Master Leave Record {y}</a>
                <a className="btn-secondary btn-sm" href={`/api/export/claims?month=${month}`}><Download className="h-4 w-4" /> Claims · {label}</a>
              </div>
              <p className="mt-3 text-xs text-muted">CSV opens in Excel. Use the approved-leave and paid-claims files for payroll.</p>
            </Card>
            {hasRole(me, 'hr', 'admin', 'office_manager') && (
              <Card title="Reminders & escalation">
                <p className="text-sm text-muted">
                  Runs every hour automatically: approvers get a reminder after 1 working day; after 2 the request moves to their own approver (or HR is alerted).
                </p>
                <ActionForm action={runReminders} className="mt-3">
                  <SubmitButton className="btn-secondary btn-sm" pendingText="Running…">Run now</SubmitButton>
                </ActionForm>
                <Link href="/hr/requests?status=pending" className="link mt-3 inline-block text-sm">See pending requests →</Link>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
