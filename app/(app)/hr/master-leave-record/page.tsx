import type { Metadata } from 'next'
import Link from 'next/link'
import { Download } from 'lucide-react'
import { requireRole, hasRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { employeeNames } from '@/lib/queries'
import { HrTabs } from '@/components/HrTabs'
import { ActionForm, SubmitButton } from '@/components/forms'
import { Card, PageHeader } from '@/components/ui'
import { adjustBalance, setEntitlement } from '@/app/actions'
import { fmtDateTime, num, todaySG } from '@/lib/format'
import type { Department, LeaveBalance, LeaveType } from '@/lib/types'

export const metadata: Metadata = { title: 'Master Leave Record' }

type LedgerRow = { id: number; leave_type: string; days: number; entry_type: string; note: string | null; created_by: string | null; created_at: string; request_id: string | null }

export default async function MasterLeaveRecord({ searchParams }: { searchParams: Promise<{ year?: string; dept?: string; emp?: string }> }) {
  const me = await requireRole('hr', 'office_manager', 'admin', 'director')
  const sp = await searchParams
  const year = Number(sp.year) || Number(todaySG().slice(0, 4))
  const supabase = await createClient()
  let q = supabase.from('v_leave_balances').select('*').eq('year', year).order('full_name').order('sort_order')
  if (sp.dept) q = q.eq('department_id', sp.dept)
  const [{ data: rows }, { data: types }, { data: depts }] = await Promise.all([
    q,
    supabase.from('leave_types').select('*').eq('tracks_balance', true).eq('is_active', true).order('sort_order'),
    supabase.from('departments').select('*').order('name'),
  ])
  const balances = (rows ?? []) as LeaveBalance[]
  const leaveTypes = (types ?? []) as LeaveType[]
  const people = [...new Map(balances.map((b) => [b.employee_id, b])).values()]
  const cell = (emp: string, t: string) => balances.find((b) => b.employee_id === emp && b.leave_type === t)
  const canEdit = hasRole(me, 'hr', 'admin')

  const selected = sp.emp ? people.find((p) => p.employee_id === sp.emp) : undefined
  const { data: ledger } = selected
    ? await supabase.from('leave_ledger').select('*').eq('employee_id', selected.employee_id).eq('year', year).order('created_at', { ascending: false })
    : { data: [] }
  const ledgerRows = (ledger ?? []) as LedgerRow[]
  const names = await employeeNames(ledgerRows.map((l) => l.created_by))
  const qs = (o: Record<string, string | undefined>) =>
    '?' + new URLSearchParams(Object.entries({ year: String(year), dept: sp.dept, ...o }).filter(([, v]) => v) as [string, string][]).toString()

  return (
    <div>
      <PageHeader
        title="HR"
        subtitle="Balance = contract entitlement − approved days ± HR adjustments. Updated automatically on every approval and cancellation."
        actions={
          <>
            <form className="flex items-center gap-2">
              <select name="year" defaultValue={year} className="input w-auto">
                {[year - 1, year, year + 1].map((yy) => <option key={yy}>{yy}</option>)}
              </select>
              <select name="dept" defaultValue={sp.dept ?? ''} className="input w-auto">
                <option value="">All departments</option>
                {((depts ?? []) as Department[]).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <button className="btn-secondary btn-sm">Show</button>
            </form>
            <a className="btn-secondary btn-sm" href={`/api/export/master-leave-record?year=${year}${sp.dept ? `&dept=${sp.dept}` : ''}`}><Download className="h-4 w-4" /> CSV</a>
          </>
        }
      />
      <HrTabs active="/hr/master-leave-record" />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title={`Master Leave Record · ${year}`} padded={false} className={selected ? 'xl:col-span-2' : 'xl:col-span-3'}>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  {leaveTypes.map((t) => <th key={t.code} className="text-right" title={t.name}>{t.code}</th>)}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.employee_id} className={p.employee_id === sp.emp ? 'bg-brand-50' : 'hover:bg-canvas/60'}>
                    <td>
                      <Link href={qs({ emp: p.employee_id })} className="link">{p.full_name}</Link>
                      <p className="text-xs text-muted">{p.employee_no} · {p.department_name}</p>
                    </td>
                    {leaveTypes.map((t) => {
                      const b = cell(p.employee_id, t.code)
                      return (
                        <td key={t.code} className="text-right tabular-nums">
                          {b ? (
                            <>
                              <span className={Number(b.available) <= 0 ? 'font-semibold text-red-700' : 'font-semibold'}>{num(b.available)}</span>
                              <span className="text-muted">/{num(b.entitled)}</span>
                              {Number(b.pending) > 0 && <p className="text-[11px] text-amber-700">{num(b.pending)} pending</p>}
                            </>
                          ) : '—'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-2 text-xs text-muted">Shows available / entitlement. Available already deducts pending requests.</p>
        </Card>

        {selected && (
          <div className="space-y-6">
            <Card title={selected.full_name} actions={<Link href={qs({ emp: undefined })} className="text-sm text-muted hover:text-ink">Close</Link>} padded={false}>
              <table className="data-table">
                <thead><tr><th>Type</th><th className="text-right">Ent.</th><th className="text-right">Adj.</th><th className="text-right">Taken</th><th className="text-right">Bal.</th></tr></thead>
                <tbody>
                  {balances.filter((b) => b.employee_id === selected.employee_id).map((b) => (
                    <tr key={b.leave_type}>
                      <td>{b.leave_name}{b.note && <p className="text-[11px] text-muted">{b.note}</p>}</td>
                      <td className="text-right">{num(b.entitled)}</td>
                      <td className="text-right">{num(b.adjustments)}</td>
                      <td className="text-right">{num(b.taken)}</td>
                      <td className="text-right font-semibold">{num(b.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Postings" padded={false}>
              <ul className="divide-y divide-line text-sm">
                {ledgerRows.map((l) => (
                  <li key={l.id} className="flex justify-between gap-3 px-4 py-2">
                    <div>
                      <p>{l.leave_type} · {l.entry_type === 'approved' ? 'Approved leave' : l.entry_type === 'reversal' ? 'Cancellation reversal' : 'HR adjustment'}</p>
                      <p className="text-xs text-muted">{l.note} · {fmtDateTime(l.created_at)}{l.created_by && ` · ${names.get(l.created_by)?.full_name}`}</p>
                    </div>
                    <span className={`shrink-0 font-semibold ${Number(l.days) < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{Number(l.days) > 0 ? '+' : ''}{num(l.days)}</span>
                  </li>
                ))}
                {ledgerRows.length === 0 && <li className="px-4 py-3 text-muted">No postings in {year}.</li>}
              </ul>
            </Card>

            {canEdit && (
              <>
                <Card title="Set contract entitlement">
                  <ActionForm action={setEntitlement}>
                    <input type="hidden" name="employee_id" value={selected.employee_id} />
                    <input type="hidden" name="year" value={year} />
                    <div className="grid grid-cols-2 gap-2">
                      <select name="leave_type" className="input">{leaveTypes.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select>
                      <input name="days" type="number" step="0.5" min="0" required className="input" placeholder="Days" />
                    </div>
                    <input name="note" className="input" placeholder="Note (e.g. per contract clause 4.2)" />
                    <SubmitButton className="btn-primary btn-sm">Save entitlement</SubmitButton>
                  </ActionForm>
                </Card>
                <Card title="Manual adjustment">
                  <ActionForm action={adjustBalance} resetOnSuccess>
                    <input type="hidden" name="employee_id" value={selected.employee_id} />
                    <input type="hidden" name="year" value={year} />
                    <div className="grid grid-cols-2 gap-2">
                      <select name="leave_type" className="input">{leaveTypes.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select>
                      <input name="days" type="number" step="0.5" required className="input" placeholder="+/- days" />
                    </div>
                    <input name="note" required className="input" placeholder="Reason (required, e.g. carry-forward from 2025)" />
                    <SubmitButton className="btn-secondary btn-sm">Post adjustment</SubmitButton>
                  </ActionForm>
                </Card>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
