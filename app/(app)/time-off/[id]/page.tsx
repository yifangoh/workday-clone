import { notFound } from 'next/navigation'
import { requireMe, hasRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { employeeNames } from '@/lib/queries'
import { AuditTrail } from '@/components/AuditTrail'
import { DecisionForm } from '@/components/DecisionForm'
import { ActionForm, SubmitButton } from '@/components/forms'
import { Card, DL, Flags, LeaveStatusBadge, PageHeader } from '@/components/ui'
import { cancelLeave, decideLeave } from '@/app/actions'
import { days, fmtDateTime, fmtRange, halfDayLabel, num, todaySG } from '@/lib/format'
import type { LeaveRequest } from '@/lib/types'

export default async function LeaveDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await requireMe()
  const supabase = await createClient()
  const { data } = await supabase.from('leave_requests').select('*, leave_types(name, color)').eq('id', id).maybeSingle()
  if (!data) notFound()
  const r = data as LeaveRequest & { leave_types: { name: string; color: string } }
  const names = await employeeNames([r.employee_id, r.approver_id, r.original_approver_id, r.decided_by])
  const own = r.employee_id === me.id
  const isApprover = !own && r.status === 'pending' && (r.approver_id === me.id || r.original_approver_id === me.id || hasRole(me, 'admin'))
  const canCancel =
    (own && (r.status === 'pending' || (r.status === 'approved' && r.start_date > todaySG()))) ||
    (hasRole(me, 'hr', 'admin') && (r.status === 'pending' || r.status === 'approved'))

  return (
    <div className="space-y-6">
      <PageHeader
        back={own ? { href: '/time-off', label: 'Time Off' } : { href: '/inbox', label: 'Inbox' }}
        title={`${r.ref} · ${r.leave_types.name}`}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><LeaveStatusBadge status={r.status} /> <Flags flags={r.flags} /></span>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Request">
            <DL
              items={[
                ['Employee', names.get(r.employee_id)?.full_name],
                ['Dates', <>{fmtRange(r.start_date, r.end_date)}{r.half_day !== 'none' && ` · ${halfDayLabel(r.half_day)}`}</>],
                ['Working days', days(r.days)],
                ['Balance at submission', r.balance_before != null ? `${num(r.balance_before)} → ${num(r.balance_after)} after` : 'Not tracked'],
                ['Reason', r.reason || '—'],
                ['Supporting document', r.document_ref || '—'],
                ['Approver', <>{names.get(r.approver_id ?? '')?.full_name ?? '—'}{r.original_approver_id && <span className="text-xs text-muted"> (escalated from {names.get(r.original_approver_id)?.full_name})</span>}</>],
                ['Submitted', fmtDateTime(r.submitted_at)],
                ...(r.decided_at ? ([['Decision', `${r.status === 'approved' ? 'Approved' : 'Not approved'} by ${names.get(r.decided_by ?? '')?.full_name ?? '—'} · ${fmtDateTime(r.decided_at)}`]] as [string, string][]) : []),
                ...(r.decision_remark ? ([['Remark', `“${r.decision_remark}”`]] as [string, string][]) : []),
                ...(r.cancel_reason ? ([['Cancellation reason', r.cancel_reason]] as [string, string][]) : []),
              ]}
            />
            {r.clash_with?.length > 0 && (
              <div className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-900">
                <p className="font-semibold">Team clash at submission</p>
                <ul className="mt-1 list-disc pl-5">
                  {r.clash_with.map((c) => (
                    <li key={c.ref}>{c.name} · {fmtRange(c.start_date, c.end_date)} · {c.leave_type} ({c.status})</li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          {isApprover && (
            <Card title="Your decision">
              <DecisionForm id={r.id} action={decideLeave} approveLabel="Approve & record" />
            </Card>
          )}

          {canCancel && (
            <Card title="Cancel this request">
              <ActionForm action={cancelLeave}>
                <input type="hidden" name="id" value={r.id} />
                <input name="reason" className="input" placeholder="Reason (optional)" />
                <p className="text-xs text-muted">
                  {r.status === 'approved' ? `${days(r.days)} will be returned to the balance and the Office Manager notified.` : 'Your approver will be notified.'}
                </p>
                <SubmitButton className="btn-danger" pendingText="Cancelling…">Cancel request</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
        <Card title="Audit trail">
          <AuditTrail entity="leave" id={r.id} />
        </Card>
      </div>
    </div>
  )
}
