import type { Metadata } from 'next'
import Link from 'next/link'
import { Download } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { employeeNames } from '@/lib/queries'
import { FinanceActions } from '@/components/FinanceActions'
import { Card, ClaimStatusBadge, Empty, Flags, PageHeader, Stat, Tabs } from '@/components/ui'
import { fmtDate, money, timeAgo, todaySG } from '@/lib/format'
import type { Claim, ClaimLine } from '@/lib/types'

export const metadata: Metadata = { title: 'Finance' }

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireRole('finance', 'admin')
  const { tab = 'queue' } = await searchParams
  const supabase = await createClient()
  const today = todaySG()
  const [{ data: queue }, { data: history }] = await Promise.all([
    supabase.from('claims').select('*, claim_lines(*)').eq('status', 'submitted_to_finance').order('decided_at'),
    supabase.from('claims').select('*').in('status', ['paid', 'returned']).order('finance_at', { ascending: false }).limit(100),
  ])
  const q = (queue ?? []) as (Claim & { claim_lines: ClaimLine[] })[]
  const h = (history ?? []) as Claim[]
  const names = await employeeNames([...q, ...h].flatMap((c) => [c.employee_id, c.decided_by]))
  const queueTotal = q.reduce((a, c) => a + Number(c.total_amount), 0)
  const paidThisMonth = h.filter((c) => c.status === 'paid' && c.paid_on?.slice(0, 7) === today.slice(0, 7)).reduce((a, c) => a + Number(c.total_amount), 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Claims payment queue"
        subtitle="Approved claims land here automatically. Pay them in the next payroll or return them with a reason."
        actions={
          <>
            <a href="/api/export/claims?status=submitted_to_finance" className="btn-secondary"><Download className="h-4 w-4" /> Queue CSV</a>
            <a href={`/api/export/claims?status=paid&month=${today.slice(0, 7)}`} className="btn-secondary"><Download className="h-4 w-4" /> Paid this month CSV</a>
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Ready to pay" value={money(queueTotal)} hint={`${q.length} claim${q.length === 1 ? '' : 's'}`} />
        <Stat label="Paid this month" value={money(paidThisMonth)} tone="good" />
        <Stat label="Returned (recent)" value={h.filter((c) => c.status === 'returned').length} />
      </div>
      <Tabs active={`/finance?tab=${tab}`} tabs={[{ href: '/finance?tab=queue', label: 'To pay', count: q.length }, { href: '/finance?tab=history', label: 'Paid & returned' }]} />

      {tab === 'queue' ? (
        q.length === 0 ? (
          <Card><Empty title="Nothing to pay">Approved claims will appear here.</Empty></Card>
        ) : (
          <div className="space-y-3">
            {q.map((c) => (
              <Card key={c.id}>
                <div className="grid gap-5 md:grid-cols-5">
                  <div className="md:col-span-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/expenses/${c.id}`} className="link">{c.ref}</Link>
                      <span className="font-semibold">{names.get(c.employee_id)?.full_name}</span>
                      <Flags flags={c.flags} />
                    </div>
                    <p className="mt-1 text-lg font-medium">{c.title} · {money(c.total_amount)}</p>
                    <p className="text-sm text-muted">Approved by {names.get(c.decided_by ?? '')?.full_name} {c.decided_at && timeAgo(c.decided_at)}</p>
                    <ul className="mt-2 text-sm text-muted">
                      {c.claim_lines.sort((a, b) => a.line_no - b.line_no).map((l) => (
                        <li key={l.id}>{fmtDate(l.expense_date)} · {l.description} · {l.receipt_no} · <span className="text-ink">{money(l.amount)}</span></li>
                      ))}
                    </ul>
                  </div>
                  <div className="md:col-span-2">
                    <FinanceActions id={c.id} today={today} />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Ref</th><th>Employee</th><th>Title</th><th className="text-right">Amount</th><th>Status</th><th>Payment ref / remark</th><th>Date</th></tr></thead>
              <tbody>
                {h.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/expenses/${c.id}`} className="link">{c.ref}</Link></td>
                    <td>{names.get(c.employee_id)?.full_name}</td>
                    <td>{c.title}</td>
                    <td className="text-right">{money(c.total_amount)}</td>
                    <td><ClaimStatusBadge status={c.status} /></td>
                    <td className="text-muted">{c.payment_ref ?? c.finance_remark}</td>
                    <td className="text-muted">{fmtDate(c.paid_on ?? c.finance_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
