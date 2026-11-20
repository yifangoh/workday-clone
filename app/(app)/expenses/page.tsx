import type { Metadata } from 'next'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Card, ClaimStatusBadge, Empty, Flags, PageHeader, Stat } from '@/components/ui'
import { fmtDate, money } from '@/lib/format'
import type { Claim } from '@/lib/types'

export const metadata: Metadata = { title: 'Expenses' }

export default async function ExpensesPage() {
  const me = await requireMe()
  const supabase = await createClient()
  const { data } = await supabase.from('claims').select('*').eq('employee_id', me.id).order('submitted_at', { ascending: false })
  const claims = (data ?? []) as Claim[]
  const sum = (s: Claim['status'][]) => claims.filter((c) => s.includes(c.status)).reduce((a, c) => a + Number(c.total_amount), 0)
  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        subtitle="Submit claims and follow them through approval and payment."
        actions={<Link href="/expenses/new" className="btn-primary"><Plus className="h-4 w-4" /> Create expense report</Link>}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Awaiting approval" value={money(sum(['pending']))} />
        <Stat label="With Finance" value={money(sum(['submitted_to_finance']))} hint="Paid in the next payroll" />
        <Stat label="Paid" value={money(sum(['paid']))} tone="good" />
      </div>
      <Card title="My expense reports" padded={false}>
        {claims.length === 0 ? (
          <div className="p-5"><Empty title="No claims yet"><Link href="/expenses/new" className="link">Create your first expense report</Link></Empty></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Ref</th><th>Title</th><th className="text-right">Total</th><th>Status</th><th>Submitted</th><th>Payment</th></tr></thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/expenses/${c.id}`} className="link">{c.ref}</Link></td>
                    <td>{c.title} <Flags flags={c.flags} /></td>
                    <td className="text-right font-medium">{money(c.total_amount)}</td>
                    <td><ClaimStatusBadge status={c.status} /></td>
                    <td className="text-muted">{fmtDate(c.submitted_at)}</td>
                    <td className="text-muted">{c.payment_ref ? `${c.payment_ref} · ${fmtDate(c.paid_on)}` : '—'}</td>
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
