import type { Metadata } from 'next'
import Link from 'next/link'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { employeeNames } from '@/lib/queries'
import { DecisionForm } from '@/components/DecisionForm'
import { Avatar, Badge, Card, Empty, Flags, PageHeader } from '@/components/ui'
import { decideClaim, decideLeave } from '@/app/actions'
import { days, fmtDate, fmtRange, halfDayLabel, money, num, timeAgo } from '@/lib/format'
import type { Claim, ClaimLine, LeaveBalance, LeaveRequest } from '@/lib/types'

export const metadata: Metadata = { title: 'Inbox' }

export default async function InboxPage() {
  const me = await requireMe()
  const supabase = await createClient()
  const mine = `approver_id.eq.${me.id},original_approver_id.eq.${me.id}`
  const [{ data: leave }, { data: claims }] = await Promise.all([
    supabase.from('leave_requests').select('*, leave_types(name, color)').eq('status', 'pending').or(mine).neq('employee_id', me.id).order('submitted_at'),
    supabase.from('claims').select('*, claim_lines(*)').eq('status', 'pending').or(mine).neq('employee_id', me.id).order('submitted_at'),
  ])
  const leaveRows = (leave ?? []) as (LeaveRequest & { leave_types: { name: string; color: string } })[]
  const claimRows = (claims ?? []) as (Claim & { claim_lines: ClaimLine[] })[]
  const names = await employeeNames([...leaveRows, ...claimRows].flatMap((r) => [r.employee_id, r.original_approver_id]))

  const balanceKeys = leaveRows.map((r) => r.employee_id)
  const { data: balances } = balanceKeys.length
    ? await supabase.from('v_leave_balances').select('*').in('employee_id', balanceKeys)
    : { data: [] }
  const bal = (emp: string, type: string, year: number) =>
    (balances as LeaveBalance[]).find((b) => b.employee_id === emp && b.leave_type === type && b.year === year)

  return (
    <div className="space-y-6">
      <PageHeader title="Inbox" subtitle="Requests waiting for your decision. Approved leave posts straight to the Master Leave Record; approved claims go to Finance." />

      {leaveRows.length + claimRows.length === 0 && (
        <Card><Empty title="Nothing awaiting your action">New requests from your team will appear here, with balance and clash checks already done.</Empty></Card>
      )}

      {leaveRows.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Time off · {leaveRows.length}</h2>
          {leaveRows.map((r) => {
            const year = Number(r.start_date.slice(0, 4))
            const b = bal(r.employee_id, r.leave_type, year)
            const name = names.get(r.employee_id)?.full_name ?? '—'
            return (
              <Card key={r.id}>
                <div className="grid gap-5 md:grid-cols-5">
                  <div className="md:col-span-3">
                    <div className="flex items-start gap-3">
                      <Avatar name={name} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{name}</p>
                          <Badge color="blue">{r.leave_types.name}</Badge>
                          <Flags flags={r.flags} />
                          {r.escalated_at && <Badge color="violet">Escalated</Badge>}
                          {r.reminder_sent_at && !r.escalated_at && <Badge>Reminder sent</Badge>}
                        </div>
                        <p className="mt-1 text-lg font-medium">
                          {fmtRange(r.start_date, r.end_date)} <span className="text-sm font-normal text-muted">· {days(r.days)}{r.half_day !== 'none' && ` · ${halfDayLabel(r.half_day)}`}</span>
                        </p>
                        <p className="text-sm text-muted">
                          <Link href={`/time-off/${r.id}`} className="link">{r.ref}</Link> · submitted {timeAgo(r.submitted_at)}
                          {r.original_approver_id && r.original_approver_id !== me.id && ` · escalated from ${names.get(r.original_approver_id)?.full_name}`}
                        </p>
                        {r.reason && <p className="mt-2 text-sm">“{r.reason}”</p>}
                        {r.document_ref && <p className="mt-1 text-sm text-muted">Document: {r.document_ref}</p>}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3 md:col-span-2">
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="rounded-lg bg-canvas p-2">
                        <p className="text-[11px] uppercase tracking-wide text-muted">Balance now</p>
                        <p className="text-lg font-semibold">{b ? num(Number(b.balance)) : '—'}</p>
                      </div>
                      <div className="rounded-lg bg-canvas p-2">
                        <p className="text-[11px] uppercase tracking-wide text-muted">After approval</p>
                        <p className="text-lg font-semibold">{b ? num(Number(b.balance) - Number(r.days)) : '—'}</p>
                      </div>
                    </div>
                    {r.clash_with?.length > 0 && (
                      <div className="rounded-lg bg-red-50 p-2 text-xs text-red-900">
                        <p className="font-semibold">Also away on these dates</p>
                        {r.clash_with.map((c) => (
                          <p key={c.ref}>{c.name} · {fmtRange(c.start_date, c.end_date)} ({c.status})</p>
                        ))}
                      </div>
                    )}
                    <DecisionForm id={r.id} action={decideLeave} approveLabel="Approve & record" />
                  </div>
                </div>
              </Card>
            )
          })}
        </section>
      )}

      {claimRows.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Expense claims · {claimRows.length}</h2>
          {claimRows.map((c) => {
            const name = names.get(c.employee_id)?.full_name ?? '—'
            return (
              <Card key={c.id}>
                <div className="grid gap-5 md:grid-cols-5">
                  <div className="md:col-span-3">
                    <div className="flex items-start gap-3">
                      <Avatar name={name} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{name}</p>
                          <Flags flags={c.flags} />
                          {c.escalated_at && <Badge color="violet">Escalated</Badge>}
                        </div>
                        <p className="mt-1 text-lg font-medium">{c.title} <span className="text-sm font-normal text-muted">· {money(c.total_amount)}</span></p>
                        <p className="text-sm text-muted"><Link href={`/expenses/${c.id}`} className="link">{c.ref}</Link> · submitted {timeAgo(c.submitted_at)}</p>
                        <ul className="mt-2 divide-y divide-line rounded-lg border border-line text-sm">
                          {c.claim_lines.sort((a, b) => a.line_no - b.line_no).map((l) => (
                            <li key={l.id} className="flex justify-between gap-3 px-3 py-1.5">
                              <span className="min-w-0 truncate">{fmtDate(l.expense_date)} · {l.description} <span className="text-xs text-muted">({l.receipt_no ?? 'no receipt'})</span></span>
                              <span className="shrink-0 font-medium">{money(l.amount)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <DecisionForm id={c.id} action={decideClaim} approveLabel="Approve & send to Finance" />
                  </div>
                </div>
              </Card>
            )
          })}
        </section>
      )}
    </div>
  )
}
