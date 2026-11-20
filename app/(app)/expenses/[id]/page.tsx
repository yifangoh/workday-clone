import { notFound } from 'next/navigation'
import { requireMe, hasRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { employeeNames } from '@/lib/queries'
import { AuditTrail } from '@/components/AuditTrail'
import { DecisionForm } from '@/components/DecisionForm'
import { FinanceActions } from '@/components/FinanceActions'
import { ActionForm, SubmitButton } from '@/components/forms'
import { Card, ClaimStatusBadge, DL, Flags, PageHeader } from '@/components/ui'
import { cancelClaim, decideClaim } from '@/app/actions'
import { fmtDate, fmtDateTime, money, todaySG } from '@/lib/format'
import type { Claim, ClaimLine, ClaimType } from '@/lib/types'

export default async function ClaimDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ submitted?: string }> }) {
  const { id } = await params
  const { submitted } = await searchParams
  const me = await requireMe()
  const supabase = await createClient()
  const [{ data }, { data: types }] = await Promise.all([
    supabase.from('claims').select('*, claim_lines(*)').eq('id', id).maybeSingle(),
    supabase.from('claim_types').select('*'),
  ])
  if (!data) notFound()
  const c = data as Claim & { claim_lines: ClaimLine[] }
  const lines = [...c.claim_lines].sort((a, b) => a.line_no - b.line_no)
  const typeName = new Map(((types ?? []) as ClaimType[]).map((t) => [t.code, t]))
  const names = await employeeNames([c.employee_id, c.approver_id, c.original_approver_id, c.decided_by, c.finance_by])

  const signed = new Map<string, string>()
  const paths = lines.map((l) => l.attachment_path).filter(Boolean) as string[]
  if (paths.length) {
    const { data: urls } = await supabase.storage.from('receipts').createSignedUrls(paths, 600)
    urls?.forEach((u) => u.signedUrl && u.path && signed.set(u.path, u.signedUrl))
  }

  const own = c.employee_id === me.id
  const isApprover = !own && c.status === 'pending' && (c.approver_id === me.id || c.original_approver_id === me.id || hasRole(me, 'admin'))
  const isFinance = !own && c.status === 'submitted_to_finance' && hasRole(me, 'finance', 'admin')

  return (
    <div className="space-y-6">
      <PageHeader
        back={own ? { href: '/expenses', label: 'Expenses' } : isFinance ? { href: '/finance', label: 'Finance' } : { href: '/inbox', label: 'Inbox' }}
        title={`${c.ref} · ${c.title}`}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><ClaimStatusBadge status={c.status} /> <Flags flags={c.flags} /></span>}
      />
      {submitted && (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800 ring-1 ring-emerald-100">
          Submitted. {names.get(c.approver_id ?? '')?.full_name ?? 'Your approver'} has been notified.
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Expense lines" padded={false}>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>#</th><th>Date</th><th>Type</th><th>Description</th><th>Receipt</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {lines.map((l) => {
                    const t = typeName.get(l.claim_type)
                    const over = t?.per_line_limit != null && Number(l.amount) > Number(t.per_line_limit)
                    return (
                      <tr key={l.id}>
                        <td className="text-muted">{l.line_no}</td>
                        <td>{fmtDate(l.expense_date)}</td>
                        <td>{t?.name ?? l.claim_type}</td>
                        <td>{l.description}</td>
                        <td>
                          {l.receipt_no ?? '—'}
                          {l.attachment_path && signed.get(l.attachment_path) && (
                            <> · <a href={signed.get(l.attachment_path)} target="_blank" rel="noreferrer" className="link">view</a></>
                          )}
                        </td>
                        <td className={`text-right font-medium ${over ? 'text-amber-700' : ''}`}>{money(l.amount)}{over && ' ⚑'}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr><td colSpan={5} className="text-right font-semibold">Total</td><td className="text-right text-base font-semibold">{money(c.total_amount)}</td></tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <Card title="Details">
            <DL
              items={[
                ['Employee', names.get(c.employee_id)?.full_name],
                ['Submitted', fmtDateTime(c.submitted_at)],
                ['Approver', <>{names.get(c.approver_id ?? '')?.full_name ?? '—'}{c.original_approver_id && <span className="text-xs text-muted"> (escalated from {names.get(c.original_approver_id)?.full_name})</span>}</>],
                ['Declaration', c.declaration ? 'Confirmed by employee' : 'Missing'],
                ...(c.decided_at ? ([['Decision', `${c.status === 'rejected' ? 'Not approved' : 'Approved'} by ${names.get(c.decided_by ?? '')?.full_name} · ${fmtDateTime(c.decided_at)}`]] as [string, string][]) : []),
                ...(c.decision_remark ? ([['Approver remark', `“${c.decision_remark}”`]] as [string, string][]) : []),
                ...(c.payment_ref ? ([['Payment', `${c.payment_ref} · ${fmtDate(c.paid_on)} · by ${names.get(c.finance_by ?? '')?.full_name}`]] as [string, string][]) : []),
                ...(c.finance_remark ? ([['Finance remark', `“${c.finance_remark}”`]] as [string, string][]) : []),
              ]}
            />
          </Card>

          {isApprover && (
            <Card title="Your decision">
              <DecisionForm id={c.id} action={decideClaim} approveLabel="Approve & send to Finance" />
            </Card>
          )}
          {isFinance && (
            <Card title="Finance">
              <FinanceActions id={c.id} today={todaySG()} />
            </Card>
          )}
          {own && c.status === 'pending' && (
            <Card title="Withdraw">
              <ActionForm action={cancelClaim}>
                <input type="hidden" name="id" value={c.id} />
                <p className="text-sm text-muted">Withdraw this claim before it is approved. You can submit a corrected one afterwards.</p>
                <SubmitButton className="btn-danger" pendingText="Withdrawing…">Withdraw claim</SubmitButton>
              </ActionForm>
            </Card>
          )}
          {own && (c.status === 'returned' || c.status === 'rejected') && (
            <Card title="Next step">
              <p className="text-sm">Fix the issue in the remark above and <a href="/expenses/new" className="link">submit a new expense report</a>. Receipts on this claim can be reused.</p>
            </Card>
          )}
        </div>
        <Card title="Audit trail">
          <AuditTrail entity="claim" id={c.id} />
        </Card>
      </div>
    </div>
  )
}
